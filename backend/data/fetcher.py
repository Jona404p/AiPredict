"""
data/fetcher.py — Obtención y caché de datos desde football-data.org y SofaScore
- Liga MX: todos los datos desde SofaScore (equipos, standings, historial)
- Caché inteligente con TTL diferenciado
- Retry exponencial con jitter
- Paralelo para stats de múltiples equipos
"""

import requests
import re
import json
import time
import logging
from datetime import datetime, timedelta
from typing import Optional

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from config import FOOTBALL_API_KEY, LEAGUES

from data.sofascore import (
    get_ligamx_standings,
    get_team_list_from_sofascore,
    get_team_recent_stats_sofascore,
    get_team_match_history_sofascore,
    get_head_to_head_sofascore,
)

logger  = logging.getLogger(__name__)
HEADERS = {"X-Auth-Token": FOOTBALL_API_KEY}
BASE    = "https://api.football-data.org/v4"

# Caché con TTL diferenciado
_cache: dict = {}
CACHE_TTL_SHORT = 120   # datos cambiantes (partidos próximos)
CACHE_TTL_MED   = 300   # estadísticas recientes
CACHE_TTL_LONG  = 3600  # equipos, posiciones


def _get_cached(key: str, ttl: int = CACHE_TTL_MED):
    entry = _cache.get(key)
    if entry:
        v, ts = entry
        if time.time() - ts < ttl:
            return v
    return None


def _set_cached(key: str, value):
    _cache[key] = (value, time.time())


def _api_get(url: str, retries: int = 3, ttl: int = CACHE_TTL_MED) -> Optional[dict]:
    cached = _get_cached(url, ttl)
    if cached is not None:
        return cached

    for attempt in range(retries):
        try:
            resp = requests.get(url, headers=HEADERS, timeout=12)
            if resp.status_code == 429:
                wait = int(resp.headers.get("Retry-After", 60))
                logger.warning(f"Rate limit football-data.org. Esperando {wait}s…")
                time.sleep(wait)
                continue
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            data = resp.json()
            _set_cached(url, data)
            return data
        except requests.exceptions.Timeout:
            logger.warning(f"Timeout football-data.org (intento {attempt+1}): {url}")
        except requests.RequestException as e:
            logger.error(f"Error API football-data.org (intento {attempt+1}): {e}")
        time.sleep(2 ** attempt)
    return None


# ─── Partidos ───────────────────────────────────────────────────────────────

def get_league_matches(league_key: str, status: str = "FINISHED",
                       season: Optional[int] = None) -> list:
    if league_key not in LEAGUES:
        raise ValueError(f"Liga '{league_key}' no soportada")
    code = LEAGUES[league_key]["code"]
    url  = f"{BASE}/competitions/{code}/matches?status={status}"
    if season:
        url += f"&season={season}"
    data = _api_get(url, ttl=CACHE_TTL_SHORT)
    return data.get("matches", []) if data else []


def get_upcoming_matches(league_key: str) -> list:
    return get_league_matches(league_key, status="SCHEDULED")


def get_all_upcoming_matches(days: int = 30, limit: int = 60) -> list:
    """Próximos partidos de todas las ligas. Usa endpoint global con fallback por liga."""
    date_from = datetime.utcnow().date().isoformat()
    date_to   = (datetime.utcnow().date() + timedelta(days=days)).isoformat()
    url       = f"{BASE}/matches?status=SCHEDULED&dateFrom={date_from}&dateTo={date_to}"
    data      = _api_get(url, ttl=CACHE_TTL_SHORT)

    if data and data.get("matches"):
        return data["matches"][:limit]

    # Fallback: consultar ligas individualmente (excluir ligamx — viene de SofaScore)
    matches = []
    for key in LEAGUES:
        if key == "ligamx":
            continue
        try:
            ms = get_upcoming_matches(key)
            matches.extend(ms[:10])
        except Exception as e:
            logger.warning(f"No se pudieron obtener partidos de {key}: {e}")

    matches.sort(key=lambda m: m.get("utcDate", ""))
    return matches[:limit]


# ─── Equipos ────────────────────────────────────────────────────────────────

