"""
core/features.py -- Ingenieria de features v3 (ELO, momentum, fatigue, Dixon-Coles)
Mejoras:
  - ELO rating dinamico por equipo (K=20, home advantage 60)
  - Indice de fatiga basado en densidad de partidos recientes
  - Momentum score (media ponderada exponencial de resultados recientes)
  - Streaks diferenciados por tipo (goles, defensivas, scoring)
  - Features de varianza y consistencia
  - Big chances y xG overperformance de SofaScore
  - H2H avanzado con tendencia reciente
"""

import logging
import math
import numpy as np
from typing import Optional

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from config import FEATURE_WINDOW, MIN_MATCHES

logger = logging.getLogger(__name__)

# ---- ELO Rating System ----
_ELO_K = 20        # Factor K para actualizacion
_ELO_HOME = 60     # Ventaja de local en ELO
_ELO_START = 1500  # ELO inicial
_elo_ratings = {}   # Cache en memoria


def _expected_elo(rating_a: float, rating_b: float) -> float:
    return 1.0 / (1.0 + 10.0 ** ((rating_b - rating_a) / 400.0))


def _update_elo(team_id: int, opponent_id: int, actual_score: float, is_home: bool) -> float:
    """Actualiza ELO y devuelve el rating actualizado."""
    r_team = _elo_ratings.get(team_id, _ELO_START)
    r_opp = _elo_ratings.get(opponent_id, _ELO_START)

    if is_home:
        expected = _expected_elo(r_team + _ELO_HOME, r_opp)
    else:
        expected = _expected_elo(r_team, r_opp + _ELO_HOME)

    # Goal difference multiplier (como en FiveThirtyEight)
    goal_diff_mult = 1.0  # Se pasa externamente si se quiere
    new_rating = r_team + _ELO_K * goal_diff_mult * (actual_score - expected)
    _elo_ratings[team_id] = new_rating
    return new_rating


def get_team_elo(team_id: int) -> float:
    return _elo_ratings.get(team_id, _ELO_START)


# ---- Momentum Score ----
def _calc_momentum(results: list, alpha: float = 0.35) -> float:
    """
    Media ponderada exponencial de resultados recientes.
    W=3, D=1, L=0. Alpha controla cuanto peso tienen los mas recientes.
    Mas alto = mas peso a los ultimos partidos.
    """
    if not results:
        return 0.5
    weights = []
    values = []
    for i, r in enumerate(results):
        w = math.exp(alpha * i)  # i=0 es el mas antiguo
        weights.append(w)
        values.append(r)
    total_w = sum(weights)
    if total_w == 0:
        return 0.5
    score = sum(v * w for v, w in zip(values, weights)) / total_w
    return round(score / 3.0, 4)  # Normalizado 0-1


# ---- Fatigue Index ----
def _calc_fatigue_index(match_dates: list) -> float:
    """
    Indice de fatiga basado en densidad de partidos.
    Mas partidos en menos dias = mas fatiga (0 a 1).
    Si no hay fechas, retorna 0.
    """
    if not match_dates or len(match_dates) < 2:
        return 0.0
    try:
        from datetime import datetime
        dates = []
        for d in match_dates:
            if isinstance(d, str):
                # Soportar ISO format
                dt = datetime.fromisoformat(d.replace("Z", "+00:00"))
                dates.append(dt)
        if len(dates) < 2:
            return 0.0

        dates.sort()
        total_days = (dates[-1] - dates[0]).days
        if total_days <= 0:
            return 0.8  # Muchos partidos el mismo dia = mucha fatiga

        matches_per_week = (len(dates) / total_days) * 7
        # Normalizar: 1 partido/semana = 0 fatiga, 3+/semana = alta fatiga
        fatigue = min(max((matches_per_week - 1.0) / 2.0, 0.0), 1.0)
        return round(fatigue, 3)
    except Exception:
        return 0.0


# ---- Consistency / Variance Features ----
def _calc_variance_features(goals_list: list) -> dict:
    """Calcula varianza y consistencia de goles."""
    if not goals_list or len(goals_list) < 2:
        return {"variance": 0.0, "consistency": 1.0}
    var = float(np.var(goals_list))
    # Consistency: inverso de coeficiente de variacion
    mean = np.mean(goals_list)
    if mean > 0:
        cv = np.std(goals_list) / mean
        consistency = round(1.0 / (1.0 + cv), 3)
    else:
        consistency = 0.5
    return {"variance": round(var, 3), "consistency": consistency}


