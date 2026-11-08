"""
chatbot/ollama_chat.py - PredictIA v6 ULTRA
Optimizado para llama3:8b + Draftea picks con todos los mercados.
Inyeccion automatica de datos completos SofaScore + football-data.org.
"""

import logging
import json
import socket
import re
from typing import Optional
from urllib.parse import urlparse
from datetime import datetime, date
import requests

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    from config import OLLAMA_URL as _CFG_URL, OLLAMA_MODEL as _CFG_MODEL
    env_url = os.getenv("OLLAMA_URL") or os.getenv("OLLAMA_HOST")
    OLLAMA_BASE_URL = (env_url or _CFG_URL).rstrip("/")
    OLLAMA_MODEL = os.getenv("OLLAMA_MODEL") or _CFG_MODEL
except Exception:
    env_url = os.getenv("OLLAMA_URL") or os.getenv("OLLAMA_HOST")
    OLLAMA_BASE_URL = (env_url or "http://127.0.0.1:11434").rstrip("/")
    OLLAMA_MODEL = os.getenv("OLLAMA_MODEL") or "llama3:8b"

SELF_API_BASE = os.getenv("SELF_API_URL", "http://127.0.0.1:8000")

logger = logging.getLogger(__name__)

OLLAMA_TIMEOUT = 180
OLLAMA_CONNECT_TIMEOUT = 8
OLLAMA_READ_TIMEOUT = 160

# ── Opciones optimizadas para llama3:8b ──────────────────────────────────────
LLAMA3_OPTIONS = {
    "temperature": 0.2,
    "num_predict": 800,
    "top_p": 0.85,
    "top_k": 40,
    "repeat_penalty": 1.1,
    "num_ctx": 8192,
    "stop": ["<|eot_id|>"],
}

DEFAULT_OLLAMA_OPTIONS = {
    "temperature": 0.2,
    "num_predict": 600,
    "top_p": 0.8,
    "top_k": 35,
    "repeat_penalty": 1.1,
    "num_ctx": 4096,
}

# ── System Prompt optimizado para Draftea ────────────────────────────────────
SYSTEM_PROMPT = """Eres PredictIA v6, asistente experto en futbol y apuestas deportivas con acceso a datos en tiempo real de SofaScore y football-data.org.

OBJETIVO PRINCIPAL: Ayudar al usuario a tomar decisiones informadas para Draftea con predicciones basadas en datos estadisticos reales.

CAPACIDADES:
- Partidos en vivo con marcador, minuto y estadisticas
- Predicciones 1X2 con probabilidades calibradas (Poisson + ensemble)
- Over/Under goles (1.5, 2.5, 3.5) basado en xG real
- BTTS (ambos marcan) con analisis ofensivo/defensivo
- Corners totales O/U basado en historiales reales de equipos
- Tarjetas totales O/U basado en estilo de juego y faltas
- Marcador exacto mas probable (matriz Poisson)
- Picks recomendados con confianza % y value/edge

FORMATO DE RESPUESTA PARA PICKS DRAFTEA:
Usa este formato cuando el usuario pida picks, predicciones o analisis:

PICK [mercado]: [seleccion] | Confianza: [X]% | Edge: [valor]
Razon: [explicacion breve basada en datos]

MERCADOS DRAFTEA:
- 1X2: Ganador del partido
- O/U 1.5, 2.5, 3.5: Total de goles
- BTTS: Ambos equipos marcan
- Corners O/U 8.5, 9.5, 10.5: Total de corners
- Tarjetas O/U 3.5, 4.5, 5.5: Total de tarjetas
- Marcador exacto: Resultado mas probable

REGLAS:
1. SIEMPRE usa los datos del contexto como UNICA fuente de verdad.
2. NUNCA digas que no tienes acceso a datos si hay informacion en el contexto.
3. Razona paso a paso: datos -> analisis -> conclusion -> pick
4. Se honesto con la confianza. Si no hay datos suficientes, di "confianza baja".
5. Prioriza value (edge) sobre probabilidad bruta.
6. Para cada partido, intenta dar picks en TODOS los mercados disponibles.
7. Responde en espanol, conciso y directo.
8. No inventes datos. Si no hay un dato, di "sin datos".
"""

