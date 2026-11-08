"""
core/predictor.py — Motor de predicción v2 (lógica mejorada)
Mejoras:
  - Lambdas de Poisson más inteligentes: ponderación dinámica xG vs goles reales
  - Ensemble con pesos adaptativos según disponibilidad de datos
  - Estimación de corners/tarjetas con límites y distribución Poisson
  - Análisis enriquecido con datos SofaScore (tiros, posesión, big chances)
  - Predicciones de mitad de partido (1T/2T)
  - Cálculo de valor esperado para mercados
"""

import logging
import math
import numpy as np
import pandas as pd
from typing import Optional

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from config import FEATURE_WINDOW, LEAGUES
from data.fetcher import (
    get_team_recent_stats, get_team_match_history, get_head_to_head,
    get_understat_xg, get_standings, get_team_list
)
from data.sofascore import (
    get_team_avg_stats_sofascore, get_team_id_by_name,
    get_team_recent_stats_sofascore, get_head_to_head_sofascore,
)
from core.features import build_match_features, FEATURE_COLS

logger = logging.getLogger(__name__)


# ─── Distribución de Poisson ─────────────────────────────────────────────────

def _poisson_prob(lam: float, k: int) -> float:
    if lam <= 0:
        return 1.0 if k == 0 else 0.0
    try:
        return math.exp(-lam) * (lam ** k) / math.factorial(k)
    except Exception:
        return 0.0


def _poisson_matrix(home_lam: float, away_lam: float, max_goals: int = 8):
    matrix = np.zeros((max_goals + 1, max_goals + 1))
    for h in range(max_goals + 1):
        for a in range(max_goals + 1):
            matrix[h][a] = _poisson_prob(home_lam, h) * _poisson_prob(away_lam, a)

    home_win = float(np.sum(np.tril(matrix, -1)))
    draw     = float(np.trace(matrix))
    away_win = float(np.sum(np.triu(matrix, 1)))
    return matrix, home_win * 100, draw * 100, away_win * 100


def _most_likely_scores(matrix, top_n: int = 8) -> list:
    scores = [
        (h, a, matrix[h][a])
        for h in range(matrix.shape[0])
        for a in range(matrix.shape[1])
    ]
    scores.sort(key=lambda x: x[2], reverse=True)
    return [{"home": h, "away": a, "prob": round(p * 100, 2)} for h, a, p in scores[:top_n]]


# ─── Serialización ───────────────────────────────────────────────────────────

def _sanitize(obj):
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_sanitize(v) for v in obj]
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        return float(obj)
    if isinstance(obj, (np.bool_,)):
        return bool(obj)
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    return obj


def _safe_stat(value, default):
    return default if (value is None or (isinstance(value, float) and math.isnan(value))) else value


# ─── Cálculo de lambdas (mejorado) ───────────────────────────────────────────

def _calc_lambda_home(h_stats: dict, a_stats: dict,
                      h_xg: dict, a_xg: dict,
                      h_sofa: dict, a_sofa: dict) -> float:
    """
    Lambda goles esperados local (v4 - calibrado).
    Combina: rendimiento casa/visita, xG Understat, xG SofaScore, tiros.
    Ponderacion dinamica segun disponibilidad de datos de calidad.
    """
    # Base: ataque del local en casa vs defensa del visitante fuera
    home_attack  = h_stats.get("home_avg_goals") or h_stats.get("avg_goals", 1.2)
    away_defence = a_stats.get("away_avg_conceded") or a_stats.get("avg_conceded", 1.2)
    raw_lam      = (home_attack + away_defence) / 2.0

    # Fuentes de xG (triangulacion multi-fuente)
    h_xg_val   = h_xg.get("xg") if h_xg else None
    a_xga_val  = a_xg.get("xga") if a_xg else None
    h_xg_sofa  = h_sofa.get("avg_xg_sofascore") if h_sofa else None
    
    # xG desde tiros (proxy si no hay xG directo)
    h_shots    = h_sofa.get("avg_shots_on_target") if h_sofa else None
    h_xg_shots = round(h_shots * 0.30, 3) if h_shots else None  # ~0.30 goles/tiro a puerta

    sources = [v for v in [h_xg_val, a_xga_val, h_xg_sofa, h_xg_shots] if v is not None]
    
    if len(sources) >= 3:
        # Multiples fuentes: xG tiene mucho peso, eliminamos outliers
        sorted_s = sorted(sources)
        xg_estimate = sum(sorted_s[:-1 if len(sorted_s)>2 else None]) / max(1, len(sorted_s)-1 if len(sorted_s)>2 else len(sorted_s))
        lam = raw_lam * 0.25 + xg_estimate * 0.75
    elif len(sources) == 2:
        xg_estimate = sum(sources) / 2.0
        lam = raw_lam * 0.35 + xg_estimate * 0.65
    elif len(sources) == 1:
        lam = raw_lam * 0.50 + sources[0] * 0.50
    else:
        lam = raw_lam

    # Ventaja de local: entre +5% y +12% segun defensa visitante
    away_cs_rate = a_stats.get("clean_sheet_rate", 0.25)
    h_form_pts   = h_stats.get("form_points", 7.5)
    # Equipos en buena forma en casa tienen mas ventaja
    home_advantage = 1.06 + (h_form_pts / 15.0) * 0.06 - away_cs_rate * 0.05
    home_advantage = max(1.02, min(1.14, home_advantage))
    lam *= home_advantage

    # Ajuste por ELO si disponible
    h_elo = h_stats.get("elo_rating", 1500)
    a_elo = a_stats.get("elo_rating", 1500)
    elo_diff = (h_elo - a_elo) / 400.0
    lam *= (1 + elo_diff * 0.08)  # Maximo ~20% de influencia

    return max(round(lam, 3), 0.10)


