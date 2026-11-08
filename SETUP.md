# PredictIA v6 - Guía de Configuración Completa

Una aplicación full-stack de predicciones futbolísticas con IA local usando **Next.js**, **football-data.org**, **SofaScore**, y **Ollama**.

## Requisitos Previos

- Node.js 18+ (recomendado 20+)
- pnpm, npm o yarn
- Ollama instalado y corriendo
- API key de football-data.org (gratuito)

## Instalación Rápida (5-10 minutos)

### 1. Instalar y Ejecutar Ollama

```bash
# Descarga Ollama desde https://ollama.ai
# Instala según tu SO (Windows/Mac/Linux)

# En una terminal, inicia Ollama
ollama serve

# En otra terminal, descarga un modelo (elige uno)
# Recomendado para rápido:
ollama pull llama2

# O más potente pero lento:
ollama pull llama3

# O alternativas eficientes:
ollama pull mistral
ollama pull neural-chat

# Verifica que está corriendo:
curl http://localhost:11434/api/tags
```

**Si ves "address already in use":**
```bash
# El puerto 11434 ya está ocupado
# Opción 1: Usa el proceso existente (probablemente Ollama)
ps aux | grep ollama

# Opción 2: Mata el proceso y reinicia
lsof -i :11434
kill -9 <PID>

# Opción 3: Cambia el puerto (edita OLLAMA_BASE_URL en .env.local)
export OLLAMA_LISTEN=127.0.0.1:11435
ollama serve
```

### 2. Configurar Variables de Entorno

```bash
# En la raíz del proyecto
cp .env.example .env.local

# Edita .env.local y actualiza (ya incluye tu API key):
FOOTBALL_DATA_API_KEY=4137dd8f6a13400d928823c2e24e9205
OLLAMA_BASE_URL=http://localhost:11434
```

### 3. Instalar Dependencias e Iniciar

```bash
pnpm install

# Inicia el dev server
pnpm dev

# Abre en el navegador
http://localhost:3000
```

## Estructura del Proyecto

```
app/
├── api/
│   ├── chat/          # Chat streaming con Ollama
│   ├── predict/       # Predicciones de partidos
│   ├── live/          # Partidos en vivo (SofaScore)
│   ├── upcoming/      # Partidos próximos (Football-Data)
│   ├── standings/     # Tabla de posiciones (Football-Data)
│   ├── leagues/       # Ligas disponibles
│   ├── status/        # Estado de servicios
│   └── teams/         # Equipos por liga
├── layout.tsx         # Layout principal con theme oscuro
└── page.tsx           # Home con sidebar navigation

components/
├── chat-interface.tsx
├── prediction-card.tsx
├── live-matches-panel.tsx
├── league-selector.tsx
└── views/
    ├── upcoming-view.tsx
    ├── live-view.tsx
    ├── standings-view.tsx
    └── train-view.tsx

lib/
├── football-data.ts   # Cliente football-data.org API
├── sofascore.ts       # Cliente SofaScore (sin API key)
└── ollama.ts          # Cliente Ollama local
```

## Servicios Integrados

### 1. **football-data.org** (Datos Estructurados)
- **API Key:** `4137dd8f6a13400d928823c2e24e9205`
- **Rate limit:** 100 requests/min (gratuito)
- **Ligas soportadas:**
  - La Liga (PD)
  - Premier League (PL)
  - Serie A (SA)
  - Bundesliga (BL1)
  - Ligue 1 (FL1)
  - Champions League (CL)
  - Europa League (EL)

**Uso:** Próximos partidos, tabla de posiciones, info de equipos.

### 2. **SofaScore** (Datos en Tiempo Real)
- **Sin API key requerida**
- **Datos:** Partidos en vivo, estadísticas, alineaciones
- **Rate limit:** Generoso (público)

**Uso:** Partidos en vivo, estadísticas detalladas.

### 3. **Ollama** (IA Local)
- **Modelos recomendados:**
  - `llama2` (7B, rápido, recomendado para empezar)
  - `mistral` (7B, eficiente, buena calidad)
  - `neural-chat` (7B, optimizado para chat)
  - `llama3` (8B, mejor calidad, más lento)

- **Características:**
  - Predicciones de partidos con razonamiento
  - Chat sobre futbol
  - Análisis de mercados de apuestas (1X2, Over/Under, BTTS, Corners, Tarjetas)
  - Totalmente local y privado

## API Routes

### GET `/api/leagues`
Retorna ligas disponibles con información.

```bash
curl http://localhost:3000/api/leagues
```

### GET `/api/live`
Partidos en vivo y próximos (revalidate: 30s).

```bash
curl http://localhost:3000/api/live
```

### GET `/api/upcoming?league=La%20Liga`
Próximos partidos de una liga (revalidate: 1h).

```bash
curl "http://localhost:3000/api/upcoming?league=La%20Liga"
```

### GET `/api/standings?league=La%20Liga`
Tabla de posiciones (revalidate: 2h).

```bash
curl "http://localhost:3000/api/standings?league=La%20Liga"
```

### POST `/api/predict`
Predicción de un partido con Ollama.

```bash
curl -X POST http://localhost:3000/api/predict \
  -H "Content-Type: application/json" \
  -d '{
    "homeTeam": "Real Madrid",
    "awayTeam": "Barcelona",
    "league": "La Liga",
    "homeForm": "WWDWW",
    "awayForm": "WWWDL"
  }'
```

### POST `/api/chat`
Chat streaming con Ollama.

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "¿Quién es el máximo goleador de la Liga 2024?"}
    ]
  }'