def get_team_list(league_key: str) -> list:
    """Lista de equipos. Liga MX siempre desde SofaScore."""
    if league_key not in LEAGUES:
        return []

    if league_key == "ligamx":
        return get_team_list_from_sofascore("ligamx")

    code = LEAGUES[league_key]["code"]
    url  = f"{BASE}/competitions/{code}/teams"
    data = _api_get(url, ttl=CACHE_TTL_LONG)
    if not data or not data.get("teams"):
        return []

    return [
        {
            "id":   t["id"],
            "name": t["name"],
            "logo": t.get("crestUrl") or t.get("crest") or "",
        }
        for t in data.get("teams", [])
    ]


# ─── Estadísticas de equipo ─────────────────────────────────────────────────

def get_team_recent_stats(team_id: int, n: int = 10) -> Optional[dict]:
    """
    Estadísticas recientes desde football-data.org.
    Para Liga MX siempre usa SofaScore.
    """
    url  = f"{BASE}/teams/{team_id}/matches?status=FINISHED&limit={n * 2}"
    data = _api_get(url, ttl=CACHE_TTL_MED)
    if not data:
        return None

    matches = data.get("matches", [])[-n:]
    if not matches:
        return None

    goals_scored = []; goals_conceded = []
    home_gs = []; home_gc = []; away_gs = []; away_gc = []
    wins = draws = losses = 0
    home_wins = home_draws = home_losses = 0
    away_wins = away_draws = away_losses = 0
    clean_sheets = 0; failed_to_score = 0
    results_seq = []; weights = list(range(1, len(matches) + 1))
    weighted_pts = 0.0

    for i, m in enumerate(matches):
        h_id = m["homeTeam"]["id"]
        hs   = m["score"]["fullTime"]["home"]
        ag   = m["score"]["fullTime"]["away"]
        if hs is None or ag is None:
            continue

        is_home  = h_id == team_id
        scored   = hs if is_home else ag
        conceded = ag if is_home else hs

        goals_scored.append(scored)
        goals_conceded.append(conceded)

        if is_home:
            home_gs.append(scored); home_gc.append(conceded)
            if scored > conceded:    home_wins += 1
            elif scored == conceded: home_draws += 1
            else:                    home_losses += 1
        else:
            away_gs.append(scored); away_gc.append(conceded)
            if scored > conceded:    away_wins += 1
            elif scored == conceded: away_draws += 1
            else:                    away_losses += 1

        if scored > conceded:
            wins += 1; results_seq.append('W'); pts = 3
        elif scored == conceded:
            draws += 1; results_seq.append('D'); pts = 1
        else:
            losses += 1; results_seq.append('L'); pts = 0

        weighted_pts += weights[i] * pts
        if conceded == 0: clean_sheets += 1
        if scored == 0:   failed_to_score += 1

    if not goals_scored:
        return None

    n_played    = len(goals_scored)
    streak_type = results_seq[-1] if results_seq else 'D'
    streak_count = 0
    for r in reversed(results_seq):
        if r == streak_type: streak_count += 1
        else: break

    if n_played >= 3:
        x   = list(range(n_played))
        xm  = sum(x) / n_played
        ym  = sum(goals_scored) / n_played
        num = sum((xi - xm) * (yi - ym) for xi, yi in zip(x, goals_scored))
        den = sum((xi - xm) ** 2 for xi in x)
        trend = round(num / den, 3) if den != 0 else 0.0
    else:
        trend = 0.0

    weighted_form = round(weighted_pts / sum(weights) * 3, 3) if weights else 0.0
    avg_goals     = sum(goals_scored) / n_played
    avg_conceded  = sum(goals_conceded) / n_played

    return {
        "avg_goals":             round(avg_goals, 3),
        "avg_conceded":          round(avg_conceded, 3),
        "wins":                  wins,
        "draws":                 draws,
        "losses":                losses,
        "goal_diff":             round(avg_goals - avg_conceded, 3),
        "form_points":           wins * 3 + draws,
        "matches_played":        n_played,
        "clean_sheets":          clean_sheets,
        "failed_to_score":       failed_to_score,
        "home_avg_goals":        round(sum(home_gs) / max(len(home_gs), 1), 3),
        "home_avg_conceded":     round(sum(home_gc) / max(len(home_gc), 1), 3),
        "home_wins":             home_wins,
        "home_draws":            home_draws,
        "home_losses":           home_losses,
        "away_avg_goals":        round(sum(away_gs) / max(len(away_gs), 1), 3),
        "away_avg_conceded":     round(sum(away_gc) / max(len(away_gc), 1), 3),
        "away_wins":             away_wins,
        "away_draws":            away_draws,
        "away_losses":           away_losses,
        "avg_first_half_goals":  0.0,
        "avg_second_half_goals": 0.0,
        "weighted_form":         weighted_form,
        "form_string":           "".join(results_seq[-5:]),
        "current_streak_type":   streak_type,
        "current_streak_count":  streak_count,
        "goal_trend":            trend,
        "clean_sheet_rate":      round(clean_sheets / n_played, 3),
        "scoring_rate":          round((n_played - failed_to_score) / n_played, 3),
        "win_rate":              round(wins / n_played, 3),
    }


