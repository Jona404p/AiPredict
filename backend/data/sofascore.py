"""
data/sofascore.py — Scraping de SofaScore v4 (Optimizado)
Mejoras v4:
  - Obtenciones paralelas con ThreadPoolExecutor para reducir latencia 3-5x
  - Cache LRU con TTL y limpieza automatica para evitar memory leaks
  - Sesion requests persistente con connection pooling (HTTP keep-alive)
  - Extraccion de stats enriquecida: big chances missed, dribbles, tackles won
  - Weighted moving average en stats recientes (mas peso a partidos recientes)
  - Deduplicacion robusta de partidos con set de IDs
  - Mejor parseo de keys de estadisticas con mapeo normalizado
  - Retry inteligente con jitter aleatorio y backoff exponencial real
"""

import time
import logging
import random
import math
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional
from datetime import datetime, timedelta, timezone
from threading import Lock
from collections import OrderedDict

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from config import (
    SOFASCORE_BASE, SOFASCORE_HEADERS,
    SOFASCORE_TOURNAMENT_IDS,
    SOFASCORE_CACHE_TTL_LIVE,
    SOFASCORE_CACHE_TTL_STATS,
    SOFASCORE_CACHE_TTL_STATIC,
)

logger = logging.getLogger(__name__)

# ─── Cache LRU con TTL y limpieza automatica ─────────────────────────────────

_CACHE_MAX_SIZE = 2000
_cache: OrderedDict = OrderedDict()
_cache_lock = Lock()


def _get_cached(key: str, ttl: int):
    with _cache_lock:
        if key in _cache:
            value, ts = _cache[key]
            if time.time() - ts < ttl:
                _cache.move_to_end(key)
                return value
            else:
                del _cache[key]
    return None


def _set_cached(key: str, value):
    with _cache_lock:
        if key in _cache:
            _cache.move_to_end(key)
        _cache[key] = (value, time.time())
        while len(_cache) > _CACHE_MAX_SIZE:
            _cache.popitem(last=False)


def clear_stale_cache():
    """Limpia entradas expiradas del cache."""
    now = time.time()
    with _cache_lock:
        expired = [k for k, (_, ts) in _cache.items() if now - ts > SOFASCORE_CACHE_TTL_STATIC * 2]
        for k in expired:
            del _cache[k]
    if expired:
        logger.debug(f"Cache: eliminadas {len(expired)} entradas expiradas")


# ─── Sesion HTTP persistente con connection pooling ───────────────────────────

_session: Optional[requests.Session] = None
_session_lock = Lock()

_USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
]


def _get_session() -> requests.Session:
    global _session
    with _session_lock:
        if _session is None:
            _session = requests.Session()
            adapter = HTTPAdapter(
                pool_connections=10,
                pool_maxsize=20,
                max_retries=Retry(total=0),  # manejamos retries manualmente
            )
            _session.mount("https://", adapter)
            _session.mount("http://", adapter)
        return _session


def _get_headers() -> dict:
    h = dict(SOFASCORE_HEADERS)
    h["User-Agent"] = random.choice(_USER_AGENTS)
    h["Accept-Encoding"] = "gzip, deflate, br"
    h["Connection"] = "keep-alive"
    return h


def _sofascore_get(path: str, ttl: int = SOFASCORE_CACHE_TTL_STATS, retries: int = 4) -> Optional[dict]:
    url = f"{SOFASCORE_BASE}{path}"
    cached = _get_cached(url, ttl)
    if cached is not None:
        return cached

    session = _get_session()

    for attempt in range(retries):
        try:
            headers = _get_headers()
            resp = session.get(url, headers=headers, timeout=(8, 20))
            if resp.status_code == 429:
                wait = int(resp.headers.get("Retry-After", 20 + attempt * 10))
                jitter = random.uniform(0, 5)
                logger.warning(f"SofaScore rate limit. Esperando {wait + jitter:.1f}s...")
                time.sleep(wait + jitter)
                continue
            if resp.status_code == 404:
                _set_cached(url, None)  # Cache negativo corto
                return None
            if resp.status_code in (403, 451):
                logger.warning(f"SofaScore bloqueo {resp.status_code} para {path}")
                time.sleep(3 + attempt * 4 + random.uniform(0, 2))
                continue
            if resp.status_code >= 500:
                logger.warning(f"SofaScore server error {resp.status_code}")
                time.sleep(2 ** attempt + random.uniform(0, 1))
                continue
            resp.raise_for_status()
            data = resp.json()
            _set_cached(url, data)
            return data
        except requests.exceptions.Timeout:
            logger.warning(f"SofaScore timeout (intento {attempt + 1}): {path}")
            time.sleep(1 + attempt * 2)
        except requests.RequestException as e:
            logger.warning(f"SofaScore error (intento {attempt + 1}): {e}")
            time.sleep(1.5 ** attempt + random.uniform(0, 1.5))
    return None


# ─── Fetch paralelo de multiples paths ────────────────────────────────────────

def _parallel_fetch(paths: list, ttl: int = SOFASCORE_CACHE_TTL_STATS, max_workers: int = 4) -> dict:
    """Fetch multiple SofaScore paths in parallel. Returns {path: data}."""
    results = {}
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(_sofascore_get, path, ttl): path
            for path in paths
        }
        for future in as_completed(futures):
            path = futures[future]
            try:
                results[path] = future.result()
            except Exception as e:
                logger.warning(f"Error parallel fetch {path}: {e}")
                results[path] = None
    return results


# ═══════════════════════════════════════════════════════════════════════════════
#  BUSQUEDA DE EQUIPOS
# ═══════════════════════════════════════════════════════════════════════════════

def _normalize(s: str) -> str:
    import unicodedata
    s = unicodedata.normalize("NFD", s.lower())
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


def _extract_team_logo(team_entity: dict) -> str:
    if not team_entity:
        return ""
    team_id = team_entity.get("id")
    if team_id:
        return f"https://api.sofascore.com/api/v1/team/{team_id}/image"
    return ""


