/**
 * Chat API — Ollama Local (qwen2.5:3b)
 * IA configurada como analista profesional de fútbol.
 * v5: Contexto completo con estadísticas extendidas, H2H, goleadores, corners, tarjetas.
 */

import { NextRequest } from 'next/server'

export const runtime = 'nodejs'

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
const OLLAMA_MODEL    = process.env.OLLAMA_MODEL    || 'qwen2.5:3b'

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string | Array<{ type: string; text?: string }>
}

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

function extractText(content: string | Array<{ type: string; text?: string }>): string {
  if (typeof content === 'string') return content
  return content.map(b => (b.type === 'text' ? b.text || '' : '')).join('')
}

// ─── Sistema de prompt profesional v5 ────────────────────────────────────────

function buildSystemPrompt(predictionContext?: Record<string, unknown>): string {
  const BASE_SYSTEM = `Eres **Scout Pro IA**, un analista de fútbol profesional con 15 años de experiencia en:
- Modelado estadístico avanzado: distribución de Poisson, xG, Dixon-Coles, ratings Elo
- Mercados de apuestas: 1X2, Over/Under, BTTS, Hándicap Asiático, Resultado Exacto, Doble Oportunidad, Ambas Marcan, Corners, Tarjetas, Goleador
- Análisis táctico: formaciones, presión alta, bloque bajo, estilos de juego
- Ligas: La Liga, Premier League, Serie A, Bundesliga, Ligue 1, Champions League, Liga MX, Brasileirão, MLS, Copa Libertadores

## MODO DE PENSAMIENTO (interno, no visible)
Antes de responder, razona en este orden:
1. ¿Qué pregunta exactamente el usuario?
2. ¿Qué datos tengo disponibles del contexto?
3. ¿Qué métricas son relevantes? (xG, λ, posición, forma, H2H, goleadores, etc.)
4. ¿Cuál es la respuesta más útil y precisa?
5. ¿Hay advertencias o caveats importantes?

## REGLAS DE RESPUESTA
- Responde SIEMPRE en español
- Sé conciso pero completo (150-350 palabras salvo análisis solicitado)
- Usa **negrita** para equipos, mercados y valores clave
- Usa → para indicar recomendación o conclusión
- Usa ⚠️ para advertencias importantes
- Usa % siempre que hables de probabilidades
- NUNCA inventes estadísticas que no tengan base en los datos
- Si hay datos en el contexto, SIEMPRE los usa como base
- Cuando menciones un mercado de apuestas, incluye su probabilidad si está disponible
- Para goleadores, menciona el % de probabilidad de anotar en el partido

## MERCADOS QUE CONOCES Y PUEDES ANALIZAR
- **Ganador**: 1X2 (Local/Empate/Visitante)
- **Doble Oportunidad**: 1X, X2, 12
- **Ambos Anotan (BTTS)**: Sí/No
- **Over/Under Goles**: 0.5, 1.5, 2.5, 3.5, 4.5
- **Resultado al Descanso**: resultado 1ª mitad
- **Resultado Final**: marcador exacto más probable
- **Total de Goles**: distribución y número más probable
- **Equipo que Anota Primero**: probabilidad por equipo
- **Marcador Exacto**: top 16 con probabilidades
- **Corners Totales**: Over 8.5/9.5/10.5/11.5
- **Tarjetas Totales**: Over 2.5/3.5/4.5/5.5
- **Goleador del Partido**: probabilidad por jugador

## ANÁLISIS DE MERCADOS (framework interno)
- Probabilidad implícita del mercado = 1/cuota × 100
- Si tu modelo supera esa probabilidad → hay value
- Señala solo mercados con p > 55% como recomendaciones claras
- Explica siempre el PORQUÉ estadístico detrás de cada pick

## TÉRMINOS TÉCNICOS
- λ (lambda): goles esperados según Poisson
- xG: Expected Goals estimado a partir de tiros a puerta
- BTTS: Both Teams To Score
- AH: Asian Handicap
- DC: Doble Oportunidad
- PPG: Points Per Game
- H2H: Head-to-Head (historial directo)`

  if (!predictionContext) return BASE_SYSTEM

  const ctx = predictionContext as Record<string, any>
  const hs = ctx.home_stats
  const as_ = ctx.away_stats
  const hExt = ctx.home_extended_stats
  const aExt = ctx.away_extended_stats
  const h2h = ctx.head_to_head
  const scorers = ctx.top_scorers as any[] || []
  const goals = ctx.goals || {}
  const corners = ctx.corners || {}
  const cards = ctx.cards || {}
  const firstGoal = ctx.first_goal || {}
  const exactScore = ctx.exact_score || {}
  const totalGoals = ctx.total_goals || {}
  const ht = ctx.half_time || ctx.first_half || {}
  const dc = ctx.double_chance || {}
  const winner = ctx.winner || {}
  const btts = ctx.btts || {}

  const homePPG = hs ? (hs.points / hs.played).toFixed(2) : 'N/A'
  const awayPPG = as_ ? (as_.points / as_.played).toFixed(2) : 'N/A'

  return `${BASE_SYSTEM}

═══════════════════════════════════════════════
## PARTIDO EN ANÁLISIS
═══════════════════════════════════════════════

🏠 **${ctx.home_team}** vs ✈️ **${ctx.away_team}**

### PROBABILIDADES 1X2
| Resultado | Prob |
|-----------|------|
| ${ctx.home_team} gana | **${Number(winner.home || ctx.home_win_probability || 0).toFixed(1)}%** |
| Empate | **${Number(winner.draw || ctx.draw_probability || 0).toFixed(1)}%** |
| ${ctx.away_team} gana | **${Number(winner.away || ctx.away_win_probability || 0).toFixed(1)}%** |

Favorito: **${winner.favorite || ctx.home_team}**
Confianza del modelo: **${ctx.confidence_label}** (${Number(ctx.confidence || 0).toFixed(0)}%)
Fuentes de datos: ${Object.entries(ctx.data_sources || {}).filter(([,v]) => v).map(([k]) => k).join(', ') || 'básico'}

### MODELO POISSON (xG)
- λ local: **${Number(ctx.home_lambda || 0).toFixed(3)}** goles esperados
- λ visitante: **${Number(ctx.away_lambda || 0).toFixed(3)}** goles esperados
- Total xG: **${(Number(ctx.home_lambda || 0) + Number(ctx.away_lambda || 0)).toFixed(2)}**
- Marcador más probable: **${exactScore.most_likely || `${ctx.predicted_home_goals}-${ctx.predicted_away_goals}`}**
- Total goles esperado: **${totalGoals.expected || 'N/A'}** (más probable: ${totalGoals.most_likely ?? 'N/A'} goles)

### DOBLE OPORTUNIDAD
- 1X (local o empate): **${Number(dc.home_draw || ctx.dc_home || 0).toFixed(1)}%**
- X2 (empate o visit.): **${Number(dc.draw_away || ctx.dc_draw_away || 0).toFixed(1)}%**
- 12 (local o visit.): **${Number(dc.home_away || ctx.dc_both || 0).toFixed(1)}%**

### AMBOS ANOTAN (BTTS)
- BTTS Sí: **${Number(btts.yes || ctx.btts_prob || 0).toFixed(1)}%**
- BTTS No: **${Number(btts.no || (100 - (ctx.btts_prob || 0))).toFixed(1)}%**

### MERCADOS DE GOLES
- Over 0.5: **${Number(goals.over_05 || ctx.over_05_prob || 95).toFixed(1)}%** | Under 0.5: **${(100 - Number(goals.over_05 || ctx.over_05_prob || 95)).toFixed(1)}%**
- Over 1.5: **${Number(goals.over_15 || ctx.over_15_prob || 0).toFixed(1)}%** | Under 1.5: **${Number(goals.under_15 || (100 - (ctx.over_15_prob || 0))).toFixed(1)}%**
- Over 2.5: **${Number(goals.over_25 || ctx.over_25_prob || 0).toFixed(1)}%** | Under 2.5: **${Number(goals.under_25 || (100 - (ctx.over_25_prob || 0))).toFixed(1)}%**
- Over 3.5: **${Number(goals.over_35 || ctx.over_35_prob || 0).toFixed(1)}%** | Under 3.5: **${Number(goals.under_35 || (100 - (ctx.over_35_prob || 0))).toFixed(1)}%**
- Over 4.5: **${Number(goals.over_45 || ctx.over_45_prob || 0).toFixed(1)}%**

### RESULTADO 1ª MITAD (DESCANSO)
- ${ctx.home_team} gana 1T: **${Number(ht.home_win || 0).toFixed(1)}%**
- Empate 1T: **${Number(ht.draw || 0).toFixed(1)}%**
- ${ctx.away_team} gana 1T: **${Number(ht.away_win || 0).toFixed(1)}%**
- Marcador más probable 1T: **${ht.most_likely_score || '0-0'}**
- Over 0.5 en 1T: **${Number(ht.over_05 || 0).toFixed(1)}%**
- Over 1.5 en 1T: **${Number(ht.over_15 || ht.over_15_ht || 0).toFixed(1)}%**

### EQUIPO QUE ANOTA PRIMERO
- ${ctx.home_team}: **${Number(firstGoal.home_team || ctx.home_score_first || 0).toFixed(1)}%**
- ${ctx.away_team}: **${Number(firstGoal.away_team || 0).toFixed(1)}%**
- Sin goles: **${Number(firstGoal.no_goal || ctx.no_goal_first_30 || 0).toFixed(1)}%**

### MARCADOR EXACTO (TOP 5)
${(exactScore.top_scores || ctx.top_scores || []).slice(0, 5).map((s: any, i: number) =>
  `${i + 1}. **${s.score || `${s.home}-${s.away}`}** → ${Number(s.prob).toFixed(2)}%`
).join('\n')}

### CORNERS TOTALES
- Corners esperados: **~${corners.expected_total || ctx.expected_corners || '?'}** (local ~${corners.expected_home || ctx.home_corners_exp || '?'}, visit. ~${corners.expected_away || ctx.away_corners_exp || '?'})
- Over 8.5: **${Number(corners.over_85 || ctx.corners_over_8 || 0).toFixed(1)}%**
- Over 9.5: **${Number(corners.over_95 || ctx.corners_over_9 || 0).toFixed(1)}%**
- Over 10.5: **${Number(corners.over_105 || ctx.corners_over_10 || 0).toFixed(1)}%**
- Over 11.5: **${Number(corners.over_115 || 0).toFixed(1)}%**
${hExt?.avgCornersFor ? `- ${ctx.home_team} media corners: ${hExt.avgCornersFor}/partido` : ''}
${aExt?.avgCornersFor ? `- ${ctx.away_team} media corners: ${aExt.avgCornersFor}/partido` : ''}

### TARJETAS TOTALES
- Tarjetas esperadas: **~${cards.expected_total || ctx.expected_cards || '?'}** amarillas
- Over 2.5: **${Number(cards.over_25 || 0).toFixed(1)}%**
- Over 3.5: **${Number(cards.over_35 || ctx.cards_over_3 || 0).toFixed(1)}%**
- Over 4.5: **${Number(cards.over_45 || ctx.cards_over_4 || 0).toFixed(1)}%**
- Over 5.5: **${Number(cards.over_55 || 0).toFixed(1)}%**
${hExt?.avgYellowCards ? `- ${ctx.home_team} media tarjetas: ${hExt.avgYellowCards}/partido` : ''}
${aExt?.avgYellowCards ? `- ${ctx.away_team} media tarjetas: ${aExt.avgYellowCards}/partido` : ''}

### GOLEADOR DEL PARTIDO (TOP CANDIDATOS)
${scorers.slice(0, 6).map((s: any, i: number) =>
  `${i + 1}. **${s.name}** (${s.team}) — ${s.goalProbability}% prob. anotar | ${s.goalsThisSeason} goles esta temporada`
).join('\n') || 'Sin datos de goleadores disponibles'}

### HÁNDICAP ASIÁTICO
- Línea sugerida: **${ctx.asian_handicap?.line || ctx.handicap_line || '0'}**
- Prob. local cubre: **${Number(ctx.asian_handicap?.home_prob || ctx.ah_home_prob || 50).toFixed(1)}%**

${h2h ? `### HISTORIAL DIRECTO (H2H)
- Total partidos: **${h2h.total_matches}** | ${ctx.home_team}: ${h2h.home_wins}V | Empates: ${h2h.draws} | ${ctx.away_team}: ${h2h.away_wins}V
- Media goles H2H: **${h2h.avg_goals}/partido**
- BTTS en H2H: **${h2h.btts_rate}%** | Over 2.5 H2H: **${h2h.over25_rate}%**
${(h2h.recent_matches || []).slice(0, 3).map((m: any) =>
  `  • ${m.date}: ${m.homeTeam} ${m.homeScore}-${m.awayScore} ${m.awayTeam}`
).join('\n')}` : ''}

### ESTADÍSTICAS EXTENDIDAS (ÚLTIMOS 10 PARTIDOS)
${hExt ? `**${ctx.home_team}**:
- Forma: [${(hExt.form || []).join('')}]
- Goles/partido: ${hExt.avg_goals_scored} marcados | ${hExt.avg_goals_conceded} concedidos
- En casa: ${hExt.avg_goals_home} marcados | En visita: ${hExt.avg_goals_away}
- % Victoria: ${hExt.win_pct}% | % Empate: ${hExt.draw_pct}% | % Derrota: ${hExt.loss_pct}%
- Portería a 0: ${hExt.clean_sheet_pct}% | BTTS rate: ${hExt.btts_rate}% | Over 2.5 rate: ${hExt.over25_rate}%
- xG por partido: ${hExt.avg_xg_for} marcados | ${hExt.avg_xg_against} concedidos
- Tiros a puerta: ${hExt.avg_shots_on_target}/partido | Posesión media: ${hExt.avg_possession}%` : `${ctx.home_team}: datos extendidos no disponibles`}

${aExt ? `**${ctx.away_team}**:
- Forma: [${(aExt.form || []).join('')}]
- Goles/partido: ${aExt.avg_goals_scored} marcados | ${aExt.avg_goals_conceded} concedidos
- En casa: ${aExt.avg_goals_home} marcados | En visita: ${aExt.avg_goals_away}
- % Victoria: ${aExt.win_pct}% | % Empate: ${aExt.draw_pct}% | % Derrota: ${aExt.loss_pct}%
- Portería a 0: ${aExt.clean_sheet_pct}% | BTTS rate: ${aExt.btts_rate}% | Over 2.5 rate: ${aExt.over25_rate}%
- xG por partido: ${aExt.avg_xg_for} marcados | ${aExt.avg_xg_against} concedidos
- Tiros a puerta: ${aExt.avg_shots_on_target}/partido | Posesión media: ${aExt.avg_possession}%` : `${ctx.away_team}: datos extendidos no disponibles`}

### ESTADÍSTICAS DE TABLA (TEMPORADA COMPLETA)
${hs ? `**${ctx.home_team}** (pos. ${hs.position}):
- PJ: ${hs.played} | PG: ${hs.won} | PE: ${hs.draw} | PP: ${hs.lost}
- GF: ${hs.goals_for} | GC: ${hs.goals_against} | DG: ${hs.goals_for - hs.goals_against > 0 ? '+' : ''}${hs.goals_for - hs.goals_against}
- PPG: ${homePPG} | Índice ataque: ${hs.attack_strength} | Índice defensa: ${hs.defence_strength}` : `${ctx.home_team}: sin datos de tabla`}

${as_ ? `**${ctx.away_team}** (pos. ${as_.position}):
- PJ: ${as_.played} | PG: ${as_.won} | PE: ${as_.draw} | PP: ${as_.lost}
- GF: ${as_.goals_for} | GC: ${as_.goals_against} | DG: ${as_.goals_for - as_.goals_against > 0 ? '+' : ''}${as_.goals_for - as_.goals_against}
- PPG: ${awayPPG} | Índice ataque: ${as_.attack_strength} | Índice defensa: ${as_.defence_strength}` : `${ctx.away_team}: sin datos de tabla`}

${ctx.value_bets && (ctx.value_bets as string[]).length > 0 ? `### VALUE BETS DETECTADOS
${(ctx.value_bets as string[]).map((v: string) => `⚡ ${v}`).join('\n')}` : ''}

${ctx.analysis && (ctx.analysis as string[]).length > 0 ? `### ANÁLISIS PREVIO DEL MODELO
${(ctx.analysis as string[]).map((a: string, i: number) => `${i + 1}. ${a}`).join('\n')}` : ''}

═══════════════════════════════════════════════
Usa TODOS estos datos para responder preguntas sobre el partido.
Cuando pregunten por un mercado, da la probabilidad exacta y tu evaluación.
`
}