# ── Deteccion de intencion (mejorada con Draftea) ───────────────────────────
INTENT_LIVE = [
    "en vivo", "en directo", "ahora", "live", "directo",
    "jugando", "partidos hoy", "partidos ahora", "marcador",
    "marcadores", "resultado", "resultados", "hoy", "que hay",
    "que partidos",
]
INTENT_UPCOMING = [
    "proximos", "manana", "siguiente", "cuando juega",
    "fixture", "agenda", "proxima jornada", "programacion",
]
INTENT_PREDICTION = [
    "prediccion", "predice", "pronostico", "analisis", "analiza",
    "pick", "picks", "draftea", "apuesta", "apuestas",
    "valor", "cuota", "value", "bet", "tip", "tips",
    "over", "under", "btts", "corner", "corners",
    "tarjeta", "tarjetas", "card", "cards",
    "goles", "marcador", "score", "1x2",
    "quien gana", "va a ganar", "ganador",
]
INTENT_GREETING = [
    "hola", "hello", "buenas", "hey", "hi", "buenos dias",
    "buenas tardes", "buenas noches", "que tal",
]


def _detect_intent(message: str) -> str:
    msg = message.lower().strip()
    if any(w in msg for w in INTENT_PREDICTION):
        return "prediction"
    if any(w in msg for w in INTENT_LIVE):
        return "live"
    if any(w in msg for w in INTENT_UPCOMING):
        return "upcoming"
    if any(w in msg for w in INTENT_GREETING):
        return "greeting"
    return "general"


# ── Obtencion de datos en tiempo real ───────────────────────────────────────

def _safe_api_get(path: str, timeout: int = 8) -> Optional[dict]:
    try:
        resp = requests.get(f"{SELF_API_BASE}{path}", timeout=timeout)
        if resp.status_code == 200:
            return resp.json()
    except Exception as e:
        logger.debug("Self-API %s error: %s", path, e)
    return None


def _fetch_live_matches() -> str:
    data = _safe_api_get("/api/live")
    if not data:
        try:
            from data.sofascore import get_live_matches
            matches = get_live_matches()
            data = {"matches": matches, "count": len(matches)}
        except Exception as e:
            logger.warning("SofaScore live error: %s", e)
            return ""

    matches = data.get("matches", [])
    if not matches:
        return "[DATOS_TIEMPO_REAL: Sin partidos en vivo en este momento]\n"

    lines = [f"[DATOS_TIEMPO_REAL: {len(matches)} PARTIDOS EN VIVO]"]
    for m in matches[:25]:
        home = m.get("home_team") or (m.get("homeTeam") or {}).get("name", "?")
        away = m.get("away_team") or (m.get("awayTeam") or {}).get("name", "?")
        hs = m.get("home_score", "?")
        as_ = m.get("away_score", "?")
        minute = m.get("minute", "")
        comp = m.get("tournament") or m.get("competition", "")
        if isinstance(comp, dict):
            comp = comp.get("name", "")
        lines.append(f"  {home} {hs}-{as_} {away} | {minute}' | {comp}")
    return "\n".join(lines) + "\n"


def _fetch_today_matches() -> str:
    today = date.today().strftime("%Y-%m-%d")
    data = _safe_api_get(f"/api/today?date={today}")
    if not data:
        try:
            from data.sofascore import get_matches_by_date
            matches = get_matches_by_date(today)
            data = {"matches": matches}
        except Exception:
            return ""

    matches = data.get("matches", [])
    if not matches:
        return f"[DATOS_TIEMPO_REAL: No hay partidos para hoy {today}]\n"

    live, scheduled, finished = [], [], []
    for m in matches[:40]:
        st = str(m.get("status_type", m.get("status", ""))).lower()
        if "inprogress" in st or "live" in st:
            live.append(m)
        elif "finished" in st or "ended" in st:
            finished.append(m)
        else:
            scheduled.append(m)

    lines = [f"[DATOS_TIEMPO_REAL: PARTIDOS HOY {today} - {len(matches)} total]"]
    if live:
        lines.append(f"\nEN VIVO ({len(live)}):")
        for m in live:
            h = m.get("home_team", "?")
            a = m.get("away_team", "?")
            lines.append(f"  {h} {m.get('home_score','')}-{m.get('away_score','')} {a} | {m.get('minute','')}' | {m.get('tournament','')}")
    if scheduled:
        lines.append(f"\nPROGRAMADOS ({len(scheduled)}):")
        for m in scheduled[:12]:
            h = m.get("home_team", "?")
            a = m.get("away_team", "?")
            lines.append(f"  {h} vs {a} | {m.get('tournament','')}")
    if finished:
        lines.append(f"\nFINALIZADOS ({len(finished)}):")
        for m in finished[:8]:
            h = m.get("home_team", "?")
            a = m.get("away_team", "?")
            lines.append(f"  {h} {m.get('home_score','')}-{m.get('away_score','')} {a}")
    return "\n".join(lines) + "\n"