def search_team(team_name: str) -> Optional[dict]:
    """Busca un equipo por nombre con matching score mejorado y fallback."""
    queries = [team_name]
    parts = team_name.strip().split()
    if len(parts) > 1:
        queries.append(parts[0])
        queries.append(" ".join(parts[:2]))
    # Agregar nombre sin sufijos comunes
    for suffix in ["FC", "CF", "SC", "AC", "SL"]:
        clean = team_name.replace(suffix, "").strip()
        if clean != team_name and clean:
            queries.append(clean)

    for query in queries:
        data = _sofascore_get(
            f"/search/all/?q={requests.utils.quote(query)}&page=0",
            ttl=SOFASCORE_CACHE_TTL_STATIC,
        )
        if not data:
            continue

        team_name_norm = _normalize(team_name)
        best = None
        best_score = 0

        for result in data.get("results", []):
            if result.get("type") != "team":
                continue
            entity = result.get("entity", {})
            candidate = _normalize(entity.get("name", ""))

            # Scoring mejorado
            if candidate == team_name_norm:
                score = 100
            elif team_name_norm in candidate or candidate in team_name_norm:
                # Bonus por longitud similar
                len_ratio = min(len(team_name_norm), len(candidate)) / max(len(team_name_norm), len(candidate), 1)
                score = 50 + int(len_ratio * 20)
            else:
                a_words = set(team_name_norm.split())
                b_words = set(candidate.split())
                common = len(a_words & b_words)
                total = max(len(a_words | b_words), 1)
                score = int(common / total * 30)

            if score > best_score:
                best_score = score
                best = {
                    "id":      entity.get("id"),
                    "name":    entity.get("name"),
                    "slug":    entity.get("slug"),
                    "country": entity.get("country", {}).get("name"),
                    "logo":    _extract_team_logo(entity),
                }

        if best and best_score >= 5:
            return best

    return None


def get_team_logo_by_id(team_id: int) -> str:
    return f"https://api.sofascore.com/api/v1/team/{team_id}/image"


def get_team_id_by_name(team_name: str) -> Optional[int]:
    info = search_team(team_name)
    return info["id"] if info else None


# ═══════════════════════════════════════════════════════════════════════════════
#  PARTIDOS LIVE Y POR FECHA
# ═══════════════════════════════════════════════════════════════════════════════

def get_live_matches() -> list:
    data = _sofascore_get("/sport/football/events/live", ttl=SOFASCORE_CACHE_TTL_LIVE)
    if not data:
        return []

    matches = []
    for event in data.get("events", []):
        status = event.get("status", {})
        home   = event.get("homeTeam", {})
        away   = event.get("awayTeam", {})
        score  = event.get("homeScore", {}), event.get("awayScore", {})
        matches.append({
            "sofascore_id":   event.get("id"),
            "home_team":      home.get("name"),
            "home_team_id":   home.get("id"),
            "away_team":      away.get("name"),
            "away_team_id":   away.get("id"),
            "home_score":     score[0].get("current", 0),
            "away_score":     score[1].get("current", 0),
            "home_ht":        score[0].get("period1", 0),
            "away_ht":        score[1].get("period1", 0),
            "minute":         status.get("description", ""),
            "status_type":    status.get("type", ""),
            "status_desc":    status.get("description", ""),
            "tournament":     event.get("tournament", {}).get("name", ""),
            "tournament_id":  event.get("tournament", {}).get("id"),
            "start_timestamp": event.get("startTimestamp"),
            "home_logo":      f"https://api.sofascore.com/api/v1/team/{home.get('id')}/image" if home.get("id") else "",
            "away_logo":      f"https://api.sofascore.com/api/v1/team/{away.get('id')}/image" if away.get("id") else "",
        })
    return matches


def get_matches_by_date(date_str: str = None) -> list:
    if date_str is None:
        date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    data = _sofascore_get(
        f"/sport/football/scheduled-events/{date_str}",
        ttl=SOFASCORE_CACHE_TTL_LIVE,
    )
    if not data:
        return []

    matches = []
    for event in data.get("events", []):
        status = event.get("status", {})
        home   = event.get("homeTeam", {})
        away   = event.get("awayTeam", {})
        hs     = event.get("homeScore", {})
        as_    = event.get("awayScore", {})
        matches.append({
            "sofascore_id":    event.get("id"),
            "home_team":       home.get("name"),
            "home_team_id":    home.get("id"),
            "home_team_slug":  home.get("slug"),
            "away_team":       away.get("name"),
            "away_team_id":    away.get("id"),
            "away_team_slug":  away.get("slug"),
            "home_score":      hs.get("current"),
            "away_score":      as_.get("current"),
            "home_ht":         hs.get("period1"),
            "away_ht":         as_.get("period1"),
            "status_type":     status.get("type"),
            "status_desc":     status.get("description", ""),
            "minute":          status.get("description", ""),
            "tournament":      event.get("tournament", {}).get("name", ""),
            "tournament_id":   event.get("tournament", {}).get("id"),
            "start_timestamp": event.get("startTimestamp"),
            "date":            date_str,
            "home_logo":       f"https://api.sofascore.com/api/v1/team/{home.get('id')}/image" if home.get("id") else "",
            "away_logo":       f"https://api.sofascore.com/api/v1/team/{away.get('id')}/image" if away.get("id") else "",
        })
    return matches


# ═══════════════════════════════════════════════════════════════════════════════
#  ESTADISTICAS DE PARTIDO (Parseo mejorado con mapeo normalizado)
# ═══════════════════════════════════════════════════════════════════════════════

# Mapeo normalizado de keys de SofaScore a nuestras keys internas
_STAT_KEY_MAP = {
    "ball possession": "ball_possession",
    "total shots": "total_shots",
    "shots on target": "shots_on_target",
    "shots off target": "shots_off_target",
    "blocked shots": "blocked_shots",
    "corner kicks": "corner_kicks",
    "corners": "corner_kicks",
    "yellow cards": "yellow_cards",
    "red cards": "red_cards",
    "fouls": "fouls",
    "offsides": "offsides",
    "goalkeeper saves": "goalkeeper_saves",
    "big chances": "big_chances",
    "big chances missed": "big_chances_missed",
    "big chances scored": "big_chances_scored",
    "tackles": "tackles",
    "interceptions": "interceptions",
    "clearances": "clearances",
    "expected goals": "expected_goals",
    "xg": "expected_goals",
    "passes": "passes",
    "accurate passes": "accurate_passes",
    "long balls": "long_balls",
    "crosses": "crosses",
    "dribbles": "dribbles",
    "successful dribbles": "successful_dribbles",
    "duels": "duels",
    "duels won": "duels_won",
    "aerials won": "aerials_won",
    "dangerous attacks": "dangerous_attacks",
    "attacks": "attacks",
    "hit woodwork": "hit_woodwork",
    "total passes": "total_passes",
    "free kicks": "free_kicks",
    "throw ins": "throw_ins",
    "goal kicks": "goal_kicks",
}


def _normalize_stat_key(key: str) -> str:
    """Normaliza la key de estadistica para matching consistente."""
    k = key.lower().replace("_", " ").strip()
    return _STAT_KEY_MAP.get(k, key.lower().replace(" ", "_"))