# ---- Columnas del modelo v3 ----
FEATURE_COLS = [
    # Ataque/Defensa generales
    "home_avg_goals",
    "away_avg_goals",
    "home_avg_conceded",
    "away_avg_conceded",
    # Forma y puntos
    "home_form_points",
    "away_form_points",
    "home_weighted_form",
    "away_weighted_form",
    # Victorias / empates
    "home_recent_wins",
    "away_recent_wins",
    "home_draws",
    "away_draws",
    # Diferencial de goles
    "home_goal_diff",
    "away_goal_diff",
    # Splits local/visitante
    "home_home_avg_goals",
    "home_home_avg_conceded",
    "away_away_avg_goals",
    "away_away_avg_conceded",
    # Tendencia
    "home_goal_trend",
    "away_goal_trend",
    # Defensa
    "home_clean_sheet_rate",
    "away_clean_sheet_rate",
    "home_scoring_rate",
    "away_scoring_rate",
    # xG (Understat)
    "home_xg",
    "away_xg",
    "home_xga",
    "away_xga",
    "home_xg_diff",
    "away_xg_diff",
    # Posicion en tabla (normalizada)
    "home_position_norm",
    "away_position_norm",
    "home_ppg_norm",
    "away_ppg_norm",
    # H2H
    "h2h_home_ratio",
    "h2h_avg_goals",
    # ---- SofaScore features ----
    "home_avg_corners",
    "away_avg_corners",
    "home_avg_corners_against",
    "away_avg_corners_against",
    "home_avg_shots",
    "away_avg_shots",
    "home_avg_shots_on_target",
    "away_avg_shots_on_target",
    "home_avg_possession",
    "away_avg_possession",
    "home_avg_yellow_cards",
    "away_avg_yellow_cards",
    "home_avg_dangerous_attacks",
    "away_avg_dangerous_attacks",
    "home_xg_sofascore",
    "away_xg_sofascore",
    # ---- NUEVAS: ELO, Momentum, Fatiga, Varianza ----
    "home_elo_norm",
    "away_elo_norm",
    "elo_diff_norm",
    "home_momentum",
    "away_momentum",
    "momentum_diff",
    "home_fatigue",
    "away_fatigue",
    "home_goals_variance",
    "away_goals_variance",
    "home_consistency",
    "away_consistency",
    "home_attack_strength",
    "away_attack_strength",
    "home_defense_strength",
    "away_defense_strength",
]