def _fetch_upcoming_matches(league: str = "all") -> str:
    data = _safe_api_get(f"/api/upcoming/{league}?days=7")
    if not data:
        try:
            from data.fetcher import get_all_upcoming_matches, get_upcoming_matches
            if league == "all":
                matches = get_all_upcoming_matches(days=7) or []
            else:
                matches = get_upcoming_matches(league, days=7) or []
            data = {"matches": matches}
        except Exception:
            return ""

    matches = data.get("matches", [])
    if not matches:
        return "[DATOS_TIEMPO_REAL: Sin proximos partidos encontrados]\n"

    lines = [f"[DATOS_TIEMPO_REAL: PROXIMOS PARTIDOS - {len(matches)} encontrados]"]
    for m in matches[:15]:
        home = m.get("home_team") or (m.get("homeTeam") or {}).get("name", "?")
        away = m.get("away_team") or (m.get("awayTeam") or {}).get("name", "?")
        d = (m.get("date") or m.get("utcDate") or "?")[:16]
        comp = m.get("competition") or m.get("tournament", "")
        lines.append(f"  {home} vs {away} | {d} | {comp}")
    return "\n".join(lines) + "\n"


def _fetch_realtime_context(message: str, intent: str) -> str:
    parts = []
    if intent == "live":
        live_ctx = _fetch_live_matches()
        parts.append(live_ctx)
        if "Sin partidos en vivo" in live_ctx:
            parts.append(_fetch_today_matches())
    elif intent == "upcoming":
        msg_lower = message.lower()
        league_map = {
            "premier": "premier", "la liga": "laliga", "bundesliga": "bundesliga",
            "serie a": "seriea", "ligue 1": "ligue1", "champions": "champions",
            "liga mx": "ligamx", "mexico": "ligamx", "mls": "mls",
        }
        league = next((v for k, v in league_map.items() if k in msg_lower), "all")
        parts.append(_fetch_upcoming_matches(league))
    elif intent in ("general", "prediction"):
        msg_lower = message.lower()
        if any(w in msg_lower for w in ["partido", "match", "juego"]):
            parts.append(_fetch_live_matches())
    return "\n".join(filter(None, parts))


# ── Conexion Ollama ─────────────────────────────────────────────────────────

def _parse_host_port(url: str) -> tuple:
    parsed = urlparse(url)
    return parsed.hostname or "127.0.0.1", parsed.port or 11434


def _is_port_open(host: str, port: int, timeout: float = 1.5) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except Exception:
        return False


def check_ollama_status() -> dict:
    try:
        resp = requests.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=5)
        resp.raise_for_status()
        data = resp.json()
        models = [m["name"] for m in data.get("models", [])]
        return {"online": True, "available": True, "model": OLLAMA_MODEL,
                "models": models, "error": None}
    except requests.exceptions.ConnectionError:
        host, port = _parse_host_port(OLLAMA_BASE_URL)
        msg = f"Ollama no responde en {OLLAMA_BASE_URL}. Ejecuta `ollama serve`."
        return {"online": False, "available": False, "model": OLLAMA_MODEL,
                "models": [], "error": msg}
    except Exception as exc:
        return {"online": False, "available": False, "model": OLLAMA_MODEL,
                "models": [], "error": str(exc)}