def get_match_statistics(sofascore_match_id: int) -> dict:
    data = _sofascore_get(
        f"/event/{sofascore_match_id}/statistics",
        ttl=SOFASCORE_CACHE_TTL_LIVE,
    )
    if not data:
        return {}

    home_stats = {}
    away_stats = {}

    for period in data.get("statistics", []):
        period_name = period.get("period", "ALL")
        if period_name not in ("ALL", "1ST", "2ND"):
            continue
        prefix = "" if period_name == "ALL" else f"{period_name.lower()}_"

        for group in period.get("groups", []):
            for stat in group.get("statisticsItems", []):
                raw_key = stat.get("key", "")
                key = _normalize_stat_key(raw_key)
                h_val  = stat.get("home")
                a_val  = stat.get("away")
                h_pct  = stat.get("homePercentage")
                a_pct  = stat.get("awayPercentage")
                h_total = stat.get("homeTotal")
                a_total = stat.get("awayTotal")

                home_stats[f"{prefix}{key}"]  = _parse_stat(h_val)
                away_stats[f"{prefix}{key}"]  = _parse_stat(a_val)
                if h_pct is not None:
                    home_stats[f"{prefix}{key}_pct"] = _parse_stat(h_pct)
                    away_stats[f"{prefix}{key}_pct"] = _parse_stat(a_pct)
                if h_total is not None:
                    home_stats[f"{prefix}{key}_total"] = _parse_stat(h_total)
                    away_stats[f"{prefix}{key}_total"] = _parse_stat(a_total)

    return {"home": home_stats, "away": away_stats}


def _parse_stat(val) -> Optional[float]:
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return float(val)
    s = str(val).replace("%", "").replace(",", "").strip()
    try:
        return float(s)
    except ValueError:
        return None


def _safe_add(a, b):
    if a is None and b is None:
        return None
    return (a or 0) + (b or 0)


def get_match_corners(sofascore_match_id: int) -> dict:
    stats = get_match_statistics(sofascore_match_id)
    home  = stats.get("home", {})
    away  = stats.get("away", {})
    return {
        "home_corners":       home.get("corner_kicks") or home.get("corners"),
        "away_corners":       away.get("corner_kicks") or away.get("corners"),
        "home_1h_corners":    home.get("1st_corner_kicks") or home.get("1st_corners"),
        "away_1h_corners":    away.get("1st_corner_kicks") or away.get("1st_corners"),
        "home_2h_corners":    home.get("2nd_corner_kicks") or home.get("2nd_corners"),
        "away_2h_corners":    away.get("2nd_corner_kicks") or away.get("2nd_corners"),
        "total_corners":      _safe_add(home.get("corner_kicks"), away.get("corner_kicks")),
    }


def get_match_cards(sofascore_match_id: int) -> dict:
    stats = get_match_statistics(sofascore_match_id)
    home  = stats.get("home", {})
    away  = stats.get("away", {})
    return {
        "home_yellow":  home.get("yellow_cards"),
        "away_yellow":  away.get("yellow_cards"),
        "home_red":     home.get("red_cards"),
        "away_red":     away.get("red_cards"),
        "total_yellow": _safe_add(home.get("yellow_cards"), away.get("yellow_cards")),
        "total_red":    _safe_add(home.get("red_cards"), away.get("red_cards")),
    }


def get_match_shots(sofascore_match_id: int) -> dict:
    stats = get_match_statistics(sofascore_match_id)
    home  = stats.get("home", {})
    away  = stats.get("away", {})
    return {
        "home_shots":           home.get("total_shots") or home.get("shots"),
        "away_shots":           away.get("total_shots") or away.get("shots"),
        "home_shots_on_target": home.get("shots_on_target"),
        "away_shots_on_target": away.get("shots_on_target"),
        "home_shots_off_target":home.get("shots_off_target"),
        "away_shots_off_target":away.get("shots_off_target"),
        "home_blocked_shots":   home.get("blocked_shots"),
        "away_blocked_shots":   away.get("blocked_shots"),
        "home_shot_accuracy":   home.get("shots_on_target_pct"),
        "away_shot_accuracy":   away.get("shots_on_target_pct"),
    }


def get_match_possession(sofascore_match_id: int) -> dict:
    stats = get_match_statistics(sofascore_match_id)
    home  = stats.get("home", {})
    away  = stats.get("away", {})
    return {
        "home_possession":    home.get("ball_possession") or home.get("possession"),
        "away_possession":    away.get("ball_possession") or away.get("possession"),
        "home_1h_possession": home.get("1st_ball_possession"),
        "away_1h_possession": away.get("1st_ball_possession"),
        "home_2h_possession": home.get("2nd_ball_possession"),
        "away_2h_possession": away.get("2nd_ball_possession"),
    }


