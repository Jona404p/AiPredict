import { NextResponse } from 'next/server'
import { checkSofaScoreHealth, checkFootballDataHealth } from '@/lib/sofascore'

export const revalidate = 30

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
const OLLAMA_MODEL    = process.env.OLLAMA_MODEL    || 'qwen2.5:3b'

async function checkOllama(): Promise<{ available: boolean; model: string; modelLoaded: boolean }> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(3000),
      cache: 'no-store',
    })
    if (!res.ok) return { available: false, model: OLLAMA_MODEL, modelLoaded: false }
    const data = await res.json()
    const models: Array<{ name: string }> = data.models || []
    const modelLoaded = models.some(m =>
      m.name === OLLAMA_MODEL || m.name.startsWith(OLLAMA_MODEL.split(':')[0])
    )
    return { available: true, model: OLLAMA_MODEL, modelLoaded }
  } catch {
    return { available: false, model: OLLAMA_MODEL, modelLoaded: false }
  }
}

export async function GET() {
  // Run all checks in parallel
  const [ollama, ssHealth, fdOk] = await Promise.all([
    checkOllama(),
    checkSofaScoreHealth(),
    checkFootballDataHealth(),
  ])

  // Overall data availability: at least one football data source must work
  const dataAvailable = fdOk || ssHealth.available

  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    season: '2025/26',
    data_available: dataAvailable,

    // Chatbot
    model_loaded: ollama.available && ollama.modelLoaded,
    chatbot: {
      type: 'ollama',
      url: OLLAMA_BASE_URL,
      model: OLLAMA_MODEL,
      available: ollama.available,
      model_loaded: ollama.modelLoaded,
    },

    // Data sources — FD is now primary
    football_data: {
      available: fdOk,
      configured: !!process.env.FOOTBALL_DATA_API_KEY,
      label: 'football-data.org (primario — oficial, gratuito)',
      priority: 1,
    },
    sofascore: {
      available: ssHealth.available,
      latencyMs: ssHealth.latencyMs,
      label: 'SofaScore (estadísticas extendidas, H2H, en vivo)',
      priority: 2,
      blockedBy: ssHealth.blockedBy ?? null,
    },
  })
}