def _extract_ollama_response(data) -> Optional[str]:
    if isinstance(data, str) and data.strip():
        return data.strip()
    if not isinstance(data, dict):
        return None
    if isinstance(data.get("message"), dict):
        c = data["message"].get("content", "")
        if isinstance(c, str) and c.strip():
            return c.strip()
    if isinstance(data.get("response"), str) and data["response"].strip():
        return data["response"].strip()
    for out in (data.get("outputs") or []):
        if isinstance(out, dict):
            c = out.get("content") or out.get("text")
            if isinstance(c, str) and c.strip():
                return c.strip()
    return None


# ── Formateo de contexto de prediccion (MEJORADO para Draftea) ──────────────

def _fmt(val, decimals=2, default="?"):
    try:
        return f"{float(val):.{decimals}f}" if val is not None else default
    except Exception:
        return str(val) if val else default


def _signal(prob, high=58, med=42):
    if prob >= high: return "PROBABLE"
    if prob >= med: return "POSIBLE"
    return "IMPROBABLE"


def _build_prediction_context_str(prediction_context: dict) -> str:
    if not prediction_context:
        return ""

    home = prediction_context.get("home_team", "Local")
    away = prediction_context.get("away_team", "Visitante")
    pred = prediction_context.get("predicted_result",
           prediction_context.get("prediction", "?"))
    conf = prediction_context.get("confidence", 0)
    conf_label = prediction_context.get("confidence_label", "")
    probs = prediction_context.get("probabilities", {})

    home_prob = float(probs.get("home") or prediction_context.get("home_win_probability", 0))
    draw_prob = float(probs.get("draw") or prediction_context.get("draw_probability", 0))
    away_prob = float(probs.get("away") or prediction_context.get("away_win_probability", 0))

    egh = prediction_context.get("expected_home_goals", 0)
    ega = prediction_context.get("expected_away_goals", 0)
    o15p = prediction_context.get("over_15_prob", 0)
    o25p = prediction_context.get("over_25_prob", 0)
    o35p = prediction_context.get("over_35_prob", 0)
    btts = prediction_context.get("btts_prob", 0)
    hcs = prediction_context.get("prob_home_clean_sheet", 0)
    acs = prediction_context.get("prob_away_clean_sheet", 0)

    # Mercados Draftea extendidos
    corners_data = prediction_context.get("corners", {})
    cards_data = prediction_context.get("cards", {})
    draftea = prediction_context.get("draftea_picks", [])

    h_stats = prediction_context.get("home_stats", {})
    a_stats = prediction_context.get("away_stats", {})
    h_sofa = prediction_context.get("home_sofascore_stats", {})
    a_sofa = prediction_context.get("away_sofascore_stats", {})
    h2h = prediction_context.get("h2h", {})
    ls = prediction_context.get("likely_scores", [])
    analysis = prediction_context.get("analysis", [])

    lines = [
        f"=== PARTIDO: {home} vs {away} ===",
        f"PREDICCION: {pred.upper()} | Confianza: {conf:.1f}% [{conf_label}]",
        f"1X2: Local {home_prob:.1f}% | Empate {draw_prob:.1f}% | Visitante {away_prob:.1f}%",
        "",
        f"[xG] {home}: {_fmt(egh)} | {away}: {_fmt(ega)} | Total: {_fmt(float(egh or 0)+float(ega or 0))}",
        f"[GOLES] O1.5: {_fmt(o15p,1)}% | O2.5: {_fmt(o25p,1)}% | O3.5: {_fmt(o35p,1)}%",
        f"[BTTS] Probabilidad: {_fmt(btts,1)}% [{_signal(float(btts or 0))}]",
        f"[CLEAN SHEET] {home}: {_fmt(hcs,1)}% | {away}: {_fmt(acs,1)}%",
    ]

    # Corners
    if corners_data:
        pred_total = corners_data.get("predicted_total", "?")
        lines.append(f"[CORNERS] Total predicho: {pred_total}")
        lines.append(f"  O8.5: {_fmt(corners_data.get('over_8_5_prob'),1)}% | O9.5: {_fmt(corners_data.get('over_9_5_prob'),1)}% | O10.5: {_fmt(corners_data.get('over_10_5_prob'),1)}%")
        lines.append(f"  {home} avg: {_fmt(corners_data.get('home_avg_for'),1)} | {away} avg: {_fmt(corners_data.get('away_avg_for'),1)}")

    # Tarjetas
    if cards_data:
        pred_cards = cards_data.get("predicted_total", "?")
        lines.append(f"[TARJETAS] Total predicho: {pred_cards}")
        lines.append(f"  O3.5: {_fmt(cards_data.get('over_3_5_prob'),1)}% | O4.5: {_fmt(cards_data.get('over_4_5_prob'),1)}% | O5.5: {_fmt(cards_data.get('over_5_5_prob'),1)}%")

    # Marcadores exactos
    if ls:
        lines.append("[MARCADORES MAS PROBABLES]")
        for score in ls[:5]:
            lines.append(f"  {score.get('home',0)}-{score.get('away',0)}: {score.get('prob',0):.1f}%")

    # Stats de equipos
    if h_stats:
        lines.append(f"\n[{home.upper()} STATS]")
        lines.append(f"  GF/pj: {_fmt(h_stats.get('avg_goals'))} | GC/pj: {_fmt(h_stats.get('avg_conceded'))}")
        lines.append(f"  Forma: {h_stats.get('form_string','---')} | Racha: {h_stats.get('current_streak_count',0)}{h_stats.get('current_streak_type','')}")
        lines.append(f"  CS rate: {_fmt(h_stats.get('clean_sheet_rate'),1)} | Score rate: {_fmt(h_stats.get('scoring_rate'),1)}")
    if a_stats:
        lines.append(f"[{away.upper()} STATS]")
        lines.append(f"  GF/pj: {_fmt(a_stats.get('avg_goals'))} | GC/pj: {_fmt(a_stats.get('avg_conceded'))}")
        lines.append(f"  Forma: {a_stats.get('form_string','---')} | Racha: {a_stats.get('current_streak_count',0)}{a_stats.get('current_streak_type','')}")

    # SofaScore stats detallados
    if h_sofa:
        lines.append(f"[SOFA {home.upper()}] xG:{_fmt(h_sofa.get('avg_xg_sofascore'))} "
                     f"Pos:{_fmt(h_sofa.get('avg_possession'),1)}% "
                     f"Tiros:{_fmt(h_sofa.get('avg_shots'),1)} "
                     f"Corners:{_fmt(h_sofa.get('avg_corners_for'),1)} "
                     f"Tarjetas:{_fmt(h_sofa.get('avg_yellow_cards'),1)} "
                     f"Faltas:{_fmt(h_sofa.get('avg_fouls_committed'),1)}")
    if a_sofa:
        lines.append(f"[SOFA {away.upper()}] xG:{_fmt(a_sofa.get('avg_xg_sofascore'))} "
                     f"Pos:{_fmt(a_sofa.get('avg_possession'),1)}% "
                     f"Tiros:{_fmt(a_sofa.get('avg_shots'),1)} "
                     f"Corners:{_fmt(a_sofa.get('avg_corners_for'),1)} "
                     f"Tarjetas:{_fmt(a_sofa.get('avg_yellow_cards'),1)} "
                     f"Faltas:{_fmt(a_sofa.get('avg_fouls_committed'),1)}")

    # H2H
    if h2h and h2h.get("total", 0) > 0:
        t = h2h["total"]
        lines.append(f"\n[H2H {t}pj] {home}:{h2h.get('home_wins',0)}V Empates:{h2h.get('draws',0)} {away}:{h2h.get('away_wins',0)}V | Avg goles: {h2h.get('avg_goals_h2h',0)}")
        for r in h2h.get("last_5", [])[:3]:
            d = r.get("date", "")[:10]
            lines.append(f"  {d}: {r.get('home','')} {r.get('score','')} {r.get('away','')}")

    # Draftea picks pre-calculados
    if draftea:
        lines.append("\n[PICKS DRAFTEA PRE-CALCULADOS]")
        for pick in draftea:
            lines.append(f"  PICK {pick.get('market','')}: {pick.get('selection','')} | Confianza: {pick.get('confidence',0):.0f}%")

    if analysis:
        lines.append("\n[FACTORES DE ANALISIS]")
        for i, a in enumerate(analysis[:6], 1):
            lines.append(f"  {i}. {a}")

    lines.append("\n=== USA ESTOS DATOS COMO UNICA FUENTE. DA PICKS PARA TODOS LOS MERCADOS DRAFTEA ===")
    return "\n".join(lines)