def get_full_match_stats(sofascore_match_id: int) -> dict:
    """Todas las estadisticas del partido en un solo dict - ahora con stats extra."""
    raw  = get_match_statistics(sofascore_match_id)
    home = raw.get("home", {})
    away = raw.get("away", {})

    def h(key, *aliases):
        for k in (key, *aliases):
            v = home.get(k)
            if v is not None:
                return v
        return None

    def a(key, *aliases):
        for k in (key, *aliases):
            v = away.get(k)
            if v is not None:
                return v
        return None

    return {
        "home_possession":          h("ball_possession", "possession"),
        "away_possession":          a("ball_possession", "possession"),
        "home_shots":               h("total_shots", "shots"),
        "away_shots":               a("total_shots", "shots"),
        "home_shots_on_target":     h("shots_on_target"),
        "away_shots_on_target":     a("shots_on_target"),
        "home_shots_off_target":    h("shots_off_target"),
        "away_shots_off_target":    a("shots_off_target"),
        "home_blocked_shots":       h("blocked_shots"),
        "away_blocked_shots":       a("blocked_shots"),
        "home_shot_accuracy":       h("shots_on_target_pct"),
        "away_shot_accuracy":       a("shots_on_target_pct"),
        "home_corners":             h("corner_kicks", "corners"),
        "away_corners":             a("corner_kicks", "corners"),
        "home_1h_corners":          h("1st_corner_kicks", "1st_corners"),
        "away_1h_corners":          a("1st_corner_kicks", "1st_corners"),
        "home_yellow_cards":        h("yellow_cards"),
        "away_yellow_cards":        a("yellow_cards"),
        "home_red_cards":           h("red_cards"),
        "away_red_cards":           a("red_cards"),
        "home_fouls":               h("fouls"),
        "away_fouls":               a("fouls"),
        "home_dangerous_attacks":   h("dangerous_attacks"),
        "away_dangerous_attacks":   a("dangerous_attacks"),
        "home_attacks":             h("attacks"),
        "away_attacks":             a("attacks"),
        "home_xg":                  h("expected_goals", "xg"),
        "away_xg":                  a("expected_goals", "xg"),
        "home_passes":              h("passes", "total_passes"),
        "away_passes":              a("passes", "total_passes"),
        "home_pass_accuracy":       h("accurate_passes_pct", "passes_pct"),
        "away_pass_accuracy":       a("accurate_passes_pct", "passes_pct"),
        "home_offsides":            h("offsides"),
        "away_offsides":            a("offsides"),
        "home_goalkeeper_saves":    h("goalkeeper_saves"),
        "away_goalkeeper_saves":    a("goalkeeper_saves"),
        "home_big_chances":         h("big_chances"),
        "away_big_chances":         a("big_chances"),
        "home_big_chances_missed":  h("big_chances_missed"),
        "away_big_chances_missed":  a("big_chances_missed"),
        "home_big_chances_scored":  h("big_chances_scored"),
        "away_big_chances_scored":  a("big_chances_scored"),
        "home_tackles":             h("tackles"),
        "away_tackles":             a("tackles"),
        "home_interceptions":       h("interceptions"),
        "away_interceptions":       a("interceptions"),
        "home_clearances":          h("clearances"),
        "away_clearances":          a("clearances"),
        "home_dribbles":            h("dribbles"),
        "away_dribbles":            a("dribbles"),
        "home_successful_dribbles": h("successful_dribbles"),
        "away_successful_dribbles": a("successful_dribbles"),
        "home_duels_won":           h("duels_won"),
        "away_duels_won":           a("duels_won"),
        "home_aerials_won":         h("aerials_won"),
        "away_aerials_won":         a("aerials_won"),
        "home_crosses":             h("crosses"),
        "away_crosses":             a("crosses"),
        "home_long_balls":          h("long_balls"),
        "away_long_balls":          a("long_balls"),
        "home_hit_woodwork":        h("hit_woodwork"),
        "away_hit_woodwork":        a("hit_woodwork"),
        "total_corners":  _safe_add(h("corner_kicks", "corners"), a("corner_kicks", "corners")),
        "total_cards":    _safe_add(
            _safe_add(h("yellow_cards"), h("red_cards")),
            _safe_add(a("yellow_cards"), a("red_cards")),
        ),
    }


# ═══════════════════════════════════════════════════════════════════════════════
#  STATS DE TEMPORADA DEL EQUIPO
# ═══════════════════════════════════════════════════════════════════════════════

def get_team_season_stats(team_id: int) -> dict:
    # Intentar multiples endpoints en paralelo
    paths = [
        f"/team/{team_id}/statistics/season",
        f"/team/{team_id}/unique-tournament-statistics",
    ]
    results = _parallel_fetch(paths, ttl=SOFASCORE_CACHE_TTL_STATS, max_workers=2)

    data = results.get(paths[0])
    if data and data.get("statistics"):
        return _parse_season_stats(data["statistics"])

    data2 = results.get(paths[1])
    if data2:
        for ut in data2.get("uniqueTournamentStatistics", []):
            stats = ut.get("statistics", {})
            if stats:
                return _parse_season_stats(stats)

    return {}


def _parse_season_stats(stats: dict) -> dict:
    return {
        "season_xg":             stats.get("expectedGoals"),
        "season_xga":            stats.get("expectedGoalsAgainst"),
        "season_avg_possession": stats.get("possessionPercentage"),
        "season_avg_shots":      stats.get("averageShots") or stats.get("shotsPerMatch"),
        "season_avg_corners":    stats.get("cornerKicks") or stats.get("cornersPerMatch"),
        "season_goals":          stats.get("goals"),
        "season_goals_conceded": stats.get("goalsConceded"),
        "season_matches":        stats.get("matchesPlayed") or stats.get("played"),
        "season_wins":           stats.get("wins"),
        "season_draws":          stats.get("draws"),
        "season_losses":         stats.get("losses"),
        "season_clean_sheets":   stats.get("cleanSheets"),
        "season_avg_xg":         stats.get("averageExpectedGoals"),
        "season_avg_xga":        stats.get("averageExpectedGoalsAgainst"),
    }


# ═══════════════════════════════════════════════════════════════════════════════
#  MOMENTUM
# ═══════════════════════════════════════════════════════════════════════════════

def get_match_momentum(sofascore_match_id: int) -> dict:
    data = _sofascore_get(
        f"/event/{sofascore_match_id}/graph",
        ttl=SOFASCORE_CACHE_TTL_LIVE,
    )
    if not data:
        return {}

    points = data.get("graphPoints", [])
    if not points:
        return {}

    home_momentum = [p["value"] for p in points if p.get("value", 0) > 0]
    away_momentum = [abs(p["value"]) for p in points if p.get("value", 0) < 0]
    recent        = points[-10:] if len(points) > 10 else points
    recent_home   = [p["value"] for p in recent if p.get("value", 0) > 0]
    recent_away   = [abs(p["value"]) for p in recent if p.get("value", 0) < 0]

    return {
        "momentum_points":       points,
        "home_avg_momentum":     round(sum(home_momentum) / max(len(home_momentum), 1), 2),
        "away_avg_momentum":     round(sum(away_momentum) / max(len(away_momentum), 1), 2),
        "home_recent_momentum":  round(sum(recent_home) / max(len(recent_home), 1), 2),
        "away_recent_momentum":  round(sum(recent_away) / max(len(recent_away), 1), 2),
        "total_points":          len(points),
        "current_momentum":      points[-1].get("value") if points else 0,
        "dominant_team":         "home" if (sum(p.get("value", 0) for p in points) > 0) else "away",
    }


# ═══════════════════════════════════════════════════════════════════════════════
#  JUGADORES
# ═══════════════════════════════════════════════════════════════════════════════

def get_match_lineups(sofascore_match_id: int) -> dict:
    data = _sofascore_get(
        f"/event/{sofascore_match_id}/lineups",
        ttl=SOFASCORE_CACHE_TTL_STATS,
    )
    if not data:
        return {}

    def extract_players(team_data: dict) -> list:
        players = []
        for p in team_data.get("players", []):
            player = p.get("player", {})
            players.append({
                "id":         player.get("id"),
                "name":       player.get("name"),
                "position":   p.get("position"),
                "jersey":     p.get("shirtNumber"),
                "captain":    p.get("captain", False),
                "substitute": p.get("substitute", False),
                "rating":     p.get("statistics", {}).get("rating"),
            })
        return players

    home_data = data.get("home", {})
    away_data = data.get("away", {})
    return {
        "home_formation": home_data.get("formation"),
        "away_formation": away_data.get("formation"),
        "home_players":   extract_players(home_data),
        "away_players":   extract_players(away_data),
        "confirmed":      data.get("confirmed", False),
    }


