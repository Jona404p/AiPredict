// ─── TypeScript Types ───────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp?: Date
}

export interface ChatRequest {
  message: string
  history?: ChatMessage[]
  matchContext?: MatchContext
}

export interface ChatResponse {
  response: string
  intent?: string
  prediction?: Prediction
  error?: string
}

export interface MatchContext {
  homeTeam: string
  awayTeam: string
  league?: string
  matchId?: string
}

export interface Market1X2 {
  home: number
  draw: number
  away: number
  homeOdds?: number
  drawOdds?: number
  awayOdds?: number
}

export interface MarketGoals {
  over15: number
  under15: number
  over25: number
  under25: number
  over35: number
  under35: number
  expectedGoals?: number
}

export interface MarketBTTS {
  yes: number
  no: number
}

export interface MarketCorners {
  over85: number
  under85: number
  over95: number
  under95: number
  over105: number
  under105: number
  avgCorners?: number
}

export interface MarketCards {
  over35: number
  under35: number
  over45: number
  under45: number
  over55: number
  under55: number
  avgCards?: number
}

export interface MarketExactScore {
  scores: Array<{ score: string; probability: number }>
  mostLikely: string
}

export interface DrafteaPick {
  market: string
  selection: string
  confidence: number
  edge?: number
  reason: string
}

export interface Prediction {
  homeTeam: string
  awayTeam: string
  league?: string
  date?: string
  market1x2?: Market1X2
  marketGoals?: MarketGoals
  marketBTTS?: MarketBTTS
  marketCorners?: MarketCorners
  marketCards?: MarketCards
  marketExactScore?: MarketExactScore
  drafteaPicks?: DrafteaPick[]
  confidence?: number
  dataQuality?: 'high' | 'medium' | 'low'
}

export interface LiveMatch {
  id: string
  homeTeam: string
  awayTeam: string
  homeScore: number
  awayScore: number
  minute: number
  status: 'live' | 'halftime' | 'finished' | 'upcoming'
  league: string
  startTime?: string
}

export interface UpcomingMatch {
  id: string
  homeTeam: string
  awayTeam: string
  homeTeamId?: number
  awayTeamId?: number
  homeTeamLogo?: string
  awayTeamLogo?: string
  league: string
  leagueId?: string
  date: string        // ISO string or readable date
  time: string        // e.g. "20:00"
  venue?: string
  round?: string
}

export interface StandingEntry {
  position: number
  teamId?: number
  teamName: string
  teamLogo?: string
  played: number
  won: number
  drawn: number
  lost: number
  goalsFor: number
  goalsAgainst: number
  goalDifference: number
  points: number
  form?: string[]   // ['W','L','D','W','W']
}

export interface Team {
  id: number
  name: string
  logo?: string
  shortName?: string
}

export interface StatusResponse {
  status: string
  timestamp: string
  season: string
  data_available: boolean
  model_loaded: boolean
  chatbot: {
    type: string
    url: string
    model: string
    available: boolean
    loaded: boolean
  }
  ollama?: {
    online: boolean
    model: string
  }
  python_api?: boolean
  version?: string
}

export interface LeagueGroup {
  name: string
  leagues: League[]
}

export interface League {
  id: string
  name: string
  country: string
  flag?: string
}

// ─── API Client Functions ────────────────────────────────────────────────────

const BASE = ''

export async function sendChatMessage(
  payload: ChatRequest
): Promise<ChatResponse> {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error ?? `HTTP ${res.status}`)
  }
  return res.json()
}

export async function getPrediction(
  homeTeam: string,
  awayTeam: string,
  league?: string
): Promise<Prediction> {
  const res = await fetch(`${BASE}/api/predict`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ homeTeam, awayTeam, league }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error ?? `HTTP ${res.status}`)
  }
  return res.json()
}

export async function getLiveMatches(): Promise<LiveMatch[]> {
  const res = await fetch(`${BASE}/api/live`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return data.matches ?? data ?? []
}

export async function getUpcomingMatches(leagueId: string): Promise<UpcomingMatch[]> {
  const res = await fetch(`${BASE}/api/upcoming?league=${encodeURIComponent(leagueId)}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return data.matches ?? data ?? []
}

export async function getStandings(leagueId: string): Promise<StandingEntry[]> {
  const res = await fetch(`${BASE}/api/standings?league=${encodeURIComponent(leagueId)}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return data.standings ?? data ?? []
}

export async function getTeams(leagueId: string): Promise<Team[]> {
  const res = await fetch(`${BASE}/api/teams/${encodeURIComponent(leagueId)}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return data.teams ?? data ?? []
}

export async function getStatus(): Promise<StatusResponse> {
  const res = await fetch(`${BASE}/api/status`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function getLeagues(): Promise<LeagueGroup[]> {
  const res = await fetch(`${BASE}/api/leagues`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return data.groups ?? data ?? []
}