# ── Construccion de mensajes ────────────────────────────────────────────────

def _build_messages(
    message: str,
    history: list,
    prediction_context: Optional[dict],
    realtime_context: str,
) -> list:
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]

    if prediction_context:
        ctx = _build_prediction_context_str(prediction_context)
        messages.append({
            "role": "system",
            "content": f"DATOS DEL PARTIDO (fuente: SofaScore + football-data.org):\n\n{ctx}\n\nInstruccion: Usa SOLO estos datos. Da picks para TODOS los mercados Draftea."
        })

    if realtime_context:
        messages.append({
            "role": "system",
            "content": f"INFORMACION EN TIEMPO REAL:\n\n{realtime_context}\n\nUsa estos datos en tu respuesta."
        })

    for entry in (history[-12:] if len(history) > 12 else history):
        role = entry.get("role", "user")
        content = entry.get("content", "")
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})

    messages.append({"role": "user", "content": message})
    return messages


# ── Seleccion de modelo ─────────────────────────────────────────────────────

MODEL_PREFERENCE = ["llama3:8b", "llama3", "qwen2.5:7b", "qwen2.5:3b", "mistral", "phi"]


def _select_best_model(available_models: list) -> tuple:
    if OLLAMA_MODEL in available_models:
        is_llama3 = "llama3" in OLLAMA_MODEL.lower()
        return OLLAMA_MODEL, LLAMA3_OPTIONS if is_llama3 else DEFAULT_OLLAMA_OPTIONS
    for preferred in MODEL_PREFERENCE:
        for m in available_models:
            if preferred in m.lower():
                is_llama3 = "llama3" in m.lower()
                return m, LLAMA3_OPTIONS if is_llama3 else DEFAULT_OLLAMA_OPTIONS
    return available_models[0], DEFAULT_OLLAMA_OPTIONS