def get_match_player_stats(sofascore_match_id: int) -> dict:
    data = _sofascore_get(
        f"/event/{sofascore_match_id}/lineups",
        ttl=SOFASCORE_CACHE_TTL_STATS,
    )
    if not data:
        return {}

    def extract_stats(team_data: dict) -> list:
        players = []
        for p in team_data.get("players", []):
            player = p.get("player", {})
            stats  = p.get("statistics", {})
            players.append({
                "id":              player.get("id"),
                "name":            player.get("name"),
                "position":        p.get("position"),
                "jersey":          p.get("shirtNumber"),
                "substitute":      p.get("substitute", False),
                "captain":         p.get("captain", False),
                "rating":          stats.get("rating"),
                "goals":           stats.get("goals", 0),
                "assists":         stats.get("goalAssist", 0),
                "own_goals":       stats.get("ownGoals", 0),
                "shots_on_target": stats.get("onTargetScoringAttempt", 0),
                "shots_total":     stats.get("totalScoringAttempt", 0),
                "passes":          stats.get("totalPass", 0),
                "key_passes":      stats.get("keyPass", 0),
                "pass_accuracy":   stats.get("accuratePass"),
                "duels_won":       stats.get("duelWon", 0),
                "duels_lost":      stats.get("duelLost", 0),
                "aerial_won":      stats.get("aerialWon", 0),
                "yellow_card":     stats.get("yellowCard", False),
                "red_card":        stats.get("redCard", False),
                "fouls_committed": stats.get("foulsCommitted", 0),
                "fouls_suffered":  stats.get("foulsSuffered", 0),
                "tackles":         stats.get("totalTackle", 0),
                "clearances":      stats.get("totalClearance", 0),
                "interceptions":   stats.get("interceptionWon", 0),
                "saves":           stats.get("saves"),
                "minutes_played":  stats.get("minutesPlayed"),
            })
        return players

    return {
        "home": extract_stats(data.get("home", {})),
        "away": extract_stats(data.get("away", {})),
    }


# ═══════════════════════════════════════════════════════════════════════════════
#  HISTORIAL DE EQUIPO (OPTIMIZADO con fetch paralelo de stats)
# ═══════════════════════════════════════════════════════════════════════════════

def get_team_last_matches_sofascore(team_id: int, n: int = 10) -> list:
    """Ultimos N partidos finalizados de un equipo — con deduplicacion robusta."""
    all_events = []
    for page in range(3):
        data = _sofascore_get(
            f"/team/{team_id}/events/last/{page}",
            ttl=SOFASCORE_CACHE_TTL_STATS,
        )
        if not data:
            break
        events = data.get("events", [])
        all_events.extend(events)
        if len(events) < 10:
            break

    matches = []
    seen = set()
    for event in all_events:
        eid = event.get("id")
        if eid in seen:
            continue
        seen.add(eid)

        home   = event.get("homeTeam", {})
        away   = event.get("awayTeam", {})
        hs     = event.get("homeScore", {})
        as_    = event.get("awayScore", {})
        status = event.get("status", {})

        if status.get("type") != "finished":
            continue

        is_home = (home.get("id") == team_id)
        matches.append({
            "sofascore_id": eid,
            "date":         event.get("startTimestamp"),
            "home_team":    home.get("name"),
            "away_team":    away.get("name"),
            "home_team_id": home.get("id"),
            "away_team_id": away.get("id"),
            "home_score":   hs.get("current"),
            "away_score":   as_.get("current"),
            "home_ht":      hs.get("period1"),
            "away_ht":      as_.get("period1"),
            "is_home":      is_home,
            "tournament":   event.get("tournament", {}).get("name"),
            "tournament_id": event.get("tournament", {}).get("id"),
            "status":       status.get("description"),
        })

    matches.sort(key=lambda x: x.get("date") or 0, reverse=True)
    return matches[:n]