def _calc_lambda_away(h_stats: dict, a_stats: dict,
                      h_xg: dict, a_xg: dict,
                      h_sofa: dict, a_sofa: dict) -> float:
    """Lambda goles esperados visitante (v4 - calibrado)."""
    away_attack  = a_stats.get("away_avg_goals") or a_stats.get("avg_goals", 1.0)
    home_defence = h_stats.get("home_avg_conceded") or h_stats.get("avg_conceded", 1.2)
    raw_lam      = (away_attack + home_defence) / 2.0

    a_xg_val   = a_xg.get("xg") if a_xg else None
    h_xga_val  = h_xg.get("xga") if h_xg else None
    a_xg_sofa  = a_sofa.get("avg_xg_sofascore") if a_sofa else None
    
    # xG proxy desde tiros a puerta del visitante
    a_shots    = a_sofa.get("avg_shots_on_target") if a_sofa else None
    a_xg_shots = round(a_shots * 0.30, 3) if a_shots else None

    sources = [v for v in [a_xg_val, h_xga_val, a_xg_sofa, a_xg_shots] if v is not None]
    
    if len(sources) >= 3:
        sorted_s = sorted(sources)
        xg_estimate = sum(sorted_s[:-1 if len(sorted_s)>2 else None]) / max(1, len(sorted_s)-1 if len(sorted_s)>2 else len(sorted_s))
        lam = raw_lam * 0.25 + xg_estimate * 0.75
    elif len(sources) == 2:
        xg_estimate = sum(sources) / 2.0
        lam = raw_lam * 0.35 + xg_estimate * 0.65
    elif len(sources) == 1:
        lam = raw_lam * 0.50 + sources[0] * 0.50
    else:
        lam = raw_lam

    # Penalizacion visitante: entre -4% y -10% segun defensa local
    home_cs_rate = h_stats.get("clean_sheet_rate", 0.25)
    a_form_pts   = a_stats.get("form_points", 7.5)
    visitor_penalty = 0.94 - home_cs_rate * 0.04 + (a_form_pts / 15.0) * 0.02
    visitor_penalty = max(0.82, min(0.98, visitor_penalty))
    lam *= visitor_penalty

    # Ajuste por ELO si disponible
    h_elo = h_stats.get("elo_rating", 1500)
    a_elo = a_stats.get("elo_rating", 1500)
    elo_diff = (a_elo - h_elo) / 400.0
    lam *= (1 + elo_diff * 0.08)

    return max(round(lam, 3), 0.05)


# ─── Ajuste de probabilidades ────────────────────────────────────────────────