# ── Fallback inteligente ────────────────────────────────────────────────────

def _fallback_response(
    message: str,
    prediction_context: Optional[dict],
    realtime_context: str,
    intent: str,
) -> str:
    if realtime_context and "[DATOS_TIEMPO_REAL" in realtime_context:
        clean = realtime_context.strip()
        if intent == "live":
            if "Sin partidos en vivo" in clean:
                remaining = clean.replace("[DATOS_TIEMPO_REAL: Sin partidos en vivo en este momento]\n", "").strip()
                return "No hay partidos en vivo en este momento.\n\n" + (remaining or "Puedes preguntarme por los proximos partidos.")
            return "Partidos en vivo ahora mismo:\n\n" + clean
        if intent == "upcoming":
            return "Proximos partidos:\n\n" + clean
        return clean

    if not prediction_context:
        if intent == "greeting":
            return (
                "Soy PredictIA v6, tu asistente experto en futbol y apuestas deportivas para Draftea.\n\n"
                "Puedo ayudarte con:\n"
                "- Partidos en vivo: datos de SofaScore en tiempo real\n"
                "- Partidos de hoy: agenda completa\n"
                "- Proximos partidos: fixture de la semana\n"
                "- Predicciones completas: 1X2, Over/Under, BTTS, Corners, Tarjetas, Marcador exacto\n"
                "- Picks Draftea: recomendaciones con confianza y value\n\n"
                "Selecciona liga y equipos arriba, o preguntame directamente."
            )
        return (
            "Puedo ayudarte con:\n"
            "- Partidos en vivo o de hoy\n"
            "- Proximos partidos\n"
            "- Predicciones y picks Draftea\n\n"
            "Selecciona liga y equipos para un analisis completo."
        )

    # Fallback con datos de prediccion
    home = prediction_context.get("home_team", "Local")
    away = prediction_context.get("away_team", "Visitante")
    pred = prediction_context.get("predicted_result", "?")
    conf = prediction_context.get("confidence", 0)
    probs = prediction_context.get("probabilities", {})
    hp = float(probs.get("home", 0))
    dp = float(probs.get("draw", 0))
    ap = float(probs.get("away", 0))
    o25p = float(prediction_context.get("over_25_prob", 0))
    btts = float(prediction_context.get("btts_prob", 0))
    egh = float(prediction_context.get("expected_home_goals", 0))
    ega = float(prediction_context.get("expected_away_goals", 0))

    corners = prediction_context.get("corners", {})
    cards = prediction_context.get("cards", {})

    lines = [
        f"ANALISIS COMPLETO: {home} vs {away}",
        f"{'='*50}",
        f"Prediccion: {pred.upper()} | Confianza: {conf:.1f}%",
        f"",
        f"1X2: {home} {hp:.1f}% | Empate {dp:.1f}% | {away} {ap:.1f}%",
        f"xG: {egh:.2f} vs {ega:.2f} | Over 2.5: {o25p:.0f}% | BTTS: {btts:.0f}%",
    ]

    if corners:
        ct = corners.get("predicted_total", "?")
        lines.append(f"Corners: ~{ct} total | O9.5: {_fmt(corners.get('over_9_5_prob'),0)}%")
    if cards:
        cdt = cards.get("predicted_total", "?")
        lines.append(f"Tarjetas: ~{cdt} total | O4.5: {_fmt(cards.get('over_4_5_prob'),0)}%")

    lines.append("\n(Activa Ollama con `ollama serve` para analisis conversacional completo)")
    return "\n".join(lines)