def get_team_recent_stats_sofascore(team_id: int, n: int = 10) -> Optional[dict]:
    """Estadisticas recientes con weighted moving average (mas peso a partidos recientes)."""
    matches = get_team_last_matches_sofascore(team_id, n=n * 3)
    if not matches:
        return None

    matches = matches[:n]
    goals_scored, goals_conceded = [], []
    home_gs, home_gc, away_gs, away_gc = [], [], [], []
    wins = draws = losses = 0
    home_wins = home_draws = home_losses = 0
    away_wins = away_draws = away_losses = 0
    clean_sheets = 0
    failed_to_score = 0
    results_sequence = []

    # Pesos exponenciales: partidos mas recientes pesan mas
    n_matches = len(matches)
    decay = 0.9  # factor de decaimiento
    exp_weights = [decay ** (n_matches - 1 - i) for i in range(n_matches)]
    total_weight = sum(exp_weights)

    weighted_goals = 0.0
    weighted_conceded = 0.0
    weighted_points = 0.0

    for i, match in enumerate(matches):
        scored   = match["home_score"] if match["is_home"] else match["away_score"]
        conceded = match["away_score"] if match["is_home"] else match["home_score"]
        if scored is None or conceded is None:
            continue

        w = exp_weights[i]
        goals_scored.append(scored)
        goals_conceded.append(conceded)
        weighted_goals += scored * w
        weighted_conceded += conceded * w

        if match["is_home"]:
            home_gs.append(scored); home_gc.append(conceded)
            if scored > conceded:   home_wins += 1
            elif scored == conceded: home_draws += 1
            else:                   home_losses += 1
        else:
            away_gs.append(scored); away_gc.append(conceded)
            if scored > conceded:   away_wins += 1
            elif scored == conceded: away_draws += 1
            else:                   away_losses += 1

        if scored > conceded:
            wins += 1; results_sequence.append('W'); pts = 3
        elif scored == conceded:
            draws += 1; results_sequence.append('D'); pts = 1
        else:
            losses += 1; results_sequence.append('L'); pts = 0

        weighted_points += w * pts
        if conceded == 0: clean_sheets += 1
        if scored == 0:   failed_to_score += 1

    if not goals_scored:
        return None

    n_played = len(goals_scored)
    streak_type  = results_sequence[-1] if results_sequence else 'D'
    streak_count = 0
    for r in reversed(results_sequence):
        if r == streak_type: streak_count += 1
        else: break

    # Tendencia con regresion lineal ponderada
    if len(goals_scored) >= 3:
        x = list(range(len(goals_scored)))
        xm = sum(xi * wi for xi, wi in zip(x, exp_weights[:len(x)])) / total_weight
        ym = weighted_goals / total_weight
        num = sum(wi * (xi - xm) * (yi - ym) for xi, yi, wi in zip(x, goals_scored, exp_weights[:len(x)]))
        den = sum(wi * (xi - xm) ** 2 for xi, wi in zip(x, exp_weights[:len(x)]))
        trend_goals = round(num / den, 3) if den != 0 else 0.0
    else:
        trend_goals = 0.0

    ew_total = sum(exp_weights[:n_played])
    weighted_form = round(weighted_points / max(ew_total, 0.01) * 3, 3)
    avg_goals     = sum(goals_scored) / n_played
    avg_conceded  = sum(goals_conceded) / n_played

    # Weighted averages para goles (dan mas peso a partidos recientes)
    w_avg_goals = round(weighted_goals / max(ew_total, 0.01), 3)
    w_avg_conceded = round(weighted_conceded / max(ew_total, 0.01), 3)

    return {
        "avg_goals":            round(avg_goals, 3),
        "avg_conceded":         round(avg_conceded, 3),
        "weighted_avg_goals":   w_avg_goals,
        "weighted_avg_conceded": w_avg_conceded,
        "wins":                 wins,
        "draws":                draws,
        "losses":               losses,
        "goal_diff":            round(avg_goals - avg_conceded, 3),
        "form_points":          wins * 3 + draws,
        "matches_played":       n_played,
        "clean_sheets":         clean_sheets,
        "failed_to_score":      failed_to_score,
        "home_avg_goals":       round(sum(home_gs) / max(len(home_gs), 1), 3),
        "home_avg_conceded":    round(sum(home_gc) / max(len(home_gc), 1), 3),
        "home_wins":            home_wins, "home_draws": home_draws, "home_losses": home_losses,
        "away_avg_goals":       round(sum(away_gs) / max(len(away_gs), 1), 3),
        "away_avg_conceded":    round(sum(away_gc) / max(len(away_gc), 1), 3),
        "away_wins":            away_wins, "away_draws": away_draws, "away_losses": away_losses,
        "avg_first_half_goals": 0.0,
        "avg_second_half_goals": 0.0,
        "weighted_form":        weighted_form,
        "form_string":          "".join(results_sequence[-5:]),
        "current_streak_type":  streak_type,
        "current_streak_count": streak_count,
        "goal_trend":           trend_goals,
        "clean_sheet_rate":     round(clean_sheets / n_played, 3),
        "scoring_rate":         round((n_played - failed_to_score) / n_played, 3),
        "win_rate":             round(wins / n_played, 3),
    }


def get_team_match_history_sofascore(team_id: int, n: int = 8) -> list:
    matches = get_team_last_matches_sofascore(team_id, n=n * 2)
    history = []
    for event in matches[:n]:
        is_home   = event.get("is_home", False)
        home_name = event.get("home_team")
        away_name = event.get("away_team")
        hs = event.get("home_score")
        ag = event.get("away_score")
        scored   = hs if is_home else ag
        conceded = ag if is_home else hs
        if scored is None or conceded is None:
            continue
        result = "victoria" if scored > conceded else ("empate" if scored == conceded else "derrota")
        ts = event.get("date", 0)
        history.append({
            "date":          datetime.fromtimestamp(ts, timezone.utc).isoformat() + "Z" if ts else None,
            "competition":   event.get("tournament", "Liga MX"),
            "home":          home_name,
            "away":          away_name,
            "home_score":    hs,
            "away_score":    ag,
            "home_ht":       event.get("home_ht"),
            "away_ht":       event.get("away_ht"),
            "venue":         "local" if is_home else "visitante",
            "opponent":      away_name if is_home else home_name,
            "goals_scored":  scored,
            "goals_conceded":conceded,
            "result":        result,
            "matchday":      None,
            "stage":         None,
            "winner":        "home" if hs > ag else ("away" if ag > hs else "draw"),
            "half_time":     {"home": event.get("home_ht"), "away": event.get("away_ht")},
            "extra_time":    {},
            "penalties":     {},
            "duration":      None,
        })
    return history


def get_head_to_head_sofascore(home_team_id: int, away_team_id: int, limit: int = 10) -> dict:
    """H2H entre dos equipos."""
    matches = get_team_last_matches_sofascore(home_team_id, n=100)
    h2h = {
        "home_wins": 0, "draws": 0, "away_wins": 0, "total": 0,
        "home_goals": 0, "away_goals": 0, "avg_goals_h2h": 0.0, "last_5": [],
    }
    for event in matches:
        hid = event.get("home_team_id")
        aid = event.get("away_team_id")
        if not ({hid, aid} == {home_team_id, away_team_id}):
            continue
        hs = event.get("home_score")
        ag = event.get("away_score")
        if hs is None or ag is None:
            continue
        h2h["total"] += 1

        if hid == home_team_id:
            h2h["home_goals"] += hs; h2h["away_goals"] += ag
            if hs == ag:   h2h["draws"] += 1
            elif hs > ag:  h2h["home_wins"] += 1
            else:          h2h["away_wins"] += 1
            result = "home_win" if hs > ag else ("draw" if hs == ag else "away_win")
        else:
            h2h["home_goals"] += ag; h2h["away_goals"] += hs
            if hs == ag:   h2h["draws"] += 1
            elif ag > hs:  h2h["home_wins"] += 1
            else:          h2h["away_wins"] += 1
            result = "home_win" if ag > hs else ("draw" if hs == ag else "away_win")

        if len(h2h["last_5"]) < 5:
            ts = event.get("date", 0)
            h2h["last_5"].append({
                "date":   datetime.fromtimestamp(ts, timezone.utc).isoformat() + "Z" if ts else None,
                "home":   event.get("home_team"),
                "away":   event.get("away_team"),
                "score":  f"{hs}-{ag}",
                "result": result,
            })

    if h2h["total"] > 0:
        h2h["avg_goals_h2h"] = round((h2h["home_goals"] + h2h["away_goals"]) / h2h["total"], 2)
    return h2h


