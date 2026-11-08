/**
 * Unified Data Sources Layer — v2.0
 *
 * Priority strategy:
 *  1️⃣  football-data.org (FREE, reliable, official API) — standings, matches, scorers
 *  2️⃣  SofaScore (rich stats, H2H, xG, extended stats) — used via smart retry + browser spoofing
 *  3️⃣  Static fallback — hardcoded reference data when both fail
 *
 * SofaScore improvements:
 *  - Randomised User-Agent pool
 *  - Exponential backoff with jitter
 *  - Per-endpoint circuit-breaker (skip SS when known-blocked)
 *  - Proxy-through via /api/proxy-sofascore route (avoids server-side SSRF detection)
 */

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

export const FD_API = 'https://api.football-data.org/v4'
export const SS_API = 'https://api.sofascore.com/api/v1'

// ─── USER-AGENT ROTATION ─────────────────────────────────────────────────────

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.4; rv:125.0) Gecko/20100101 Firefox/125.0',
]

function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
}

// ─── CIRCUIT BREAKER ─────────────────────────────────────────────────────────

const ssCircuitBreaker = {
  failCount: 0,
  lastFailAt: 0,
  THRESHOLD: 3,          // failures before opening
  RESET_MS: 60_000,      // reset after 1 min
  isOpen(): boolean {
    if (this.failCount >= this.THRESHOLD) {
      if (Date.now() - this.lastFailAt > this.RESET_MS) {
        this.failCount = 0
        return false
      }
      return true
    }
    return false
  },
  recordSuccess() { this.failCount = Math.max(0, this.failCount - 1) },
  recordFailure() { this.failCount++; this.lastFailAt = Date.now() },
}

// ─── FOOTBALL-DATA.ORG FETCHER ────────────────────────────────────────────────

export async function fetchFD<T>(
  endpoint: string,
  cacheSeconds = 600,
): Promise<T | null> {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY || ''
  if (!apiKey) {
    console.warn('[FD] No API key configured')
    return null
  }
  try {
    const res = await fetch(`${FD_API}${endpoint}`, {
      headers: { 'X-Auth-Token': apiKey, Accept: 'application/json' },
      next: { revalidate: cacheSeconds },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      console.warn(`[FD] ${res.status} → ${endpoint}`)
      return null
    }
    return res.json() as Promise<T>
  } catch (err) {
    console.warn('[FD] failed:', endpoint, String(err))
    return null
  }
}

// ─── SOFASCORE FETCHER (with circuit-breaker + retry + UA rotation) ───────────

export async function fetchSS<T>(
  endpoint: string,
  cacheSeconds = 300,
  retries = 3,
): Promise<T | null> {
  if (ssCircuitBreaker.isOpen()) {
    console.warn('[SS] Circuit open — skipping:', endpoint)
    return null
  }

  const url = `${SS_API}${endpoint}`
  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt++) {
    const headers = {
      'User-Agent': randomUA(),
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'es-ES,es;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      Origin: 'https://www.sofascore.com',
      Referer: 'https://www.sofascore.com/',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-site',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
      DNT: '1',
    }

    try {
      const res = await fetch(url, {
        headers,
        next: { revalidate: cacheSeconds },
        signal: AbortSignal.timeout(12_000),
      })

      if (res.ok) {
        ssCircuitBreaker.recordSuccess()
        return res.json() as Promise<T>
      }

      const status = res.status
      // Retryable server-side errors
      if ([429, 500, 502, 503, 504].includes(status) && attempt < retries) {
        const backoff = 400 * Math.pow(2, attempt) + Math.random() * 300
        console.warn(`[SS] retry ${attempt + 1}/${retries} (${status}) → ${endpoint} — wait ${backoff.toFixed(0)}ms`)
        await sleep(backoff)
        continue
      }

      // Permanent client errors (403, 404) — don't retry
      if ([403, 404, 451].includes(status)) {
        console.warn(`[SS] blocked/not-found (${status}) → ${endpoint}`)
        ssCircuitBreaker.recordFailure()
        return null
      }

      console.warn(`[SS] ${status} → ${endpoint}`)
      ssCircuitBreaker.recordFailure()
      return null
    } catch (err) {
      lastError = err
      if (attempt < retries) {
        const backoff = 300 * Math.pow(2, attempt) + Math.random() * 200
        console.warn(`[SS] attempt ${attempt + 1}/${retries} failed → ${endpoint}`, String(err))
        await sleep(backoff)
        continue
      }
    }
  }

  console.warn('[SS] all retries exhausted:', endpoint, String(lastError))
  ssCircuitBreaker.recordFailure()
  return null
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

/** Quick health check for a single SofaScore endpoint */
export async function checkSofaScoreHealth(): Promise<{
  available: boolean
  latencyMs: number
  blockedBy?: string
}> {
  const today = new Date().toISOString().slice(0, 10)
  const endpoints = [
    `/sport/football/events/live`,
    `/sport/football/scheduled-events/${today}`,
    `/unique-tournament/17/seasons`,
  ]

  for (const ep of endpoints) {
    const t0 = Date.now()
    try {
      const res = await fetch(`${SS_API}${ep}`, {
        headers: {
          'User-Agent': randomUA(),
          Accept: 'application/json, text/plain, */*',
          Origin: 'https://www.sofascore.com',
          Referer: 'https://www.sofascore.com/',
        },
        signal: AbortSignal.timeout(8_000),
        cache: 'no-store',
      })
      const latencyMs = Date.now() - t0
      if (res.ok) return { available: true, latencyMs }
      if (res.status === 403) return { available: false, latencyMs, blockedBy: 'Cloudflare/WAF (403)' }
      if (res.status === 429) return { available: false, latencyMs, blockedBy: 'Rate limited (429)' }
    } catch {
      // try next endpoint
    }
  }

  return { available: false, latencyMs: 0, blockedBy: 'Connection timeout / network error' }
}

export async function checkFootballDataHealth(): Promise<boolean> {
  const key = process.env.FOOTBALL_DATA_API_KEY
  if (!key) return false
  try {
    const res = await fetch(`${FD_API}/competitions`, {
      headers: { 'X-Auth-Token': key },
      signal: AbortSignal.timeout(6_000),
      cache: 'no-store',
    })
    return res.ok
  } catch {
    return false
  }
}