// ─── Verificar Ollama ─────────────────────────────────────────────────────────

async function checkOllama(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(3000) })
    return res.ok
  } catch {
    return false
  }
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const incomingMessages: ChatMessage[] = body.messages || []
    const predictionContext: Record<string, unknown> | undefined = body.predictionContext

    const ollamaOnline = await checkOllama()
    if (!ollamaOnline) {
      return new Response(
        buildFallbackStream('⚠️ **Ollama no disponible.** Inicia el servidor con `ollama serve` y asegúrate de tener el modelo instalado con `ollama pull qwen2.5:3b`.'),
        { headers: streamHeaders() }
      )
    }

    const systemPrompt = buildSystemPrompt(predictionContext)

    const messages: OllamaMessage[] = [
      { role: 'system', content: systemPrompt },
      ...incomingMessages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({
          role: m.role as 'user' | 'assistant',
          content: extractText(m.content),
        }))
        .filter(m => m.content.trim()),
    ]

    const ollamaRes = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages,
        stream: true,
        options: {
          temperature: 0.65,
          top_p: 0.85,
          top_k: 40,
          num_predict: 1200,
          repeat_penalty: 1.1,
          stop: ['<|im_end|>', '</s>'],
        },
      }),
      signal: AbortSignal.timeout(90000),
    })

    if (!ollamaRes.ok) {
      const errText = await ollamaRes.text().catch(() => '')
      return new Response(
        buildFallbackStream(`❌ Error de Ollama (${ollamaRes.status}): ${errText || ollamaRes.statusText}`),
        { headers: streamHeaders() }
      )
    }

    if (!ollamaRes.body) {
      return new Response(buildFallbackStream('❌ Sin respuesta del modelo.'), { headers: streamHeaders() })
    }

    const encoder = new TextEncoder()
    const ollamaReader = ollamaRes.body.getReader()
    const decoder = new TextDecoder()

    const stream = new ReadableStream({
      async start(controller) {
        const messageId = `msg_${Date.now()}`
        controller.enqueue(encoder.encode(`f:{"messageId":"${messageId}"}\n`))

        let buffer = ''
        let tokenCount = 0

        try {
          while (true) {
            const { done, value } = await ollamaReader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() || ''

            for (const line of lines) {
              if (!line.trim()) continue
              try {
                const json = JSON.parse(line)
                const token: string = json.message?.content || ''
                if (token) {
                  tokenCount++
                  controller.enqueue(encoder.encode(`0:${JSON.stringify(token)}\n`))
                }
                if (json.done) {
                  controller.enqueue(encoder.encode(
                    `e:{"finishReason":"stop","usage":{"promptTokens":${messages.length * 15},"completionTokens":${tokenCount}}}\n`
                  ))
                  controller.enqueue(encoder.encode(
                    `d:{"finishReason":"stop","usage":{"promptTokens":${messages.length * 15},"completionTokens":${tokenCount}}}\n`
                  ))
                }
              } catch {
                // JSON inválido, ignorar
              }
            }
          }
        } catch (err) {
          console.error('[Ollama] Stream error:', err)
          controller.enqueue(encoder.encode(`0:${JSON.stringify('\n\n[Error en streaming]')}\n`))
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, { headers: streamHeaders() })
  } catch (error) {
    console.error('[Chat] Unexpected error:', error)
    return new Response(
      buildFallbackStream('❌ Error inesperado en el servidor de chat.'),
      { status: 500, headers: streamHeaders() }
    )
  }
}

function streamHeaders(): HeadersInit {
  return {
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Vercel-AI-Data-Stream': 'v1',
    'Cache-Control': 'no-cache, no-store',
    'Connection': 'keep-alive',
  }
}

function buildFallbackStream(message: string): ReadableStream {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      const id = `msg_${Date.now()}`
      controller.enqueue(encoder.encode(`f:{"messageId":"${id}"}\n`))
      const words = message.split(/(?<=\s)|(?=\s)/)
      let i = 0
      const interval = setInterval(() => {
        if (i >= words.length) {
          clearInterval(interval)
          controller.enqueue(encoder.encode(`e:{"finishReason":"stop","usage":{"promptTokens":0,"completionTokens":${words.length}}}\n`))
          controller.enqueue(encoder.encode(`d:{"finishReason":"stop","usage":{"promptTokens":0,"completionTokens":${words.length}}}\n`))
          controller.close()
          return
        }
        if (words[i]) controller.enqueue(encoder.encode(`0:${JSON.stringify(words[i])}\n`))
        i++
      }, 25)
    },
  })
}