def get_team_match_history(team_id: int, n: int = 8) -> list:
    url  = f"{BASE}/teams/{team_id}/matches?status=FINISHED&limit={n}"
    data = _api_get(url, ttl=CACHE_TTL_MED)
    if not data:
        return get_team_match_history_sofascore(team_id, n=n)

    history = []
    for m in reversed(data.get("matches", [])[-n:]):
        h_id = m["homeTeam"]["id"]
        hs   = m["score"]["fullTime"]["home"]
        ag   = m["score"]["fullTime"]["away"]
        if hs is None or ag is None:
            continue

        ht = m.get("score", {}).get("halfTime", {})
        ext = m.get("score", {}).get("extraTime", {})
        pen = m.get("score", {}).get("penalties", {})
        is_home  = h_id == team_id
        scored   = hs if is_home else ag
        conceded = ag if is_home else hs

        history.append({
            "date":           m.get("utcDate"),
            "competition":    m.get("competition", {}).get("name", ""),
            "home":           m["homeTeam"]["name"],
            "away":           m["awayTeam"]["name"],
            "home_score":     hs,
            "away_score":     ag,
            "venue":          "local" if is_home else "visitante",
            "opponent":       m["awayTeam"]["name"] if is_home else m["homeTeam"]["name"],
            "goals_scored":   scored,
            "goals_conceded": conceded,
            "result": (
                "victoria" if scored > conceded else
                "empate"   if scored == conceded else
                "derrota"
            ),
            "matchday":   m.get("matchday"),
            "stage":      m.get("stage"),
            "winner":     m.get("score", {}).get("winner"),
            "half_time":  {"home": ht.get("home"), "away": ht.get("away")} if ht else {},
            "extra_time": {"home": ext.get("home"), "away": ext.get("away")} if ext else {},
            "penalties":  {"home": pen.get("home"), "away": pen.get("away")} if pen else {},
            "duration":   m.get("score", {}).get("duration"),
        })
    return history


def get_head_to_head(home_team_id: int, away_team_id: int, limit: int = 10) -> dict:
    url  = f"{BASE}/teams/{home_team_id}/matches?status=FINISHED&limit=60"
    data = _api_get(url, ttl=CACHE_TTL_MED)
    h2h  = {
        "home_wins": 0, "draws": 0, "away_wins": 0, "total": 0,
        "home_goals": 0, "away_goals": 0, "avg_goals_h2h": 0.0, "last_5": [],
    }

    if not data:
        return get_head_to_head_sofascore(home_team_id, away_team_id, limit=limit)

    matches = [
        m for m in data.get("matches", [])
        if m["homeTeam"]["id"] == away_team_id or m["awayTeam"]["id"] == away_team_id
    ][:limit]

    for m in matches:
        h_id = m["homeTeam"]["id"]
        hg   = m["score"]["fullTime"]["home"]
        ag   = m["score"]["fullTime"]["away"]
        if hg is None or ag is None:
            continue

        h2h["total"] += 1
        if h_id == home_team_id:
            h2h["home_goals"] += hg; h2h["away_goals"] += ag
            if hg == ag:   h2h["draws"] += 1
            elif hg > ag:  h2h["home_wins"] += 1
            else:          h2h["away_wins"] += 1
            rl = "home_win" if hg > ag else ("draw" if hg == ag else "away_win")
        else:
            h2h["home_goals"] += ag; h2h["away_goals"] += hg
            if hg == ag:   h2h["draws"] += 1
            elif ag > hg:  h2h["home_wins"] += 1
            else:          h2h["away_wins"] += 1
            rl = "home_win" if ag > hg else ("draw" if hg == ag else "away_win")

        if len(h2h["last_5"]) < 5:
            h2h["last_5"].append({
                "date":   m.get("utcDate", "")[:10],
                "home":   m["homeTeam"]["name"],
                "away":   m["awayTeam"]["name"],
                "score":  f"{hg}-{ag}",
                "result": rl,
            })

    if h2h["total"] > 0:
        h2h["avg_goals_h2h"] = round((h2h["home_goals"] + h2h["away_goals"]) / h2h["total"], 2)
    return h2h