def _adjust_probabilities(home_prob, draw_prob, away_prob,
                           home_stats, away_stats,
                           home_sofa, away_sofa) -> tuple:
    """
    Ajustes heurísticos basados en: forma, rachas, splits, tendencia, SofaScore.
    """
    home_delta = 0.0
    away_delta = 0.0

    # Forma ponderada (mayor peso)
    wf_diff = home_stats.get("weighted_form", 0) - away_stats.get("weighted_form", 0)
    home_delta += min(max(wf_diff * 0.7, -6), 6)
    away_delta -= min(max(wf_diff * 0.7, -6), 6)

    # Clean sheets: equipos defensivamente sólidos merecen más crédito
    cs_diff = home_stats.get("clean_sheet_rate", 0) - away_stats.get("clean_sheet_rate", 0)
    home_delta += min(max(cs_diff * 5, -4), 4)
    away_delta -= min(max(cs_diff * 5, -4), 4)

    # Rachas actuales
    h_streak = home_stats.get("current_streak_type", "D")
    a_streak = away_stats.get("current_streak_type", "D")
    h_cnt    = home_stats.get("current_streak_count", 0)
    a_cnt    = away_stats.get("current_streak_count", 0)

    streak_bonus = {1: 0.3, 2: 0.6, 3: 1.5, 4: 2.5, 5: 3.5}
    h_bonus = streak_bonus.get(min(h_cnt, 5), 3.5) if h_cnt >= 1 else 0
    a_bonus = streak_bonus.get(min(a_cnt, 5), 3.5) if a_cnt >= 1 else 0

    if h_streak == 'W': home_delta += h_bonus
    elif h_streak == 'L': home_delta -= h_bonus
    if a_streak == 'W': away_delta += a_bonus
    elif a_streak == 'L': away_delta -= a_bonus

    # Tendencia goles
    trend_diff = home_stats.get("goal_trend", 0) - away_stats.get("goal_trend", 0)
    home_delta += min(max(trend_diff * 2.0, -2.5), 2.5)
    away_delta -= min(max(trend_diff * 2.0, -2.5), 2.5)

    # SofaScore: posesión y xG como indicador de dominio
    if home_sofa and away_sofa:
        h_poss = home_sofa.get("avg_possession", 50.0) or 50.0
        a_poss = away_sofa.get("avg_possession", 50.0) or 50.0
        poss_diff = (h_poss - a_poss) / 100
        home_delta += min(max(poss_diff * 6, -2), 2)
        away_delta -= min(max(poss_diff * 6, -2), 2)

        h_xg_s = home_sofa.get("avg_xg_sofascore", 0) or 0
        a_xg_s = away_sofa.get("avg_xg_sofascore", 0) or 0
        xg_diff = h_xg_s - a_xg_s
        home_delta += min(max(xg_diff * 3, -2), 2)
        away_delta -= min(max(xg_diff * 3, -2), 2)

    home_prob = max(min(home_prob + home_delta, 97), 2)
    away_prob = max(min(away_prob + away_delta, 97), 2)
    draw_prob  = max(100 - home_prob - away_prob, 1)

    total = home_prob + draw_prob + away_prob
    if total > 0:
        home_prob = home_prob * 100 / total
        draw_prob  = draw_prob * 100 / total
        away_prob  = away_prob * 100 / total

    return round(home_prob, 2), round(draw_prob, 2), round(away_prob, 2)


# ─── Estimaciones de corners y tarjetas ──────────────────────────────────────

def _estimate_corners_and_cards(home_sofa, away_sofa, home_lam, away_lam):
    """
    Estima corners y tarjetas con modelo estadistico mejorado (v4).
    Usa datos SofaScore reales + modelo de regresion cuando no hay datos.
    Referencia: promedio EPL ~10.5 corners/partido, La Liga ~9.8, Bundesliga ~10.2
    """
    total_lam = home_lam + away_lam

    # ── Corners ────────────────────────────────────────────────────────
    if home_sofa and away_sofa:
        hcf = float(home_sofa.get("avg_corners_for") or 0)
        acf = float(away_sofa.get("avg_corners_for") or 0)
        hca = float(home_sofa.get("avg_corners_against") or 0)
        aca = float(away_sofa.get("avg_corners_against") or 0)

        if hcf > 0 and acf > 0:
            # Modelo: corners del partido = media entre lo que cada equipo genera
            # ponderado por lo que el rival concede
            home_exp_c = (hcf * 0.6 + aca * 0.4)
            away_exp_c = (acf * 0.6 + hca * 0.4)
            sofa_total = home_exp_c + away_exp_c
            # Blend con estimacion por xG (20% peso al modelo de goles)
            xg_corners = total_lam * 4.2 + 5.5
            total_corners = sofa_total * 0.80 + xg_corners * 0.20
        elif hcf > 0 or acf > 0:
            # Solo tenemos un equipo: usar lo disponible + estimacion
            available = hcf if hcf > 0 else acf
            total_corners = available * 2.0 * 0.7 + (total_lam * 4.2 + 5.5) * 0.3
        else:
            total_corners = total_lam * 4.2 + 5.5
    else:
        # Sin SofaScore: modelo lineal calibrado vs liga (9.5-11 corners)
        # Equipos que generan mas goles tienden a generar mas corners
        total_corners = total_lam * 4.2 + 5.5

    # Limitar a rango hiperrealista [6, 18]
    total_corners = max(6.0, min(18.0, total_corners))

    # ── Tarjetas amarillas ──────────────────────────────────────────────
    if home_sofa and away_sofa:
        hyc = float(home_sofa.get("avg_yellow_cards") or 0)
        ayc = float(away_sofa.get("avg_yellow_cards") or 0)
        if hyc > 0 and ayc > 0:
            sofa_cards = hyc + ayc
            # Blend con modelo base
            base_cards = total_lam * 1.4 + 2.0
            total_cards = sofa_cards * 0.75 + base_cards * 0.25
        else:
            total_cards = total_lam * 1.4 + 2.0
    else:
        total_cards = total_lam * 1.4 + 2.0

    # Limitar [1, 8]
    total_cards = max(1.0, min(8.0, total_cards))

    return int(round(total_corners)), int(round(total_cards))