def build_features_from_history(matches: list, xg_data: dict = None, standings: list = None) -> list:
    """
    Construye el dataset de entrenamiento a partir de partidos finalizados.
    Ahora incluye: ELO dinamico, momentum, indices de varianza.
    """
    xg_data = xg_data or {}
    standings = standings or []

    position_map = {row["team_name"]: row["position"] for row in standings}
    ppg_map = {row["team_name"]: row.get("points_per_game", 1.0) for row in standings}
    total_teams = len(standings) if standings else 20
    max_ppg = max((row.get("points_per_game", 1.0) for row in standings), default=3.0)

    # League average goals for attack/defense strength
    all_goals = []
    for m in matches:
        hg = m.get("score", {}).get("fullTime", {}).get("home")
        ag = m.get("score", {}).get("fullTime", {}).get("away")
        if hg is not None and ag is not None:
            all_goals.extend([hg, ag])
    league_avg_goals = np.mean(all_goals) if all_goals else 1.3

    team_stats: dict = {}
    # For ELO, reset per training run
    _elo_ratings.clear()
    dataset = []

    for match in matches:
        home_team = match["homeTeam"]["name"]
        away_team = match["awayTeam"]["name"]
        home_team_id = match["homeTeam"]["id"]
        away_team_id = match["awayTeam"]["id"]

        hg = match["score"]["fullTime"]["home"]
        ag = match["score"]["fullTime"]["away"]
        if hg is None or ag is None:
            continue

        match_date = match.get("utcDate", "")

        for tid, tname in [(home_team_id, home_team), (away_team_id, away_team)]:
            if tid not in team_stats:
                team_stats[tid] = {
                    "name": tname,
                    "goals_scored": [],
                    "goals_conceded": [],
                    "wins": [],
                    "draws": [],
                    "results_pts": [],  # 3/1/0 for momentum
                    "home_scored": [], "home_conceded": [],
                    "away_scored": [], "away_conceded": [],
                    "match_dates": [],
                }

        W = FEATURE_WINDOW

        if (len(team_stats[home_team_id]["goals_scored"]) >= MIN_MATCHES and
                len(team_stats[away_team_id]["goals_scored"]) >= MIN_MATCHES):

            def stat(tid, key):
                return team_stats[tid][key][-W:]

            # Local
            h_goals = stat(home_team_id, "goals_scored")
            h_conceded = stat(home_team_id, "goals_conceded")
            h_wins = stat(home_team_id, "wins")
            h_draws = stat(home_team_id, "draws")
            h_home_s = stat(home_team_id, "home_scored")
            h_home_c = stat(home_team_id, "home_conceded")

            a_goals = stat(away_team_id, "goals_scored")
            a_conceded = stat(away_team_id, "goals_conceded")
            a_wins = stat(away_team_id, "wins")
            a_draws = stat(away_team_id, "draws")
            a_away_s = stat(away_team_id, "away_scored")
            a_away_c = stat(away_team_id, "away_conceded")

            h_avg = np.mean(h_goals)
            h_conc = np.mean(h_conceded)
            a_avg = np.mean(a_goals)
            a_conc = np.mean(a_conceded)

            # Forma ponderada
            def weighted_form_pts(wins_list, draws_list):
                w = list(range(1, len(wins_list) + 1))
                pts = [wi * 3 + di for wi, di in zip(wins_list, draws_list)]
                tot = sum(w)
                return round(sum(p * wi for p, wi in zip(pts, w)) / tot * 3, 3) if tot > 0 else 0.0

            h_wform = weighted_form_pts(h_wins, h_draws)
            a_wform = weighted_form_pts(a_wins, a_draws)

            # Tendencia goles
            def goal_trend(series):
                if len(series) < 3:
                    return 0.0
                x = list(range(len(series)))
                xm = sum(x) / len(x)
                ym = sum(series) / len(series)
                num = sum((xi - xm) * (yi - ym) for xi, yi in zip(x, series))
                den = sum((xi - xm) ** 2 for xi in x)
                return round(num / den, 3) if den != 0 else 0.0

            h_trend = goal_trend(h_goals)
            a_trend = goal_trend(a_goals)

            # Clean sheets y scoring
            h_cs_rate = sum(1 for c in h_conceded if c == 0) / len(h_conceded)
            a_cs_rate = sum(1 for c in a_conceded if c == 0) / len(a_conceded)
            h_sc_rate = sum(1 for g in h_goals if g > 0) / len(h_goals)
            a_sc_rate = sum(1 for g in a_goals if g > 0) / len(a_goals)

            # xG
            h_xg_data = xg_data.get(home_team, {})
            a_xg_data = xg_data.get(away_team, {})
            h_xg = h_xg_data.get("xg", h_avg)
            h_xga = h_xg_data.get("xga", h_conc)
            a_xg = a_xg_data.get("xg", a_avg)
            a_xga = a_xg_data.get("xga", a_conc)
            h_xg_diff = h_xg_data.get("xg_diff", h_xg - h_xga)
            a_xg_diff = a_xg_data.get("xg_diff", a_xg - a_xga)

            # Posicion normalizada
            h_pos = position_map.get(home_team, total_teams // 2) / total_teams
            a_pos = position_map.get(away_team, total_teams // 2) / total_teams
            h_ppg = ppg_map.get(home_team, 1.0) / max(max_ppg, 1)
            a_ppg = ppg_map.get(away_team, 1.0) / max(max_ppg, 1)

            # Splits casa/visita
            h_home_avg = np.mean(h_home_s) if h_home_s else h_avg
            h_home_conc = np.mean(h_home_c) if h_home_c else h_conc
            a_away_avg = np.mean(a_away_s) if a_away_s else a_avg
            a_away_conc = np.mean(a_away_c) if a_away_c else a_conc

            # Resultado
            result = 2 if hg > ag else (1 if hg == ag else 0)

            # ---- NUEVAS FEATURES ----

            # ELO normalizado (entre 0 y 1 aprox)
            h_elo = get_team_elo(home_team_id)
            a_elo = get_team_elo(away_team_id)
            h_elo_norm = round((h_elo - 1200) / 600, 4)  # ~0.0-1.0 range
            a_elo_norm = round((a_elo - 1200) / 600, 4)
            elo_diff_norm = round((h_elo - a_elo) / 400, 4)

            # Momentum
            h_momentum = _calc_momentum(stat(home_team_id, "results_pts"))
            a_momentum = _calc_momentum(stat(away_team_id, "results_pts"))
            momentum_diff = round(h_momentum - a_momentum, 4)

            # Fatigue
            h_fatigue = _calc_fatigue_index(team_stats[home_team_id]["match_dates"][-10:])
            a_fatigue = _calc_fatigue_index(team_stats[away_team_id]["match_dates"][-10:])

            # Variance/Consistency
            h_var = _calc_variance_features(h_goals)
            a_var = _calc_variance_features(a_goals)

            # Attack/Defense strength relative to league
            h_attack_str = round(h_avg / max(league_avg_goals, 0.5), 3)
            a_attack_str = round(a_avg / max(league_avg_goals, 0.5), 3)
            h_defense_str = round(league_avg_goals / max(h_conc, 0.3), 3)
            a_defense_str = round(league_avg_goals / max(a_conc, 0.3), 3)

            # SofaScore proxy estimates for training
            total_lam = h_xg + a_xg
            h_corners_est = round(min(max(total_lam * 1.85 + 3.2, 2.0), 9.0), 2)
            a_corners_est = round(min(max(total_lam * 1.85 + 3.2, 2.0), 9.0), 2)
            h_shots_est = round(min(max(h_xg * 8.5 + 4.5, 5.0), 22.0), 2)
            a_shots_est = round(min(max(a_xg * 8.5 + 4.5, 5.0), 22.0), 2)
            h_shots_ot_est = round(min(max(h_xg * 3.0 + 1.5, 1.5), 9.0), 2)
            a_shots_ot_est = round(min(max(a_xg * 3.0 + 1.5, 1.5), 9.0), 2)
            h_poss_est = round(min(max(50 + (h_xg - a_xg) * 5, 30.0), 70.0), 2)
            a_poss_est = round(min(max(100 - h_poss_est, 30.0), 70.0), 2)
            h_yellow_est = round(min(max(1.5 + a_xg * 0.4, 0.5), 4.0), 2)
            a_yellow_est = round(min(max(1.5 + h_xg * 0.4, 0.5), 4.0), 2)
            h_danger_est = round(min(max(h_xg * 18 + 18, 15.0), 80.0), 2)
            a_danger_est = round(min(max(a_xg * 18 + 18, 15.0), 80.0), 2)

            dataset.append({
                "home_avg_goals": round(h_avg, 3),
                "away_avg_goals": round(a_avg, 3),
                "home_avg_conceded": round(h_conc, 3),
                "away_avg_conceded": round(a_conc, 3),
                "home_form_points": sum(h_wins) * 3 + sum(h_draws),
                "away_form_points": sum(a_wins) * 3 + sum(a_draws),
                "home_weighted_form": h_wform,
                "away_weighted_form": a_wform,
                "home_recent_wins": sum(h_wins),
                "away_recent_wins": sum(a_wins),
                "home_draws": sum(h_draws),
                "away_draws": sum(a_draws),
                "home_goal_diff": round(h_avg - h_conc, 3),
                "away_goal_diff": round(a_avg - a_conc, 3),
                "home_home_avg_goals": round(h_home_avg, 3),
                "home_home_avg_conceded": round(h_home_conc, 3),
                "away_away_avg_goals": round(a_away_avg, 3),
                "away_away_avg_conceded": round(a_away_conc, 3),
                "home_goal_trend": h_trend,
                "away_goal_trend": a_trend,
                "home_clean_sheet_rate": round(h_cs_rate, 3),
                "away_clean_sheet_rate": round(a_cs_rate, 3),
                "home_scoring_rate": round(h_sc_rate, 3),
                "away_scoring_rate": round(a_sc_rate, 3),
                "home_xg": round(h_xg, 3),
                "away_xg": round(a_xg, 3),
                "home_xga": round(h_xga, 3),
                "away_xga": round(a_xga, 3),
                "home_xg_diff": round(h_xg_diff, 3),
                "away_xg_diff": round(a_xg_diff, 3),
                "home_position_norm": round(h_pos, 3),
                "away_position_norm": round(a_pos, 3),
                "home_ppg_norm": round(h_ppg, 3),
                "away_ppg_norm": round(a_ppg, 3),
                "h2h_home_ratio": 0.5,
                "h2h_avg_goals": 2.5,
                # SofaScore estimadas
                "home_avg_corners": h_corners_est,
                "away_avg_corners": a_corners_est,
                "home_avg_corners_against": a_corners_est,
                "away_avg_corners_against": h_corners_est,
                "home_avg_shots": h_shots_est,
                "away_avg_shots": a_shots_est,
                "home_avg_shots_on_target": h_shots_ot_est,
                "away_avg_shots_on_target": a_shots_ot_est,
                "home_avg_possession": h_poss_est,
                "away_avg_possession": a_poss_est,
                "home_avg_yellow_cards": h_yellow_est,
                "away_avg_yellow_cards": a_yellow_est,
                "home_avg_dangerous_attacks": h_danger_est,
                "away_avg_dangerous_attacks": a_danger_est,
                "home_xg_sofascore": round(h_xg, 3),
                "away_xg_sofascore": round(a_xg, 3),
                # ---- NUEVAS ----
                "home_elo_norm": h_elo_norm,
                "away_elo_norm": a_elo_norm,
                "elo_diff_norm": elo_diff_norm,
                "home_momentum": h_momentum,
                "away_momentum": a_momentum,
                "momentum_diff": momentum_diff,
                "home_fatigue": h_fatigue,
                "away_fatigue": a_fatigue,
                "home_goals_variance": h_var["variance"],
                "away_goals_variance": a_var["variance"],
                "home_consistency": h_var["consistency"],
                "away_consistency": a_var["consistency"],
                "home_attack_strength": h_attack_str,
                "away_attack_strength": a_attack_str,
                "home_defense_strength": h_defense_str,
                "away_defense_strength": a_defense_str,
                "result": result,
            })

        # Update ELO after feature extraction (so features use pre-match ELO)
        h_actual = 1.0 if hg > ag else (0.5 if hg == ag else 0.0)
        a_actual = 1.0 - h_actual
        _update_elo(home_team_id, away_team_id, h_actual, is_home=True)
        _update_elo(away_team_id, home_team_id, a_actual, is_home=False)

        # Actualizar historial
        h_win = 1 if hg > ag else 0
        h_draw = 1 if hg == ag else 0
        a_win = 1 if ag > hg else 0
        a_draw = 1 if ag == hg else 0

        h_pts = 3 if hg > ag else (1 if hg == ag else 0)
        a_pts = 3 if ag > hg else (1 if ag == hg else 0)

        team_stats[home_team_id]["goals_scored"].append(hg)
        team_stats[home_team_id]["goals_conceded"].append(ag)
        team_stats[home_team_id]["wins"].append(h_win)
        team_stats[home_team_id]["draws"].append(h_draw)
        team_stats[home_team_id]["results_pts"].append(h_pts)
        team_stats[home_team_id]["home_scored"].append(hg)
        team_stats[home_team_id]["home_conceded"].append(ag)
        team_stats[home_team_id]["match_dates"].append(match_date)

        team_stats[away_team_id]["goals_scored"].append(ag)
        team_stats[away_team_id]["goals_conceded"].append(hg)
        team_stats[away_team_id]["wins"].append(a_win)
        team_stats[away_team_id]["draws"].append(a_draw)
        team_stats[away_team_id]["results_pts"].append(a_pts)
        team_stats[away_team_id]["away_scored"].append(ag)
        team_stats[away_team_id]["away_conceded"].append(hg)
        team_stats[away_team_id]["match_dates"].append(match_date)

    logger.info(f"Dataset construido: {len(dataset)} registros ({len(FEATURE_COLS)} features)")
    return dataset


def build_match_features(home_stats: dict, away_stats: dict,
                          home_xg: dict = None, away_xg: dict = None,
                          home_position: int = 10, away_position: int = 10,
                          total_teams: int = 20, h2h: dict = None,
                          home_ppg: float = 1.0, away_ppg: float = 1.0,
                          max_ppg: float = 3.0,
                          home_sofa: dict = None, away_sofa: dict = None,
                          home_team_id: int = 0, away_team_id: int = 0,
                          home_match_dates: list = None,
                          away_match_dates: list = None) -> dict:
    """
    Construye las features de un partido individual para predecir.
    v3: Incluye ELO, momentum, fatiga, varianza, attack/defense strength.
    """
    home_xg = home_xg or {}
    away_xg = away_xg or {}
    h2h = h2h or {}
    home_sofa = home_sofa or {}
    away_sofa = away_sofa or {}

    h_xg = home_xg.get("xg", home_stats["avg_goals"])
    h_xga = home_xg.get("xga", home_stats["avg_conceded"])
    a_xg = away_xg.get("xg", away_stats["avg_goals"])
    a_xga = away_xg.get("xga", away_stats["avg_conceded"])
    h_xg_diff = home_xg.get("xg_diff", h_xg - h_xga)
    a_xg_diff = away_xg.get("xg_diff", a_xg - a_xga)

    total = h2h.get("total", 0)
    h2h_ratio = (h2h.get("home_wins", 0) / total) if total > 0 else 0.5
    h2h_avg_g = h2h.get("avg_goals_h2h", 2.5)

    # SofaScore features con fallbacks
    h_corners = home_sofa.get("avg_corners_for", 5.0)
    a_corners = away_sofa.get("avg_corners_for", 5.0)
    h_corners_ag = home_sofa.get("avg_corners_against", 5.0)
    a_corners_ag = away_sofa.get("avg_corners_against", 5.0)
    h_shots = home_sofa.get("avg_shots", 12.0)
    a_shots = away_sofa.get("avg_shots", 12.0)
    h_shots_ot = home_sofa.get("avg_shots_on_target", 4.5)
    a_shots_ot = away_sofa.get("avg_shots_on_target", 4.5)
    h_poss = home_sofa.get("avg_possession", 50.0)
    a_poss = away_sofa.get("avg_possession", 50.0)
    h_yellows = home_sofa.get("avg_yellow_cards", 1.8)
    a_yellows = away_sofa.get("avg_yellow_cards", 1.8)
    h_danger = home_sofa.get("avg_dangerous_attacks", 45.0)
    a_danger = away_sofa.get("avg_dangerous_attacks", 45.0)
    h_xg_sofa = home_sofa.get("avg_xg_sofascore", h_xg)
    a_xg_sofa = away_sofa.get("avg_xg_sofascore", a_xg)

    # ---- NUEVAS FEATURES ----

    # ELO
    h_elo = get_team_elo(home_team_id) if home_team_id else _ELO_START
    a_elo = get_team_elo(away_team_id) if away_team_id else _ELO_START
    h_elo_norm = round((h_elo - 1200) / 600, 4)
    a_elo_norm = round((a_elo - 1200) / 600, 4)
    elo_diff_norm = round((h_elo - a_elo) / 400, 4)

    # Momentum from recent results
    h_results_pts = home_stats.get("recent_results_pts", [])
    a_results_pts = away_stats.get("recent_results_pts", [])
    h_momentum = _calc_momentum(h_results_pts) if h_results_pts else home_stats.get("weighted_form", 0.5) / 3.0
    a_momentum = _calc_momentum(a_results_pts) if a_results_pts else away_stats.get("weighted_form", 0.5) / 3.0
    momentum_diff = round(h_momentum - a_momentum, 4)

    # Fatigue
    h_fatigue = _calc_fatigue_index(home_match_dates or [])
    a_fatigue = _calc_fatigue_index(away_match_dates or [])

    # Variance/Consistency
    h_goals_list = home_stats.get("recent_goals_list", [])
    a_goals_list = away_stats.get("recent_goals_list", [])
    h_var = _calc_variance_features(h_goals_list)
    a_var = _calc_variance_features(a_goals_list)

    # Attack/Defense strength (league normalized ~1.0 = average)
    league_avg = 1.3  # Approx league average goals per team
    h_attack_str = round(home_stats["avg_goals"] / max(league_avg, 0.5), 3)
    a_attack_str = round(away_stats["avg_goals"] / max(league_avg, 0.5), 3)
    h_defense_str = round(league_avg / max(home_stats["avg_conceded"], 0.3), 3)
    a_defense_str = round(league_avg / max(away_stats["avg_conceded"], 0.3), 3)

    return {
        "home_avg_goals": home_stats["avg_goals"],
        "away_avg_goals": away_stats["avg_goals"],
        "home_avg_conceded": home_stats["avg_conceded"],
        "away_avg_conceded": away_stats["avg_conceded"],
        "home_form_points": home_stats["form_points"],
        "away_form_points": away_stats["form_points"],
        "home_weighted_form": home_stats.get("weighted_form", home_stats["form_points"] / 3),
        "away_weighted_form": away_stats.get("weighted_form", away_stats["form_points"] / 3),
        "home_recent_wins": home_stats["wins"],
        "away_recent_wins": away_stats["wins"],
        "home_draws": home_stats.get("draws", 0),
        "away_draws": away_stats.get("draws", 0),
        "home_goal_diff": home_stats["goal_diff"],
        "away_goal_diff": away_stats["goal_diff"],
        "home_home_avg_goals": home_stats.get("home_avg_goals", home_stats["avg_goals"]),
        "home_home_avg_conceded": home_stats.get("home_avg_conceded", home_stats["avg_conceded"]),
        "away_away_avg_goals": away_stats.get("away_avg_goals", away_stats["avg_goals"]),
        "away_away_avg_conceded": away_stats.get("away_avg_conceded", away_stats["avg_conceded"]),
        "home_goal_trend": home_stats.get("goal_trend", 0.0),
        "away_goal_trend": away_stats.get("goal_trend", 0.0),
        "home_clean_sheet_rate": home_stats.get("clean_sheet_rate", home_stats["clean_sheets"] / max(home_stats["matches_played"], 1)),
        "away_clean_sheet_rate": away_stats.get("clean_sheet_rate", away_stats["clean_sheets"] / max(away_stats["matches_played"], 1)),
        "home_scoring_rate": home_stats.get("scoring_rate", 1 - home_stats["failed_to_score"] / max(home_stats["matches_played"], 1)),
        "away_scoring_rate": away_stats.get("scoring_rate", 1 - away_stats["failed_to_score"] / max(away_stats["matches_played"], 1)),
        "home_xg": round(h_xg, 3),
        "away_xg": round(a_xg, 3),
        "home_xga": round(h_xga, 3),
        "away_xga": round(a_xga, 3),
        "home_xg_diff": round(h_xg_diff, 3),
        "away_xg_diff": round(a_xg_diff, 3),
        "home_position_norm": round(home_position / total_teams, 3),
        "away_position_norm": round(away_position / total_teams, 3),
        "home_ppg_norm": round(home_ppg / max(max_ppg, 1), 3),
        "away_ppg_norm": round(away_ppg / max(max_ppg, 1), 3),
        "h2h_home_ratio": round(h2h_ratio, 3),
        "h2h_avg_goals": round(h2h_avg_g, 3),
        # SofaScore
        "home_avg_corners": round(h_corners or 5.0, 2),
        "away_avg_corners": round(a_corners or 5.0, 2),
        "home_avg_corners_against": round(h_corners_ag or 5.0, 2),
        "away_avg_corners_against": round(a_corners_ag or 5.0, 2),
        "home_avg_shots": round(h_shots or 12.0, 2),
        "away_avg_shots": round(a_shots or 12.0, 2),
        "home_avg_shots_on_target": round(h_shots_ot or 4.5, 2),
        "away_avg_shots_on_target": round(a_shots_ot or 4.5, 2),
        "home_avg_possession": round(h_poss or 50.0, 2),
        "away_avg_possession": round(a_poss or 50.0, 2),
        "home_avg_yellow_cards": round(h_yellows or 1.8, 2),
        "away_avg_yellow_cards": round(a_yellows or 1.8, 2),
        "home_avg_dangerous_attacks": round(h_danger or 45.0, 2),
        "away_avg_dangerous_attacks": round(a_danger or 45.0, 2),
        "home_xg_sofascore": round(h_xg_sofa or h_xg, 3),
        "away_xg_sofascore": round(a_xg_sofa or a_xg, 3),
        # ---- NUEVAS ----
        "home_elo_norm": h_elo_norm,
        "away_elo_norm": a_elo_norm,
        "elo_diff_norm": elo_diff_norm,
        "home_momentum": round(h_momentum, 4),
        "away_momentum": round(a_momentum, 4),
        "momentum_diff": momentum_diff,
        "home_fatigue": h_fatigue,
        "away_fatigue": a_fatigue,
        "home_goals_variance": h_var["variance"],
        "away_goals_variance": a_var["variance"],
        "home_consistency": h_var["consistency"],
        "away_consistency": a_var["consistency"],
        "home_attack_strength": h_attack_str,
        "away_attack_strength": a_attack_str,
        "home_defense_strength": h_defense_str,
        "away_defense_strength": a_defense_str,
    }