# ─── Posiciones ─────────────────────────────────────────────────────────────

def get_standings(league_key: str) -> list:
    """
    Tabla de posiciones. Liga MX devuelve standings de SofaScore (con puntos reales).
    """
    if league_key not in LEAGUES:
        return []

    if league_key == "ligamx":
        return get_ligamx_standings()

    code = LEAGUES[league_key]["code"]
    url  = f"{BASE}/competitions/{code}/standings"
    data = _api_get(url, ttl=CACHE_TTL_LONG)
    if not data:
        return []

    standings = []
    for table in data.get("standings", []):
        if table.get("type") != "TOTAL":
            continue
        for row in table.get("table", []):
            played = max(row["playedGames"] or 1, 1)
            standings.append({
                "position":          row["position"],
                "team_id":           row["team"]["id"],
                "team_name":         row["team"]["name"],
                "played":            row["playedGames"],
                "won":               row["won"],
                "draw":              row["draw"],
                "lost":              row["lost"],
                "goals_for":         row["goalsFor"],
                "goals_against":     row["goalsAgainst"],
                "goal_diff":         row["goalDifference"],
                "points":            row["points"],
                "points_per_game":   round(row["points"] / played, 3),
                "goals_per_game":    round(row["goalsFor"] / played, 3),
                "conceded_per_game": round(row["goalsAgainst"] / played, 3),
                "win_rate":          round(row["won"] / played, 3),
            })
    return standings


# ─── xG desde Understat ─────────────────────────────────────────────────────

def get_understat_xg(league_key: str) -> dict:
    if league_key not in LEAGUES or not LEAGUES[league_key].get("understat"):
        return {}

    understat_name = LEAGUES[league_key]["understat"]
    url = f"https://understat.com/league/{understat_name}"
    try:
        resp = requests.get(url, timeout=15)
        html = resp.text
    except Exception as e:
        logger.warning(f"Error Understat: {e}")
        return {}

    pattern = r"teamsData\s*=\s*JSON\.parse\('(.*?)'\)"
    match   = re.search(pattern, html)
    if not match:
        return {}

    try:
        raw  = match.group(1).encode("utf-8").decode("unicode_escape")
        data = json.loads(raw)
    except Exception:
        return {}

    result = {}
    for _, team_data in data.items():
        history = team_data.get("history", [])
        if not history:
            continue
        recent    = history[-8:]
        xg_vals   = [float(h.get("xG",    0)) for h in recent]
        xga_vals  = [float(h.get("xGA",   0)) for h in recent]
        npxg_vals = [float(h.get("npxG",  0) or 0) for h in recent]
        scored    = [float(h.get("scored", 0)) for h in recent]
        missed    = [float(h.get("missed", 0)) for h in recent]
        n         = len(recent)
        avg_xg    = sum(xg_vals)  / n
        avg_xga   = sum(xga_vals) / n
        avg_sc    = sum(scored)   / n

        result[team_data["title"]] = {
            "xg":                  round(avg_xg, 3),
            "xga":                 round(avg_xga, 3),
            "npxg":                round(sum(npxg_vals) / n, 3),
            "xg_diff":             round(avg_xg - avg_xga, 3),
            "xg_over_performance": round(avg_sc - avg_xg, 3),
            "avg_missed_xg":       round(sum(missed) / n, 3),
        }
    return result