# ── Funcion principal ────────────────────────────────────────────────────────

def chat(
    message: str,
    history: list = None,
    prediction_context: Optional[dict] = None,
) -> str:
    if history is None:
        history = []

    try:
        intent = _detect_intent(message)
        logger.info("Intent: %s | Msg: %.80s", intent, message)

        realtime_context = ""
        try:
            realtime_context = _fetch_realtime_context(message, intent)
            if realtime_context:
                logger.info("Ctx tiempo real: %d chars", len(realtime_context))
        except Exception as e:
            logger.warning(f"Error obteniendo contexto: {e}")

        status = check_ollama_status()
        if not status["online"] or not status.get("models"):
            logger.info("Ollama offline - fallback con datos reales")
            return _fallback_response(message, prediction_context, realtime_context, intent)

        model, model_options = _select_best_model(status.get("models", []))
        logger.info("Modelo: %s", model)

        messages = _build_messages(message, history, prediction_context, realtime_context)
        payload = {
            "model": model,
            "messages": messages,
            "stream": False,
            "options": model_options,
        }

        for endpoint in ["/api/chat", "/api/generate"]:
            try:
                resp = requests.post(
                    f"{OLLAMA_BASE_URL}{endpoint}",
                    json=payload,
                    timeout=(OLLAMA_CONNECT_TIMEOUT, OLLAMA_READ_TIMEOUT),
                )
                if resp.status_code in (404, 405):
                    continue
                resp.raise_for_status()
                content = None
                try:
                    content = _extract_ollama_response(resp.json())
                except ValueError:
                    raw = resp.text.strip()
                    if raw:
                        content = raw

                if not content:
                    raw = resp.text.strip()
                    if raw and raw != "null":
                        content = raw

                if content:
                    logger.info("Respuesta Ollama: %s (%d chars)", endpoint, len(content))
                    return content

            except requests.exceptions.Timeout:
                logger.warning("Timeout en %s", endpoint)
                return _fallback_response(message, prediction_context, realtime_context, intent)
            except requests.exceptions.ConnectionError:
                logger.warning("Ollama desconectado")
                return _fallback_response(message, prediction_context, realtime_context, intent)
            except Exception as exc:
                logger.warning("Error en %s: %s", endpoint, exc)
                continue

        return _fallback_response(message, prediction_context, realtime_context, intent)

    except Exception as e:
        logger.error(f"Error critico en chat(): {e}", exc_info=True)
        return (
            "Error procesando tu pregunta.\n\n"
            "Asegurate de que:\n"
            "1. Ollama esta corriendo (`ollama serve`)\n"
            "2. El modelo llama3:8b esta instalado (`ollama pull llama3:8b`)\n"
            "3. Hay conectividad con la API"
        )