```

### GET `/api/status`
Estado de todos los servicios (revalidate: 60s).

```bash
curl http://localhost:3000/api/status
```

## Troubleshooting

### ❌ Ollama Connection Refused

**Síntomas:** Error "connection refused" o timeout en predicciones.

**Soluciones:**
```bash
# 1. Verifica que Ollama está corriendo
curl http://localhost:11434/api/tags

# 2. Reinicia Ollama
# Mata todos los procesos:
pkill -f ollama

# Vuelve a iniciar:
ollama serve

# 3. Cambia puerto si está ocupado
export OLLAMA_LISTEN=127.0.0.1:11435
ollama serve
# Actualiza OLLAMA_BASE_URL en .env.local

# 4. Verifica firewall/network
# En Windows: netstat -ano | findstr :11434
# En Mac/Linux: lsof -i :11434
```

### ❌ "address already in use" error

```bash
# Encuentra el proceso usando puerto 11434
lsof -i :11434

# Mata el proceso (reemplaza PID)
kill -9 <PID>

# O espera 1 minuto y reintenta
```

### ❌ Predicciones muy lentas

**Problema:** Ollama toma >30s en responder.

**Soluciones:**
```bash
# 1. Usa modelo más rápido
ollama pull mistral
# Cambia OLLAMA_DEFAULT_MODEL=mistral en .env.local

# 2. Aumenta VRAM/GPU
# Ver: https://github.com/ollama/ollama/blob/main/docs/gpu.md

# 3. O ejecuta en CPU (más lento pero siempre funciona)
OLLAMA_NUM_GPU=0 ollama serve
```

### ❌ Football-Data API Error (401/403)

**Problema:** "Invalid or expired API key"

**Soluciones:**
```bash
# 1. Verifica que FOOTBALL_DATA_API_KEY está en .env.local
cat .env.local | grep FOOTBALL_DATA_API_KEY

# 2. Copia el valor correcto:
FOOTBALL_DATA_API_KEY=4137dd8f6a13400d928823c2e24e9205

# 3. Reinicia el dev server:
pnpm dev

# 4. Verifica en API status:
curl http://localhost:3000/api/status
```

### ❌ "Module not found" errors

```bash
# 1. Reinstala dependencias
rm -rf node_modules pnpm-lock.yaml
pnpm install

# 2. Limpia cache de Next
rm -rf .next

# 3. Reinicia dev server
pnpm dev
```

### ❌ SofaScore data no carga

**Problema:** Partidos en vivo muestran demo data.

**Soluciones:**
```bash
# SofaScore es un fallback cuando football-data tarda
# Verifica que FOOTBALL_DATA_API_KEY está configurada
curl http://localhost:3000/api/status

# SofaScore no necesita API key, pero el servidor
# debe tener acceso a internet

# Intenta manual:
curl https://api.sofascore.com/api/v1/sport/football/events/live
```

## Development

### Agregar un modelo Ollama nuevo

```bash
# Descarga
ollama pull neural-chat

# Actualiza .env.local:
OLLAMA_DEFAULT_MODEL=neural-chat

# Usa en requests:
curl -X POST http://localhost:3000/api/chat \
  -d '{"messages": [...], "model": "neural-chat"}'
```

### Agregar una nueva liga

En `lib/football-data.ts`, actualiza `LEAGUE_CODES`:

```typescript
const LEAGUE_CODES: Record<string, string> = {
  'La Liga': 'PD',
  'Premier League': 'PL',
  'Tu Liga': 'CODE', // Agregar aquí
};
```

Obtén el código desde: https://www.football-data.org/competitions

### Customizar prompts de Ollama

En `lib/ollama.ts`, modifica `buildPredictionPrompt()` para cambiar el formato de predicciones.

## Performance

| Métrica | Valor |
|---------|-------|
| Partidos en vivo (SofaScore) | ~1-2s |
| Próximos partidos (Football-Data) | ~0.5-1s |
| Tabla de posiciones (Football-Data) | ~0.5-1s |
| Predicción de partido (Ollama) | ~15-45s dependiendo del modelo |
| Chat (Ollama streaming) | Respuesta inmediata (stream) |

## Modelos Ollama Recomendados

| Modelo | Tamaño | Velocidad | Calidad | Recomendación |
|--------|--------|-----------|---------|---------------|
| llama2 | 7B | ⚡⚡⚡ | ⭐⭐⭐ | Mejor relación |
| mistral | 7B | ⚡⚡⭐ | ⭐⭐⭐ | Eficiente |
| neural-chat | 7B | ⚡⭐⭐ | ⭐⭐⭐ | Chat específico |
| llama3 | 8B | ⭐⭐⭐ | ⭐⭐⭐⭐ | Más potente |

## Cambios en el Puerto

Si necesitas cambiar puertos:

```bash
# Next.js (por defecto 3000)
pnpm dev -- -p 4000

# Ollama (por defecto 11434)
export OLLAMA_LISTEN=127.0.0.1:11435
ollama serve

# Actualiza .env.local:
OLLAMA_BASE_URL=http://localhost:11435
```

## Seguridad

- Ollama corre localmente (sin internet)
- football-data.org: No almacena datos sensibles
- SofaScore: API pública, sin autenticación requerida
- Predicciones: No hay almacenamiento de historial (por defecto)

## Licencias

- **Next.js:** MIT
- **football-data.org:** Free (100 req/min)
- **SofaScore:** Public API
- **Ollama:** MIT

## Contacto & Soporte

- Issues: Github
- Documentación: `SETUP.md` (este archivo)
- Status: `/api/status` endpoint