# ─── Predicción de 1er tiempo ────────────────────────────────────────────────

def _predict_first_half(home_lam: float, away_lam: float) -> dict:
    """
    Predicciones para el primer tiempo (v4).
    Los goles en 1T siguen patron ligeramente distinto:
    - En media ~42% de los goles ocurren en 1T en ligas top
    - Los primeros 15-20 min suelen ser mas cautelosos
    - La intensidad aumenta cerca del descanso
    """
    # Factor 1T: estadisticamente ~43% de los goles se marcan en 1T
    ht_factor = 0.43
    ht_home = home_lam * ht_factor
    ht_away = away_lam * ht_factor
    
    pm, hw, d, aw = _poisson_matrix(ht_home, ht_away, max_goals=5)
    
    # Probabilidades de goles en 1T
    p_00_ht = _poisson_prob(ht_home, 0) * _poisson_prob(ht_away, 0)
    over_05_ht = (1.0 - p_00_ht) * 100
    
    # Over 1.5 en 1T
    p_under_15 = sum(
        _poisson_prob(ht_home, h) * _poisson_prob(ht_away, a)
        for h in range(5) for a in range(5)
        if h + a <= 1
    )
    over_15_ht = (1.0 - p_under_15) * 100
    
    # Marcador mas probable 1T
    scores_ht = sorted(
        [(h, a, _poisson_prob(ht_home, h) * _poisson_prob(ht_away, a)) for h in range(4) for a in range(4)],
        key=lambda x: x[2], reverse=True
    )
    
    return {
        "home_lam_ht":    round(ht_home, 3),
        "away_lam_ht":    round(ht_away, 3),
        "home_win_ht":    round(hw, 1),
        "draw_ht":        round(d, 1),
        "away_win_ht":    round(aw, 1),
        "over_05_ht":     round(over_05_ht, 1),
        "over_15_ht":     round(over_15_ht, 1),
        "top_score_ht":   {"home": scores_ht[0][0], "away": scores_ht[0][1], "prob": round(scores_ht[0][2]*100,1)} if scores_ht else {},
    }


# ─── Predicción principal ─────────────────────────────────────────────────────

