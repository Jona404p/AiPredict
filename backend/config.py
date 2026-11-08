"""
PredictIA v6 - Configuracion Central
Optimizado para llama3:8b + Draftea
"""

import os

# ─── API Keys ───────────────────────────────────────────────────────────────
FOOTBALL_API_KEY = os.getenv("FOOTBALL_API_KEY", "4137dd8f6a13400d928823c2e24e9205")

# ─── Base de Datos ──────────────────────────────────────────────────────────
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./predictia.db")

# ─── Ollama (Chatbot) ──────────────────────────────────────────────────────
OLLAMA_URL = os.getenv("OLLAMA_URL", os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434"))
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3:8b")

# ─── Ligas soportadas (football-data.org v4) ───────────────────────────────
LEAGUES = {
    "premier":           {"code": "PL",    "understat": "EPL",        "name": "Premier League",        "country": "England",    "tier": 1},
    "championship":      {"code": "ELC",   "understat": None,         "name": "Championship",           "country": "England",    "tier": 2},
    "laliga":            {"code": "PD",    "understat": "La_liga",    "name": "La Liga",               "country": "Spain",      "tier": 1},
    "seriea":            {"code": "SA",    "understat": "Serie_A",    "name": "Serie A",               "country": "Italy",      "tier": 1},
    "bundesliga":        {"code": "BL1",   "understat": "Bundesliga", "name": "Bundesliga",            "country": "Germany",    "tier": 1},
    "bundesliga2":       {"code": "BL2",   "understat": None,         "name": "2. Bundesliga",         "country": "Germany",    "tier": 2},
    "ligue1":            {"code": "FL1",   "understat": "Ligue_1",    "name": "Ligue 1",               "country": "France",     "tier": 1},
    "ligue2":            {"code": "FL2",   "understat": None,         "name": "Ligue 2",               "country": "France",     "tier": 2},
    "eredivisie":        {"code": "DED",   "understat": None,         "name": "Eredivisie",            "country": "Netherlands","tier": 1},
    "primeiraliga":      {"code": "PPL",   "understat": None,         "name": "Primeira Liga",         "country": "Portugal",   "tier": 1},
    "jupilerleague":     {"code": "JUP",   "understat": None,         "name": "Belgian Pro League",    "country": "Belgium",    "tier": 1},
    "superlig":          {"code": "TUR",   "understat": None,         "name": "Super Lig",             "country": "Turkey",     "tier": 1},
    "ligamx":            {"code": "MX1",   "understat": None,         "name": "Liga MX",               "country": "Mexico",     "tier": 1},
    "brasileirao":       {"code": "BSA",   "understat": None,         "name": "Brasileirao",           "country": "Brazil",     "tier": 1},
    "argprimera":        {"code": "ARG",   "understat": None,         "name": "Primera Division",      "country": "Argentina",  "tier": 1},
    "mls":               {"code": "MLS",   "understat": None,         "name": "MLS",                   "country": "USA",        "tier": 1},
    "champions":         {"code": "CL",    "understat": None,         "name": "Champions League",      "country": "UEFA",       "tier": 0},
    "europa":            {"code": "EL",    "understat": None,         "name": "Europa League",         "country": "UEFA",       "tier": 0},
    "conference":        {"code": "UECL",  "understat": None,         "name": "Conference League",     "country": "UEFA",       "tier": 0},
    "worldcup":          {"code": "WC",    "understat": None,         "name": "World Cup",             "country": "FIFA",       "tier": 0},
    "euro":              {"code": "EC",    "understat": None,         "name": "European Championship", "country": "UEFA",       "tier": 0},
    "copa_libertadores": {"code": "CLI",   "understat": None,         "name": "Copa Libertadores",     "country": "CONMEBOL",   "tier": 0},
}

LEAGUE_GROUPS = {
    "Top Europa":        ["premier", "laliga", "seriea", "bundesliga", "ligue1"],
    "Europa":            ["eredivisie", "primeiraliga", "jupilerleague", "superlig", "championship", "bundesliga2", "ligue2"],
    "Americas":          ["ligamx", "brasileirao", "argprimera", "mls"],
    "Internacionales":   ["champions", "europa", "conference", "copa_libertadores", "worldcup", "euro"],
}

# ─── SofaScore ──────────────────────────────────────────────────────────────
SOFASCORE_BASE = "https://api.sofascore.com/api/v1"
SOFASCORE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "es-MX,es;q=0.9,en;q=0.8",
    "Referer": "https://www.sofascore.com/",
    "Origin": "https://www.sofascore.com",
    "Cache-Control": "no-cache",
}

SOFASCORE_TOURNAMENT_IDS = {
    "premier": 17, "laliga": 8, "seriea": 23, "bundesliga": 35,
    "ligue1": 34, "eredivisie": 37, "primeiraliga": 238,
    "champions": 7, "europa": 679, "conference": 17015,
    "ligamx": 352, "mls": 242, "brasileirao": 325,
    "superlig": 52, "jupilerleague": 38, "championship": 18,
    "bundesliga2": 44, "ligue2": 182, "argprimera": 155,
}

SOFASCORE_CACHE_TTL_LIVE   = 30
SOFASCORE_CACHE_TTL_STATS  = 300
SOFASCORE_CACHE_TTL_STATIC = 3600

# ─── Modelo ML ──────────────────────────────────────────────────────────────
MODEL_PATH  = "models/football_model.pkl"
SCALER_PATH = "models/scaler.pkl"
FEATURE_WINDOW = 5
MIN_MATCHES    = 5

# ─── Servidor ───────────────────────────────────────────────────────────────
API_HOST = "0.0.0.0"
API_PORT = 8000

# ─── Draftea Markets Config ────────────────────────────────────────────────
DRAFTEA_MARKETS = {
    "1x2": True,
    "over_under": True,
    "btts": True,
    "corners": True,
    "cards": True,
    "exact_score": True,
    "handicap": True,
}

DRAFTEA_CONFIDENCE_THRESHOLDS = {
    "high": 70,
    "medium": 55,
    "low": 40,
}