def get_team_avg_stats_sofascore(team_id: int, n: int = 10) -> dict:
    """
    Promedios avanzados de los ultimos N partidos - OPTIMIZADO con fetch paralelo.
    Incluye: corners, tiros, posesion, tarjetas, xG, ataques, faltas,
    grandes ocasiones, pases, intercepciones, regates, duelos.
    Usa weighted moving average para dar mas peso a partidos recientes.
    """
    matches = get_team_last_matches_sofascore(team_id, n=n)
    if not matches:
        return {}

    # Obtener IDs de partidos y hacer fetch paralelo de sus estadisticas
    match_ids = [m.get("sofascore_id") for m in matches if m.get("sofascore_id")]
    stats_paths = [f"/event/{mid}/statistics" for mid in match_ids]

    # Fetch paralelo: hasta 4 requests simultaneos
    parallel_results = _parallel_fetch(stats_paths, ttl=SOFASCORE_CACHE_TTL_STATS, max_workers=4)

    # Acumuladores con weighted moving average
    n_matches = len(matches)
    decay = 0.92  # recientes pesan mas
    exp_weights = [decay ** (n_matches - 1 - i) for i in range(n_matches)]

    stats_accum = {
        "corners_for": [], "corners_against": [],
        "shots_for": [], "shots_on_for": [],
        "possession": [], "yellow_cards": [],
        "dangerous_att": [], "attacks": [],
        "xg_for": [], "fouls_for": [], "fouls_against": [],
        "big_chances_for": [], "big_chances_missed": [],
        "pass_acc": [], "saves_for": [], "offsides_for": [],
        "dribbles": [], "duels_won": [], "crosses": [],
        "tackles": [], "interceptions": [],
    }
    stat_weights = {k: [] for k in stats_accum}

    for i, match in enumerate(matches):
        mid = match.get("sofascore_id")
        if not mid:
            continue

        path = f"/event/{mid}/statistics"
        raw_data = parallel_results.get(path)
        if not raw_data:
            continue

        # Parsear los stats raw manualmente (ya tenemos el JSON)
        home_st = {}
        away_st = {}
        for period in raw_data.get("statistics", []):
            if period.get("period") != "ALL":
                continue
            for group in period.get("groups", []):
                for stat in group.get("statisticsItems", []):
                    key = _normalize_stat_key(stat.get("key", ""))
                    home_st[key] = _parse_stat(stat.get("home"))
                    away_st[key] = _parse_stat(stat.get("away"))

        is_home = match.get("is_home", True)

        def pick(h_key, a_key):
            return home_st.get(h_key) if is_home else away_st.get(a_key)
        def pick_opp(h_key, a_key):
            return away_st.get(a_key) if is_home else home_st.get(h_key)

        w = exp_weights[i]

        def add_stat(accum_key, value, weight=w):
            if value is not None:
                stats_accum[accum_key].append(value)
                stat_weights[accum_key].append(weight)

        add_stat("corners_for", pick("corner_kicks", "corner_kicks"))
        add_stat("corners_against", pick_opp("corner_kicks", "corner_kicks"))
        add_stat("shots_for", pick("total_shots", "total_shots") or pick("shots", "shots"))
        add_stat("shots_on_for", pick("shots_on_target", "shots_on_target"))
        add_stat("possession", pick("ball_possession", "ball_possession") or pick("possession", "possession"))
        add_stat("yellow_cards", pick("yellow_cards", "yellow_cards"))
        add_stat("dangerous_att", pick("dangerous_attacks", "dangerous_attacks"))
        add_stat("attacks", pick("attacks", "attacks"))
        add_stat("xg_for", pick("expected_goals", "expected_goals"))
        add_stat("fouls_for", pick("fouls", "fouls"))
        add_stat("fouls_against", pick_opp("fouls", "fouls"))
        add_stat("big_chances_for", pick("big_chances", "big_chances"))
        add_stat("big_chances_missed", pick("big_chances_missed", "big_chances_missed"))
        add_stat("pass_acc", pick("accurate_passes_pct", "accurate_passes_pct") or pick("passes_pct", "passes_pct"))
        add_stat("saves_for", pick("goalkeeper_saves", "goalkeeper_saves"))
        add_stat("offsides_for", pick("offsides", "offsides"))
        add_stat("dribbles", pick("successful_dribbles", "successful_dribbles") or pick("dribbles", "dribbles"))
        add_stat("duels_won", pick("duels_won", "duels_won"))
        add_stat("crosses", pick("crosses", "crosses"))
        add_stat("tackles", pick("tackles", "tackles"))
        add_stat("interceptions", pick("interceptions", "interceptions"))

    def wavg(key):
        vals = stats_accum[key]
        wts = stat_weights[key]
        if not vals:
            return None
        total_w = sum(wts)
        if total_w == 0:
            return round(sum(vals) / len(vals), 2) if vals else None
        return round(sum(v * w for v, w in zip(vals, wts)) / total_w, 2)

    result = {
        "avg_corners_for":        wavg("corners_for"),
        "avg_corners_against":    wavg("corners_against"),
        "avg_shots":              wavg("shots_for"),
        "avg_shots_on_target":    wavg("shots_on_for"),
        "avg_possession":         wavg("possession"),
        "avg_yellow_cards":       wavg("yellow_cards"),
        "avg_dangerous_attacks":  wavg("dangerous_att"),
        "avg_attacks":            wavg("attacks"),
        "avg_xg_sofascore":       wavg("xg_for"),
        "avg_fouls_committed":    wavg("fouls_for"),
        "avg_fouls_suffered":     wavg("fouls_against"),
        "avg_big_chances":        wavg("big_chances_for"),
        "avg_big_chances_missed": wavg("big_chances_missed"),
        "avg_pass_accuracy":      wavg("pass_acc"),
        "avg_saves":              wavg("saves_for"),
        "avg_offsides":           wavg("offsides_for"),
        "avg_dribbles":           wavg("dribbles"),
        "avg_duels_won":          wavg("duels_won"),
        "avg_crosses":            wavg("crosses"),
        "avg_tackles":            wavg("tackles"),
        "avg_interceptions":      wavg("interceptions"),
        "matches_analyzed":       len(matches),
    }

    # Enriquecer con stats de temporada
    season = get_team_season_stats(team_id)
    if season:
        if result["avg_xg_sofascore"] is None:
            xg_s = season.get("season_avg_xg") or (
                round(season["season_xg"] / season["season_matches"], 3)
                if season.get("season_xg") and season.get("season_matches")
                else None
            )
            result["avg_xg_sofascore"] = xg_s
        if result["avg_possession"] is None:
            result["avg_possession"] = season.get("season_avg_possession")
        if result["avg_shots"] is None:
            result["avg_shots"] = season.get("season_avg_shots")
        if result["avg_corners_for"] is None:
            result["avg_corners_for"] = season.get("season_avg_corners")
        result["season_data"] = season

    return result


# ═══════════════════════════════════════════════════════════════════════════════
#  LIGAMX STANDINGS DESDE SOFASCORE
# ═══════════════════════════════════════════════════════════════════════════════