def predict_match(
    home_team_id: int,
    away_team_id: int,
    league_key: str,
    model,
    home_team_name: str = "Local",
    away_team_name: str = "Visitante",
) -> dict:
    n_window = max(FEATURE_WINDOW, 10)

    # Stats base del equipo
    if league_key == "ligamx":
        home_stats = get_team_recent_stats_sofascore(home_team_id, n=n_window)
        away_stats = get_team_recent_stats_sofascore(away_team_id, n=n_window)
    else:
        home_stats = get_team_recent_stats(home_team_id, n=n_window)
        away_stats = get_team_recent_stats(away_team_id, n=n_window)

    if not home_stats or not away_stats:
        raise ValueError(
            f"No se encontraron estadísticas para los equipos. "
            f"IDs: {home_team_id}, {away_team_id}"
        )

    # xG Understat
    xg_map  = get_understat_xg(league_key)
    home_xg = xg_map.get(home_team_name, {})
    away_xg = xg_map.get(away_team_name, {})

    # SofaScore: IDs y stats avanzadas
    logger.info(f"Obteniendo stats SofaScore para {home_team_name} y {away_team_name}...")
    home_sofa_id = get_team_id_by_name(home_team_name)
    away_sofa_id = get_team_id_by_name(away_team_name)

    home_sofa = {}
    away_sofa = {}
    if home_sofa_id:
        home_sofa = get_team_avg_stats_sofascore(home_sofa_id, n=10)
        logger.info(f"  {home_team_name}: corners={home_sofa.get('avg_corners_for')}, xG={home_sofa.get('avg_xg_sofascore')}, pos={home_sofa.get('avg_possession')}")
    if away_sofa_id:
        away_sofa = get_team_avg_stats_sofascore(away_sofa_id, n=10)
        logger.info(f"  {away_team_name}: corners={away_sofa.get('avg_corners_for')}, xG={away_sofa.get('avg_xg_sofascore')}, pos={away_sofa.get('avg_possession')}")

    # Tabla de posiciones
    standings   = get_standings(league_key)
    pos_map     = {row["team_id"]: row["position"] for row in standings}
    ppg_map     = {row["team_id"]: row.get("points_per_game", 1.0) for row in standings}
    total_teams = len(standings) or 20
    max_ppg     = max((row.get("points_per_game", 1.0) for row in standings), default=3.0)

    home_pos = pos_map.get(home_team_id, total_teams // 2)
    away_pos = pos_map.get(away_team_id, total_teams // 2)
    home_ppg = ppg_map.get(home_team_id, 1.0)
    away_ppg = ppg_map.get(away_team_id, 1.0)

    # H2H
    h2h = get_head_to_head(home_team_id, away_team_id)
    if league_key == "ligamx" and h2h.get("total", 0) == 0:
        h2h = get_head_to_head_sofascore(home_team_id, away_team_id)

    # Features ML
    features = build_match_features(
        home_stats, away_stats,
        home_xg, away_xg,
        home_pos, away_pos,
        total_teams, h2h,
        home_ppg, away_ppg, max_ppg,
        home_sofa=home_sofa,
        away_sofa=away_sofa,
    )

    # ── Alinear features al modelo guardado ─────────────────────────────────
    # El modelo guardado puede haber sido entrenado con un conjunto de features
    # diferente al FEATURE_COLS actual. Detectamos las features que espera el
    # modelo y hacemos reindex con fill_value=0 para evitar FeatureNamesNotSeen.
    model_feature_names = None
    try:
        # CalibratedClassifierCV envuelve el pipeline; navegar hasta el estimador base
        base = model
        if hasattr(base, "calibrated_classifiers_"):
            base = base.calibrated_classifiers_[0].estimator
        if hasattr(base, "named_steps"):
            # Pipeline: el scaler guarda feature_names_in_
            scaler = base.named_steps.get("scaler")
            if scaler is not None and hasattr(scaler, "feature_names_in_"):
                model_feature_names = list(scaler.feature_names_in_)
        if model_feature_names is None and hasattr(model, "feature_names_in_"):
            model_feature_names = list(model.feature_names_in_)
    except Exception as e:
        logger.debug(f"No se pudo extraer feature_names del modelo: {e}")

    target_cols = model_feature_names if model_feature_names else FEATURE_COLS

    # Construir DataFrame con todas las keys disponibles y reindexar
    df = pd.DataFrame([features]).reindex(columns=target_cols, fill_value=0.0)
    proba = model.predict_proba(df)[0]

    away_prob_ml = float(proba[0]) * 100
    draw_prob_ml = float(proba[1]) * 100
    home_prob_ml = float(proba[2]) * 100

    # Lambdas de Poisson mejoradas
    home_lam = _calc_lambda_home(home_stats, away_stats, home_xg, away_xg, home_sofa, away_sofa)
    away_lam = _calc_lambda_away(home_stats, away_stats, home_xg, away_xg, home_sofa, away_sofa)

    _, home_prob_p, draw_prob_p, away_prob_p = _poisson_matrix(home_lam, away_lam)

    # Ensemble: peso adaptativo según disponibilidad de datos
    has_xg    = bool(home_xg or away_xg)
    has_sofa  = bool(home_sofa and away_sofa)
    if has_xg and has_sofa:
        w_ml, w_p = 0.55, 0.45   # Más datos → más confiamos en Poisson enriquecido
    elif has_xg or has_sofa:
        w_ml, w_p = 0.60, 0.40
    else:
        w_ml, w_p = 0.65, 0.35   # Sin xG → más peso al ML

    home_prob = home_prob_ml * w_ml + home_prob_p * w_p
    draw_prob  = draw_prob_ml * w_ml + draw_prob_p * w_p
    away_prob  = away_prob_ml * w_ml + away_prob_p * w_p

    # Normalizar
    total_p = home_prob + draw_prob + away_prob
    if total_p > 0:
        home_prob = home_prob * 100 / total_p
        draw_prob  = draw_prob * 100 / total_p
        away_prob  = away_prob * 100 / total_p

    # Ajustes heurísticos
    home_prob, draw_prob, away_prob = _adjust_probabilities(
        home_prob, draw_prob, away_prob,
        home_stats, away_stats, home_sofa, away_sofa,
    )

    predicted = max(
        [("home", home_prob), ("draw", draw_prob), ("away", away_prob)],
        key=lambda x: x[1],
    )[0]

    sorted_probs = sorted([home_prob, draw_prob, away_prob], reverse=True)
    # Confianza = margen sobre el 2do mas probable + bonus por datos de calidad
    margin = sorted_probs[0] - sorted_probs[1]
    # Bonus por calidad de datos disponibles
    data_bonus = 0
    if has_xg: data_bonus += 2.0
    if has_sofa: data_bonus += 2.0
    confidence = round(margin + data_bonus * 0.5, 1)
    confidence_label = (
        "Alta"  if confidence > 18 else
        "Media" if confidence > 9  else
        "Baja"
    )

    # Marcadores probables
    pm, _, _, _ = _poisson_matrix(home_lam, away_lam)
    likely_scores = _most_likely_scores(pm)

    # Mercados
    over_25_prob = over_35_prob = btts_prob = 0.0
    for h in range(pm.shape[0]):
        for a in range(pm.shape[1]):
            if h + a > 2: over_25_prob += pm[h][a]
            if h + a > 3: over_35_prob += pm[h][a]
            if h > 0 and a > 0: btts_prob += pm[h][a]
    over_15_prob = 1 - sum(pm[h][a] for h in range(pm.shape[0]) for a in range(pm.shape[1]) if h + a <= 1)
    over_25_prob = round(over_25_prob * 100, 1)
    over_35_prob = round(over_35_prob * 100, 1)
    btts_prob    = round(btts_prob * 100, 1)
    over_15_prob = round(over_15_prob * 100, 1)

    # Portería a cero
    prob_home_cs = round(_poisson_prob(away_lam, 0) * 100, 1)
    prob_away_cs = round(_poisson_prob(home_lam, 0) * 100, 1)

    predicted_cs = None
    if prob_home_cs > 45 and prob_home_cs > prob_away_cs:
        predicted_cs = "home"
    elif prob_away_cs > 45 and prob_away_cs > prob_home_cs:
        predicted_cs = "away"

    # Goles más probables
    predicted_home_goals = int(np.floor(home_lam))
    predicted_away_goals = int(np.floor(away_lam))
    home_goal_range = [max(0, predicted_home_goals - 1), predicted_home_goals + 1]
    away_goal_range = [max(0, predicted_away_goals - 1), predicted_away_goals + 1]

    # Corners y tarjetas mejoradas
    predicted_total_corners, predicted_total_cards = _estimate_corners_and_cards(
        home_sofa, away_sofa, home_lam, away_lam
    )

    # Predicción 1er tiempo
    ht_pred = _predict_first_half(home_lam, away_lam)

    # Historial
    home_history = get_team_match_history(home_team_id, n=8)
    away_history = get_team_match_history(away_team_id, n=8)

    # Análisis narrativo enriquecido
    analysis = _build_analysis(
        home_team_name, away_team_name,
        home_stats, away_stats,
        home_prob, draw_prob, away_prob,
        home_xg, away_xg, h2h, home_pos, away_pos,
        home_lam, away_lam, confidence_label,
        home_sofa, away_sofa,
    )

    return _sanitize({
        "home_team":                  home_team_name,
        "away_team":                  away_team_name,
        "home_win_probability":       round(float(home_prob), 2),
        "draw_probability":           round(float(draw_prob), 2),
        "away_win_probability":       round(float(away_prob), 2),
        "predicted_result":           predicted,
        "confidence":                 float(confidence),
        "confidence_label":           confidence_label,
        # Goles esperados
        "expected_home_goals":        round(float(home_lam), 2),
        "expected_away_goals":        round(float(away_lam), 2),
        "expected_goals":             round(float(home_lam + away_lam), 2),
        "predicted_home_goals":       int(predicted_home_goals),
        "predicted_away_goals":       int(predicted_away_goals),
        "home_goal_range":            [int(x) for x in home_goal_range],
        "away_goal_range":            [int(x) for x in away_goal_range],
        # Mercados
        "over_15":                    bool(over_15_prob > 50),
        "over_15_prob":               float(over_15_prob),
        "over_25":                    bool(over_25_prob > 50),
        "over_25_prob":               float(over_25_prob),
        "over_35":                    bool(over_35_prob > 50),
        "over_35_prob":               float(over_35_prob),
        "btts":                       bool(btts_prob > 50),
        "btts_prob":                  float(btts_prob),
        # Portería a cero
        "prob_home_clean_sheet":      float(prob_home_cs),
        "prob_away_clean_sheet":      float(prob_away_cs),
        "predicted_clean_sheet":      predicted_cs,
        # Corners/tarjetas
        "predicted_total_corners":    int(predicted_total_corners),
        "predicted_total_cards":      int(predicted_total_cards),
        "corners_over_95":            bool(predicted_total_corners >= 10),
        # Predicción 1er tiempo
        "first_half":                 ht_pred,
        # Marcadores más probables
        "likely_scores":              likely_scores,
        # Contexto
        "home_stats":                 _sanitize(home_stats),
        "away_stats":                 _sanitize(away_stats),
        "home_history":               home_history,
        "away_history":               away_history,
        "h2h":                        h2h,
        "home_position":              int(home_pos) if home_pos is not None else None,
        "away_position":              int(away_pos) if away_pos is not None else None,
        "home_xg":                    home_xg,
        "away_xg":                    away_xg,
        "analysis":                   analysis,
        # SofaScore
        "home_sofascore_stats":       home_sofa,
        "away_sofascore_stats":       away_sofa,
        "sofascore_available":        bool(home_sofa and away_sofa),
        # Meta
        "ensemble_weights":           {"ml": w_ml, "poisson": w_p},
        "data_sources":               {
            "has_xg_understat":       has_xg,
            "has_sofascore":          has_sofa,
            "home_sofa_matches":      home_sofa.get("matches_analyzed", 0) if home_sofa else 0,
            "away_sofa_matches":      away_sofa.get("matches_analyzed", 0) if away_sofa else 0,
        },
    })


# ─── Análisis narrativo enriquecido ──────────────────────────────────────────

def _build_analysis(
    home, away, h_stats, a_stats,
    home_prob, draw_prob, away_prob,
    h_xg, a_xg, h2h, home_pos, away_pos,
    home_lam, away_lam, confidence_label,
    h_sofa=None, a_sofa=None,
) -> list:
    notes = []

    # Resultado esperado
    if home_prob > away_prob + 12:
        notes.append(f"🏠 {home} es favorito claro ({home_prob:.1f}%) — confianza {confidence_label}")
    elif away_prob > home_prob + 12:
        notes.append(f"✈️ {away} llega como favorito ({away_prob:.1f}%) — confianza {confidence_label}")
    else:
        notes.append(f"⚖️ Partido muy equilibrado — Local {home_prob:.1f}% / Empate {draw_prob:.1f}% / Visita {away_prob:.1f}%")

    # Forma y rachas
    h_form  = h_stats.get("form_string", "")
    a_form  = a_stats.get("form_string", "")
    h_st    = h_stats.get("current_streak_type", "D")
    a_st    = a_stats.get("current_streak_type", "D")
    h_cnt   = h_stats.get("current_streak_count", 0)
    a_cnt   = a_stats.get("current_streak_count", 0)

    if h_form:
        notes.append(f"📈 Forma {home} (últ. 5): {' '.join(h_form)}")
    if a_form:
        notes.append(f"📈 Forma {away} (últ. 5): {' '.join(a_form)}")

    if h_cnt >= 2:
        emoji = "🔥" if h_st == 'W' else ("🧊" if h_st == 'L' else "➡️")
        label = {"W": "victorias", "D": "empates", "L": "derrotas"}.get(h_st, "")
        notes.append(f"{emoji} {home}: racha de {h_cnt} {label} consecutivas")
    if a_cnt >= 2:
        emoji = "🔥" if a_st == 'W' else ("🧊" if a_st == 'L' else "➡️")
        label = {"W": "victorias", "D": "empates", "L": "derrotas"}.get(a_st, "")
        notes.append(f"{emoji} {away}: racha de {a_cnt} {label} consecutivas")

    # xG
    if h_xg:
        notes.append(f"📊 xG {home}: {h_xg.get('xg','N/A')} ofensivo | {h_xg.get('xga','N/A')} defensivo | sobrerendimiento: {h_xg.get('xg_over_performance','N/A')}")
    if a_xg:
        notes.append(f"📊 xG {away}: {a_xg.get('xg','N/A')} ofensivo | {a_xg.get('xga','N/A')} defensivo | sobrerendimiento: {a_xg.get('xg_over_performance','N/A')}")

    # SofaScore avanzado
    if h_sofa and a_sofa:
        h_poss  = h_sofa.get("avg_possession")
        a_poss  = a_sofa.get("avg_possession")
        h_shots = h_sofa.get("avg_shots")
        a_shots = a_sofa.get("avg_shots")
        h_xgs   = h_sofa.get("avg_xg_sofascore")
        a_xgs   = a_sofa.get("avg_xg_sofascore")
        h_bc    = h_sofa.get("avg_big_chances")
        a_bc    = a_sofa.get("avg_big_chances")

        if h_poss and a_poss:
            dom = home if h_poss > a_poss else away
            notes.append(f"🎮 Posesión promedio: {home} {h_poss:.1f}% — {away} {a_poss:.1f}% (domina {dom})")
        if h_shots and a_shots:
            notes.append(f"🎯 Tiros promedio: {home} {h_shots:.1f} — {away} {a_shots:.1f} por partido")
        if h_xgs and a_xgs:
            notes.append(f"⚽ xG SofaScore: {home} {h_xgs:.2f} — {away} {a_xgs:.2f} por partido")
        if h_bc and a_bc:
            notes.append(f"💥 Grandes ocasiones: {home} {h_bc:.1f} — {away} {a_bc:.1f} por partido")

    # Goles esperados
    notes.append(f"⚽ Goles esperados (Poisson): {home} {home_lam:.2f} — {away} {away_lam:.2f} (total {home_lam+away_lam:.2f})")

    # H2H
    if h2h.get("total", 0) > 0:
        notes.append(
            f"🔁 H2H ({h2h['total']} encuentros): "
            f"{home} {h2h['home_wins']}V – {h2h['draws']}E – {h2h['away_wins']}V {away} "
            f"| prom. {h2h.get('avg_goals_h2h',0):.1f} goles/partido"
        )
        for r in h2h.get("last_5", [])[:3]:
            notes.append(f"   📅 {r.get('date','')[:10]} — {r.get('home','')} {r.get('score','')} {r.get('away','')}")

    # Posiciones
    if home_pos and away_pos:
        notes.append(f"📋 Tabla: {home} #{home_pos} vs {away} #{away_pos}")

    # Defensa
    if h_stats["avg_conceded"] < 1.0:
        notes.append(f"🛡️ {home} es sólido defensivamente ({h_stats['avg_conceded']:.2f} goles concedidos/pj)")
    if a_stats["avg_conceded"] < 1.0:
        notes.append(f"🛡️ {away} es sólido defensivamente ({a_stats['avg_conceded']:.2f} goles concedidos/pj)")

    # Splits
    h_home_g  = h_stats.get("home_avg_goals", h_stats["avg_goals"])
    a_away_g  = a_stats.get("away_avg_goals", a_stats["avg_goals"])
    if h_home_g > h_stats["avg_goals"] * 1.15:
        notes.append(f"🏟️ {home} rinde mejor en casa ({h_home_g:.2f} goles/pj vs {h_stats['avg_goals']:.2f} general)")
    if a_away_g < a_stats["avg_goals"] * 0.85:
        notes.append(f"🚌 {away} baja su nivel de visita ({a_away_g:.2f} goles/pj vs {a_stats['avg_goals']:.2f} general)")

    # Tendencia
    h_trend = h_stats.get("goal_trend", 0)
    a_trend = a_stats.get("goal_trend", 0)
    if abs(h_trend) > 0.2:
        emoji = "📈" if h_trend > 0 else "📉"
        notes.append(f"{emoji} {home}: tendencia de goles {'+' if h_trend>0 else ''}{h_trend:.2f}/partido")
    if abs(a_trend) > 0.2:
        emoji = "📈" if a_trend > 0 else "📉"
        notes.append(f"{emoji} {away}: tendencia de goles {'+' if a_trend>0 else ''}{a_trend:.2f}/partido")

    # Corners
    if h_sofa and a_sofa:
        hcf = h_sofa.get("avg_corners_for")
        acf = a_sofa.get("avg_corners_for")
        if hcf and acf:
            notes.append(f"🚩 Corners promedio: {home} {hcf:.1f} — {away} {acf:.1f} por partido")

    return notes