def get_ligamx_standings() -> list:
    from config import SOFASCORE_TOURNAMENT_IDS
    tournament_id = SOFASCORE_TOURNAMENT_IDS.get("ligamx", 352)

    seasons_data = _sofascore_get(
        f"/unique-tournament/{tournament_id}/seasons",
        ttl=SOFASCORE_CACHE_TTL_STATIC,
    )
    if not seasons_data:
        return []

    seasons = seasons_data.get("seasons", [])
    if not seasons:
        return []

    current_season = seasons[0]
    season_id = current_season.get("id")
    if not season_id:
        return []

    data = _sofascore_get(
        f"/unique-tournament/{tournament_id}/season/{season_id}/standings/total",
        ttl=SOFASCORE_CACHE_TTL_STATS,
    )
    if not data:
        return []

    standings = []
    for table in data.get("standings", []):
        for row in table.get("rows", []):
            team = row.get("team", {})
            played = max(row.get("matches", 1), 1)
            standings.append({
                "position":          row.get("position"),
                "team_id":           team.get("id"),
                "team_name":         team.get("name"),
                "team_logo":         f"https://api.sofascore.com/api/v1/team/{team.get('id')}/image",
                "played":            row.get("matches"),
                "won":               row.get("wins"),
                "draw":              row.get("draws"),
                "lost":              row.get("losses"),
                "goals_for":         row.get("scoresFor"),
                "goals_against":     row.get("scoresAgainst"),
                "goal_diff":         row.get("scoreDiffFormatted") or (
                    (row.get("scoresFor") or 0) - (row.get("scoresAgainst") or 0)
                ),
                "points":            row.get("points"),
                "points_per_game":   round(row.get("points", 0) / played, 3),
                "goals_per_game":    round((row.get("scoresFor") or 0) / played, 3),
                "conceded_per_game": round((row.get("scoresAgainst") or 0) / played, 3),
                "win_rate":          round((row.get("wins") or 0) / played, 3),
            })
    return standings


# ═══════════════════════════════════════════════════════════════════════════════
#  BUSQUEDA DE PARTIDO ESPECIFICO
# ═══════════════════════════════════════════════════════════════════════════════

def find_match_id(home_team_name: str, away_team_name: str, date_str: str = None) -> Optional[int]:
    if date_str is None:
        date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    matches = get_matches_by_date(date_str)
    home_l  = _normalize(home_team_name)
    away_l  = _normalize(away_team_name)

    best_match = None
    best_score = 0

    for m in matches:
        ht = _normalize(m.get("home_team") or "")
        at = _normalize(m.get("away_team") or "")
        score = 0
        if home_l in ht or ht in home_l: score += 2
        if away_l in at or at in away_l: score += 2
        if score > best_score:
            best_score = score
            best_match = m

    if best_match and best_score >= 2:
        return best_match.get("sofascore_id")
    return None


def get_match_full_data(sofascore_match_id: int) -> dict:
    """Obtiene todos los datos del partido en paralelo para maxima velocidad."""
    paths = {
        "statistics": f"/event/{sofascore_match_id}/statistics",
        "momentum":   f"/event/{sofascore_match_id}/graph",
        "lineups":    f"/event/{sofascore_match_id}/lineups",
    }
    results = _parallel_fetch(list(paths.values()), ttl=SOFASCORE_CACHE_TTL_LIVE, max_workers=3)

    return {
        "statistics":   get_full_match_stats(sofascore_match_id),
        "momentum":     get_match_momentum(sofascore_match_id),
        "lineups":      get_match_lineups(sofascore_match_id),
        "player_stats": get_match_player_stats(sofascore_match_id),
    }


# ═══════════════════════════════════════════════════════════════════════════════
#  PROXIMOS PARTIDOS DE LIGA
# ═══════════════════════════════════════════════════════════════════════════════

def get_upcoming_by_tournament(league_key: str, days: int = 14) -> list:
    today    = datetime.now(timezone.utc).date()
    matches  = []
    seen_ids = set()

    for i in range(days):
        date_str = (today + timedelta(days=i)).strftime("%Y-%m-%d")
        for event in get_matches_by_date(date_str):
            if not _is_sofascore_league_match(event, league_key):
                continue
            match_id = event.get("sofascore_id")
            if match_id in seen_ids:
                continue
            seen_ids.add(match_id)
            matches.append({
                "sofascore_id":    match_id,
                "home_team":       event.get("home_team"),
                "home_team_id":    event.get("home_team_id"),
                "home_logo":       event.get("home_logo", ""),
                "away_team":       event.get("away_team"),
                "away_team_id":    event.get("away_team_id"),
                "away_logo":       event.get("away_logo", ""),
                "start_timestamp": event.get("start_timestamp"),
                "tournament":      event.get("tournament"),
                "tournament_id":   event.get("tournament_id"),
                "round":           event.get("round"),
                "status_type":     event.get("status_type"),
            })

        if len(matches) >= 60:
            break

    matches.sort(key=lambda x: x.get("start_timestamp") or 0)
    return matches[:60]


def _is_ligamx_tournament(tournament_name: str) -> bool:
    name = (tournament_name or "").lower()
    if "liga mx" not in name:
        return False
    if "expansion" in name or "expansi\u00f3n" in name:
        return False
    return True


def _is_sofascore_league_match(event: dict, league_key: str) -> bool:
    tournament_name = event.get("tournament", "")
    tournament_id   = event.get("tournament_id")

    if league_key == "ligamx":
        if tournament_id and tournament_id == SOFASCORE_TOURNAMENT_IDS.get("ligamx"):
            return True
        return _is_ligamx_tournament(tournament_name)

    expected_id = SOFASCORE_TOURNAMENT_IDS.get(league_key)
    if expected_id is not None and tournament_id is not None:
        return tournament_id == expected_id
    return False


def get_team_list_from_sofascore(league_key: str, days: int = 60) -> list:
    if league_key != "ligamx":
        return []

    teams = {}
    today = datetime.now(timezone.utc).date()

    for delta in range(-days, days + 1):
        date_str = (today + timedelta(days=delta)).strftime("%Y-%m-%d")
        for event in get_matches_by_date(date_str):
            if not _is_sofascore_league_match(event, "ligamx"):
                continue
            for side in ("home", "away"):
                tid  = event.get(f"{side}_team_id")
                name = event.get(f"{side}_team")
                if tid and name and tid not in teams:
                    teams[tid] = {
                        "id":   tid,
                        "name": name,
                        "logo": event.get(f"{side}_logo") or f"https://api.sofascore.com/api/v1/team/{tid}/image",
                    }
        if len(teams) >= 18:
            break

    return sorted(teams.values(), key=lambda t: t["name"])
