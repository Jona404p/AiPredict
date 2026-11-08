/**
 * SofaScore + Football-Data.org — Unified Sports Data Layer v3.0
 *
 * Data priority per operation:
 *  Standings   → football-data.org → SofaScore → static fallback
 *  Upcoming    → football-data.org → SofaScore → static fallback
 *  Live        → SofaScore (best real-time) → football-data.org → []
 *  Extended    → SofaScore (H2H, xG, form) → estimated
 *  Top Scorers → football-data.org → SofaScore
 *
 * SofaScore fixes v3:
 *  - UA rotation (6 agents), realistic browser headers
 *  - Exponential backoff with jitter (3 retries)
 *  - In-memory circuit breaker (opens after 3 fails, resets after 60s)
 *  - Null-safe: returns null instead of {} on failure
 */

import { fetchFD, fetchSS } from './data-sources'

export { checkSofaScoreHealth, checkFootballDataHealth } from './data-sources'

const SS_API = 'https://api.sofascore.com/api/v1'

// ─── INTERFACES ──────────────────────────────────────────────────────────────

export interface SofaScoreMatch {
  id: number
  slug: string
  season?: { year: number }
  roundInfo?: { round: number; name?: string }
  status: { type: string; description: string; code?: number }
  customId?: string
  winnerCode?: number
  startTimestamp: number
  lastUpdated?: number
  homeTeam: { id: number; name: string; slug: string; shortName?: string; national?: boolean }
  awayTeam: { id: number; name: string; slug: string; shortName?: string; national?: boolean }
  homeScore?: { current: number; display: number; period1?: number; period2?: number; normaltime?: number }
  awayScore?: { current: number; display: number; period1?: number; period2?: number; normaltime?: number }
  tournament?: {
    id: number; name: string; slug: string
    uniqueTournament?: { id: number; name: string; slug: string; category?: { id: number; name: string; slug: string; flag?: string } }
    category?: { id: number; name: string; slug: string; flag?: string }
  }
  venue?: { id: number; city?: { name: string }; stadium?: { name: string; capacity?: number } }
  time?: { injuryTime1?: number; injuryTime2?: number; currentPeriodStartTimestamp?: number }
}

export interface SofaScoreTeam {
  id: number; name: string; slug: string; shortName: string
  sport?: { id: number; name: string; slug: string }
  category?: { id: number; name: string; slug: string; flag?: string }
  tournament?: { id: number; name: string; slug: string; uniqueTournament?: { id: number; name: string } }
}

export interface SofaScoreStanding {
  id: number; position: number
  team: { id: number; name: string; slug: string; shortName?: string }
  matches: number; wins: number; draws: number; losses: number
  scoresFor: number; scoresAgainst: number; points: number
  promotion?: { text: string; id: number }
}

export interface MatchStatistics {
  groups: Array<{
    groupName: string
    statisticsItems: Array<{
      name: string; home: string; away: string; compareCode: number
      statisticsType: string; valueType: string
      homeValue: number; awayValue: number; homeTotal?: number; awayTotal?: number
    }>
  }>
}

export interface TeamExtendedStats {
  avgGoalsScored: number
  avgGoalsConceded: number
  avgGoalsScoredHome: number
  avgGoalsScoredAway: number
  avgGoalsConcededHome: number
  avgGoalsConcededAway: number
  recentForm: string[]
  recentAvgGoalsScored: number
  recentAvgGoalsConceded: number
  winPct: number
  drawPct: number
  lossPct: number
  cleanSheetPct: number
  bttsRate: number
  over15Rate: number
  over25Rate: number
  over35Rate: number
  firstToScoreRate: number
  avgCornersFor: number
  avgCornersAgainst: number
  avgTotalCorners: number
  avgYellowCards: number
  avgRedCards: number
  avgShotsOnTarget: number
  avgShotsTotal: number
  avgShotsConceded: number
  avgXgFor: number
  avgXgAgainst: number
  avgPossession: number
  dataSource: 'sofascore' | 'football-data' | 'estimated'
}

export interface H2HStats {
  totalMatches: number
  homeTeamWins: number
  awayTeamWins: number
  draws: number
  homeTeamGoals: number
  awayTeamGoals: number
  avgGoalsPerMatch: number
  bttsRate: number
  over25Rate: number
  recentMatches: Array<{
    date: string
    homeTeam: string
    awayTeam: string
    homeScore: number
    awayScore: number
    winner: 'home' | 'away' | 'draw'
  }>
  dataSource: 'sofascore' | 'football-data' | 'estimated'
}

export interface TopScorer {
  id: number
  name: string
  goals: number
  assists: number
  team: string
  teamId: number
  logo?: string
  nationality?: string
  position?: string
  goalsThisSeason: number
  minutesPerGoal?: number
  scoringRate?: number
  dataSource?: 'sofascore' | 'football-data'
}

export interface EnrichedPredictionData {
  homeExtStats?: TeamExtendedStats
  awayExtStats?: TeamExtendedStats
  h2h?: H2HStats
  topScorers?: TopScorer[]
  venueInfo?: { name: string; city: string; capacity?: number }
  dataSources: string[]
}

// ─── TOURNAMENT CONFIG ────────────────────────────────────────────────────────

export const TOURNAMENT_IDS: Record<string, {
  id: number; seasonId: number; name: string; country: string; tier: number; fdCode?: string
}> = {
  champions_league:           { id: 7,     seasonId: 63814, name: 'Champions League',  country: 'Europe',      tier: 0, fdCode: 'CL'  },
  europa_league:              { id: 679,   seasonId: 63515, name: 'Europa League',      country: 'Europe',      tier: 0, fdCode: 'EL'  },
  conference_league:          { id: 17015, seasonId: 63516, name: 'Conference League',  country: 'Europe',      tier: 0               },
  spain_laliga:               { id: 8,     seasonId: 66006, name: 'La Liga',            country: 'Spain',       tier: 1, fdCode: 'PD'  },
  england_premier_league:     { id: 17,    seasonId: 66091, name: 'Premier League',     country: 'England',     tier: 1, fdCode: 'PL'  },
  germany_bundesliga:         { id: 35,    seasonId: 63517, name: 'Bundesliga',         country: 'Germany',     tier: 1, fdCode: 'BL1' },
  italy_serie_a:              { id: 23,    seasonId: 66483, name: 'Serie A',            country: 'Italy',       tier: 1, fdCode: 'SA'  },
  france_ligue_1:             { id: 34,    seasonId: 66179, name: 'Ligue 1',            country: 'France',      tier: 1, fdCode: 'FL1' },
  portugal_liga_portugal:     { id: 238,   seasonId: 66484, name: 'Liga Portugal',      country: 'Portugal',    tier: 2, fdCode: 'PPL' },
  netherlands_eredivisie:     { id: 37,    seasonId: 63518, name: 'Eredivisie',         country: 'Netherlands', tier: 2, fdCode: 'DED' },
  belgium_jupiler:            { id: 38,    seasonId: 63519, name: 'Jupiler Pro League', country: 'Belgium',     tier: 2               },
  turkey_super_lig:           { id: 52,    seasonId: 65801, name: 'Süper Lig',          country: 'Turkey',      tier: 2               },
  mexico_liga_mx:             { id: 11621, seasonId: 63520, name: 'Liga MX',            country: 'Mexico',      tier: 3               },
  argentina_liga_profesional: { id: 155,   seasonId: 63521, name: 'Liga Profesional',   country: 'Argentina',   tier: 3               },
  brazil_serie_a:             { id: 325,   seasonId: 63522, name: 'Brasileirao',        country: 'Brazil',      tier: 3, fdCode: 'BSA' },
  usa_mls:                    { id: 242,   seasonId: 63523, name: 'MLS',                country: 'USA',         tier: 3               },
  colombia_liga_betplay:      { id: 11536, seasonId: 63524, name: 'Liga BetPlay',       country: 'Colombia',    tier: 3               },
}

// ─── SEASON RESOLVER ─────────────────────────────────────────────────────────

// In-memory cache for resolved season IDs (server lifetime)
const seasonCache = new Map<number, { seasonId: number; resolvedAt: number }>()
const SEASON_CACHE_TTL = 6 * 3600 * 1000 // 6 hours

export async function resolveCurrentSeasonId(tournamentId: number): Promise<number | null> {
  const cached = seasonCache.get(tournamentId)
  if (cached && Date.now() - cached.resolvedAt < SEASON_CACHE_TTL) {
    return cached.seasonId
  }
  const data = await fetchSS<{ seasons: Array<{ id: number; year: string }> }>(
    `/unique-tournament/${tournamentId}/seasons`, 86400
  )
  if (!data?.seasons?.length) return null
  const seasonId = [...data.seasons].sort((a, b) => b.id - a.id)[0].id
  seasonCache.set(tournamentId, { seasonId, resolvedAt: Date.now() })
  return seasonId
}

// ─── STANDINGS ────────────────────────────────────────────────────────────────

export async function getStandingsFromFD(fdCode: string) {
  type FDStandings = {
    standings: Array<{ type: string; table: FDStandingRow[] }>
  }
  const data = await fetchFD<FDStandings>(`/competitions/${fdCode}/standings`, 1800)
  return data?.standings?.find((s) => s.type === 'TOTAL')?.table ?? null
}

interface FDStandingRow {
  position: number
  team: { id: number; name: string; shortName: string; crest: string }
  playedGames: number
  won: number
  draw: number
  lost: number
  goalsFor: number
  goalsAgainst: number
  goalDifference: number
  points: number
  form?: string
}

export async function getTournamentStandings(tournamentId: number, seasonId: number): Promise<SofaScoreStanding[]> {
  const fetch1 = await fetchSS<{ standings: Array<{ rows: SofaScoreStanding[] }> }>(
    `/unique-tournament/${tournamentId}/season/${seasonId}/standings/total`, 1800
  )
  const standings1 = fetch1?.standings?.find((group) => Array.isArray(group?.rows) && group.rows.length > 0)?.rows
  if (standings1?.length) return standings1

  const currentSeasonId = await resolveCurrentSeasonId(tournamentId)
  if (currentSeasonId && currentSeasonId !== seasonId) {
    const fetch2 = await fetchSS<{ standings: Array<{ rows: SofaScoreStanding[] }> }>(
      `/unique-tournament/${tournamentId}/season/${currentSeasonId}/standings/total`, 1800
    )
    const standings2 = fetch2?.standings?.find((group) => Array.isArray(group?.rows) && group.rows.length > 0)?.rows
    if (standings2?.length) return standings2
  }
  return []
}

// ─── MATCHES ──────────────────────────────────────────────────────────────────

type FDLiveMatch = {
  id: number; utcDate: string; status: string
  homeTeam: { id: number; name: string }
  awayTeam: { id: number; name: string }
  score: { fullTime: { home: number|null; away: number|null }; halfTime: { home: number|null; away: number|null } }
}

export async function getLiveMatches(): Promise<SofaScoreMatch[]> {
  const data = await fetchSS<{ events: SofaScoreMatch[] }>('/sport/football/events/live', 20)
  if (data?.events?.length) return data.events

  const fdData = await fetchFD<{ matches: FDLiveMatch[] }>('/matches?status=LIVE', 20)
  if (!fdData?.matches?.length) return []

  return fdData.matches.map(m => ({
    id: m.id,
    slug: String(m.id),
    startTimestamp: Math.floor(new Date(m.utcDate).getTime() / 1000),
    status: { type: 'inprogress', description: m.status, code: 6 },
    homeTeam: { id: m.homeTeam.id, name: m.homeTeam.name, slug: m.homeTeam.name.toLowerCase() },
    awayTeam: { id: m.awayTeam.id, name: m.awayTeam.name, slug: m.awayTeam.name.toLowerCase() },
    homeScore: { current: m.score.fullTime.home ?? 0, display: m.score.fullTime.home ?? 0 },
    awayScore: { current: m.score.fullTime.away ?? 0, display: m.score.fullTime.away ?? 0 },
  }))
}

export async function getUpcomingTournamentMatches(tournamentId: number, seasonId: number): Promise<SofaScoreMatch[]> {
  const ssData = await fetchSS<{ events: SofaScoreMatch[] }>(
    `/unique-tournament/${tournamentId}/season/${seasonId}/events/next/0`, 600
  )
  if (ssData?.events?.length) return ssData.events

  const currentSeasonId = await resolveCurrentSeasonId(tournamentId)
  if (currentSeasonId && currentSeasonId !== seasonId) {
    const ssData2 = await fetchSS<{ events: SofaScoreMatch[] }>(
      `/unique-tournament/${tournamentId}/season/${currentSeasonId}/events/next/0`, 600
    )
    if (ssData2?.events?.length) return ssData2.events
  }
  return []
}

type FDScheduledMatch = {
  id: number; utcDate: string; status: string; matchday: number
  homeTeam: { id: number; name: string; shortName: string; crest: string }
  awayTeam: { id: number; name: string; shortName: string; crest: string }
  score: { fullTime: { home: number|null; away: number|null }; halfTime: { home: number|null; away: number|null } }
}

export async function getUpcomingFromFD(fdCode: string): Promise<FDScheduledMatch[] | null> {
  const data = await fetchFD<{ matches: FDScheduledMatch[] }>(
    `/competitions/${fdCode}/matches?status=SCHEDULED`, 900
  )
  return data?.matches?.slice(0, 20) ?? null
}

export async function getTeamLastMatches(teamId: number, limit = 10): Promise<SofaScoreMatch[]> {
  const data = await fetchSS<{ events: SofaScoreMatch[] }>(`/team/${teamId}/events/last/0`, 600)
  return (data?.events ?? []).slice(0, limit)
}

export async function getTeamNextMatches(teamId: number, limit = 5): Promise<SofaScoreMatch[]> {
  const data = await fetchSS<{ events: SofaScoreMatch[] }>(`/team/${teamId}/events/next/0`, 600)
  return (data?.events ?? []).slice(0, limit)
}

export async function getTournamentMatches(tournamentId: number, seasonId: number): Promise<SofaScoreMatch[]> {
  const data = await fetchSS<{ events: SofaScoreMatch[] }>(
    `/unique-tournament/${tournamentId}/season/${seasonId}/events/last/0`, 600
  )
  if (data?.events?.length) return data.events

  const currentSeasonId = await resolveCurrentSeasonId(tournamentId)
  if (currentSeasonId && currentSeasonId !== seasonId) {
    const fallback = await fetchSS<{ events: SofaScoreMatch[] }>(
      `/unique-tournament/${tournamentId}/season/${currentSeasonId}/events/last/0`, 600
    )
    if (fallback?.events?.length) return fallback.events
  }

  return []
}

export async function getMatchDetails(matchId: number): Promise<SofaScoreMatch | null> {
  const data = await fetchSS<{ event: SofaScoreMatch }>(`/event/${matchId}`)
  return data?.event ?? null
}

export async function getMatchStatistics(matchId: number): Promise<MatchStatistics | null> {
  const data = await fetchSS<{ statistics: MatchStatistics['groups'] }>(`/event/${matchId}/statistics`)
  return { groups: data?.statistics ?? [] }
}

export async function getMatchesByDate(date: string): Promise<SofaScoreMatch[]> {
  const data = await fetchSS<{ events: SofaScoreMatch[] }>(`/sport/football/scheduled-events/${date}`, 300)
  return data?.events ?? []
}

export async function getUpcomingMatches(days: number = 7): Promise<SofaScoreMatch[]> {
  const today = new Date()
  const dates = Array.from({ length: days }, (_, i) => {
    const next = new Date(today)
    next.setDate(next.getDate() + i)
    return next.toISOString().slice(0, 10)
  })

  const results = await Promise.allSettled(dates.map(date => getMatchesByDate(date)))
  const matches = results.flatMap(result => result.status === 'fulfilled' ? result.value : [])
  const unique = new Map<number, SofaScoreMatch>()

  for (const match of matches) {
    if (!match || typeof match.id !== 'number') continue
    unique.set(match.id, match)
  }

  return [...unique.values()].sort((a, b) => (a.startTimestamp || 0) - (b.startTimestamp || 0))
}

// ─── TEAMS ────────────────────────────────────────────────────────────────────

export async function getTournamentTeams(tournamentId: number, seasonId: number): Promise<SofaScoreTeam[]> {
  const standings = await getTournamentStandings(tournamentId, seasonId)
  return standings.map(s => ({
    id: s.team.id,
    name: s.team.name,
    slug: s.team.slug,
    shortName: s.team.shortName || s.team.name,
  }))
}

export async function getTeamDetails(teamId: number): Promise<SofaScoreTeam | null> {
  const data = await fetchSS<{ team: SofaScoreTeam }>(`/team/${teamId}`)
  return data?.team ?? null
}

// ─── TOP SCORERS ──────────────────────────────────────────────────────────────

export async function getTopScorersFromFD(fdCode: string): Promise<TopScorer[] | null> {
  type FDScorers = { scorers: Array<{
    player: { id: number; name: string; nationality: string; position?: string }
    team: { id: number; name: string; crest: string }
    goals: number; assists?: number; playedMatches: number
  }> }
  const data = await fetchFD<FDScorers>(`/competitions/${fdCode}/scorers?limit=20`, 3600)
  if (!data?.scorers?.length) return null
  return data.scorers.map(s => ({
    id: s.player.id,
    name: s.player.name,
    goals: s.goals,
    assists: s.assists ?? 0,
    team: s.team.name,
    teamId: s.team.id,
    logo: s.team.crest,
    nationality: s.player.nationality,
    position: s.player.position,
    goalsThisSeason: s.goals,
    scoringRate: parseFloat((s.goals / Math.max(s.playedMatches, 1)).toFixed(2)),
    dataSource: 'football-data' as const,
  }))
}

export async function getTournamentTopScorers(tournamentId: number, seasonId: number, limit = 20): Promise<TopScorer[]> {
  type SSTop = { results: Array<{
    player: { id: number; name: string; position?: string; country?: { name: string } }
    team: { id: number; name: string }
    statistics: { goals?: number; assists?: number; minutesPlayed?: number; appearances?: number }
  }> }

  const fetchTopScorers = async (season: number | null) => {
    if (!season) return null
    return await fetchSS<SSTop>(
      `/unique-tournament/${tournamentId}/season/${season}/top-players/overall`, 3600
    )
  }

  const data = await fetchTopScorers(seasonId)
  if (data?.results?.length) return data.results.slice(0, limit).map(formatScorer)

  const currentSeasonId = await resolveCurrentSeasonId(tournamentId)
  if (currentSeasonId && currentSeasonId !== seasonId) {
    const fallback = await fetchTopScorers(currentSeasonId)
    if (fallback?.results?.length) return fallback.results.slice(0, limit).map(formatScorer)
  }

  return []
}

function formatScorer(r: {
  player: { id: number; name: string; position?: string; country?: { name: string } }
  team: { id: number; name: string }
  statistics: { goals?: number; assists?: number; minutesPlayed?: number; appearances?: number }
}): TopScorer {
  const goals = r.statistics.goals ?? 0
  const apps = r.statistics.appearances ?? 1
  const minutes = r.statistics.minutesPlayed ?? apps * 80
  return {
    id: r.player.id,
    name: r.player.name,
    goals,
    assists: r.statistics.assists ?? 0,
    team: r.team.name,
    teamId: r.team.id,
    logo: `${SS_API}/player/${r.player.id}/image`,
    nationality: r.player.country?.name,
    position: r.player.position,
    goalsThisSeason: goals,
    minutesPerGoal: goals > 0 ? Math.round(minutes / goals) : undefined,
    scoringRate: parseFloat((goals / apps).toFixed(2)),
    dataSource: 'sofascore' as const,
  }
}

// ─── EXTENDED TEAM STATS ──────────────────────────────────────────────────────

export async function getTeamExtendedStats(teamId: number, recentMatchesCount = 10): Promise<TeamExtendedStats | null> {
  try {
    const matchesData = await fetchSS<{ events: SofaScoreMatch[] }>(`/team/${teamId}/events/last/0`, 600)
    const matches = (matchesData?.events ?? []).slice(0, recentMatchesCount)
    if (!matches.length) return null

    const matchStatsPromises = matches.slice(0, 8).map(async (m) => {
      const stats = await fetchSS<{ statistics: unknown[] }>(`/event/${m.id}/statistics`, 3600)
      return { match: m, stats: stats?.statistics ?? [] }
    })
    const matchStats = await Promise.all(matchStatsPromises)

    let goalsScored = 0, goalsConceded = 0
    let goalsScoredHome = 0, goalsConcededHome = 0, goalsScoredAway = 0, goalsConcededAway = 0
    let homeMatches = 0, awayMatches = 0, wins = 0, draws = 0, losses = 0
    let cleanSheets = 0, bttsCount = 0, over15Count = 0, over25Count = 0, over35Count = 0
    let cornersFor = 0, cornersAgainst = 0, cornerMatches = 0
    let yellowCards = 0, redCards = 0, cardMatches = 0
    let shotsOnTarget = 0, shotsTotal = 0, shotsConceded = 0, shotMatches = 0
    let possession = 0, possessionMatches = 0
    const form: string[] = []

    for (const { match, stats } of matchStats) {
      const isHome = match.homeTeam.id === teamId
      const teamScore = isHome ? (match.homeScore?.current ?? 0) : (match.awayScore?.current ?? 0)
      const oppScore  = isHome ? (match.awayScore?.current ?? 0) : (match.homeScore?.current ?? 0)
      const total = teamScore + oppScore

      goalsScored += teamScore; goalsConceded += oppScore
      if (isHome) { goalsScoredHome += teamScore; goalsConcededHome += oppScore; homeMatches++ }
      else         { goalsScoredAway += teamScore; goalsConcededAway += oppScore; awayMatches++ }

      if (teamScore > oppScore) { wins++;  form.push('W') }
      else if (teamScore === oppScore) { draws++; form.push('D') }
      else { losses++; form.push('L') }

      if (oppScore === 0) cleanSheets++
      if (teamScore > 0 && oppScore > 0) bttsCount++
      if (total > 1) over15Count++
      if (total > 2) over25Count++
      if (total > 3) over35Count++

      if (Array.isArray(stats) && stats.length > 0) {
        let hasCorners = false, hasCards = false, hasShots = false, hasPossession = false
        for (const group of stats as Array<{ statisticsItems?: unknown[] }>) {
          for (const item of (group.statisticsItems ?? []) as Array<Record<string, unknown>>) {
            const name = String(item.name ?? '').toLowerCase()
            const myVal  = isHome ? (Number(item.homeValue) || 0) : (Number(item.awayValue) || 0)
            const oppVal = isHome ? (Number(item.awayValue) || 0) : (Number(item.homeValue) || 0)
            if (name.includes('corner')) { cornersFor += myVal; cornersAgainst += oppVal; hasCorners = true }
            if (name.includes('yellow card') && !name.includes('red')) { yellowCards += myVal; hasCards = true }
            if (name.includes('red card')) redCards += myVal
            if (name.includes('shots on target') || name === 'on target') {
              shotsOnTarget += myVal; shotsConceded += oppVal; hasShots = true
            }
            if (name.includes('total shots') || name === 'shots') shotsTotal += myVal
            if (name.includes('possession')) {
              const pct = parseFloat(String(isHome ? item.home : item.away).replace('%', '')) || 0
              if (pct > 0) { possession += pct; hasPossession = true }
            }
          }
        }
        if (hasCorners) cornerMatches++
        if (hasCards) cardMatches++
        if (hasShots) shotMatches++
        if (hasPossession) possessionMatches++
      }
    }

    const n = matches.length
    const safeDiv = (a: number, b: number) => b > 0 ? parseFloat((a / b).toFixed(2)) : 0

    return {
      avgGoalsScored: safeDiv(goalsScored, n),
      avgGoalsConceded: safeDiv(goalsConceded, n),
      avgGoalsScoredHome: safeDiv(goalsScoredHome, homeMatches),
      avgGoalsScoredAway: safeDiv(goalsScoredAway, awayMatches),
      avgGoalsConcededHome: safeDiv(goalsConcededHome, homeMatches),
      avgGoalsConcededAway: safeDiv(goalsConcededAway, awayMatches),
      recentForm: form.slice(0, 5),
      recentAvgGoalsScored: safeDiv(goalsScored, n),
      recentAvgGoalsConceded: safeDiv(goalsConceded, n),
      winPct: parseFloat(((wins / n) * 100).toFixed(1)),
      drawPct: parseFloat(((draws / n) * 100).toFixed(1)),
      lossPct: parseFloat(((losses / n) * 100).toFixed(1)),
      cleanSheetPct: parseFloat(((cleanSheets / n) * 100).toFixed(1)),
      bttsRate: parseFloat(((bttsCount / n) * 100).toFixed(1)),
      over15Rate: parseFloat(((over15Count / n) * 100).toFixed(1)),
      over25Rate: parseFloat(((over25Count / n) * 100).toFixed(1)),
      over35Rate: parseFloat(((over35Count / n) * 100).toFixed(1)),
      firstToScoreRate: 0,
      avgCornersFor: cornerMatches > 0 ? safeDiv(cornersFor, cornerMatches) : 4.8,
      avgCornersAgainst: cornerMatches > 0 ? safeDiv(cornersAgainst, cornerMatches) : 4.7,
      avgTotalCorners: cornerMatches > 0 ? safeDiv(cornersFor + cornersAgainst, cornerMatches) : 9.5,
      avgYellowCards: cardMatches > 0 ? safeDiv(yellowCards, cardMatches) : 1.8,
      avgRedCards: cardMatches > 0 ? safeDiv(redCards, cardMatches) : 0.1,
      avgShotsOnTarget: shotMatches > 0 ? safeDiv(shotsOnTarget, shotMatches) : 4.5,
      avgShotsTotal: shotMatches > 0 ? safeDiv(shotsTotal, shotMatches) : 12.0,
      avgShotsConceded: shotMatches > 0 ? safeDiv(shotsConceded, shotMatches) : 4.5,
      avgXgFor: shotMatches > 0 ? parseFloat((safeDiv(shotsOnTarget, shotMatches) * 0.30).toFixed(2)) : 1.35,
      avgXgAgainst: shotMatches > 0 ? parseFloat((safeDiv(shotsConceded, shotMatches) * 0.28).toFixed(2)) : 1.26,
      avgPossession: possessionMatches > 0 ? parseFloat((possession / possessionMatches).toFixed(1)) : 50,
      dataSource: 'sofascore',
    }
  } catch (e) {
    console.warn('[getTeamExtendedStats] Error:', e)
    return null
  }
}

// ─── H2H ─────────────────────────────────────────────────────────────────────

export async function getHeadToHead(homeTeamId: number, awayTeamId: number): Promise<H2HStats | null> {
  try {
    const data = await fetchSS<{ previousEvents: SofaScoreMatch[] }>(
      `/team/${homeTeamId}/versus/${awayTeamId}/h2h`, 3600
    )
    const events: SofaScoreMatch[] = data?.previousEvents ?? []
    if (!events.length) return null

    const recentEvents = events.slice(0, 10)
    let homeWins = 0, awayWins = 0, drawsCount = 0
    let homeGoals = 0, awayGoals = 0, btts = 0, over25 = 0
    const recentMatches: H2HStats['recentMatches'] = []

    for (const ev of recentEvents) {
      const hScore = ev.homeScore?.current ?? 0
      const aScore = ev.awayScore?.current ?? 0
      const isHomeNormal = ev.homeTeam.id === homeTeamId
      const normHome = isHomeNormal ? hScore : aScore
      const normAway = isHomeNormal ? aScore : hScore

      homeGoals += normHome; awayGoals += normAway
      if (normHome > normAway) homeWins++
      else if (normHome < normAway) awayWins++
      else drawsCount++
      if (normHome > 0 && normAway > 0) btts++
      if (normHome + normAway > 2) over25++

      recentMatches.push({
        date: new Date(ev.startTimestamp * 1000).toISOString().split('T')[0],
        homeTeam: isHomeNormal ? ev.homeTeam.name : ev.awayTeam.name,
        awayTeam: isHomeNormal ? ev.awayTeam.name : ev.homeTeam.name,
        homeScore: normHome,
        awayScore: normAway,
        winner: normHome > normAway ? 'home' : normHome < normAway ? 'away' : 'draw',
      })
    }

    const n = recentEvents.length
    return {
      totalMatches: n,
      homeTeamWins: homeWins,
      awayTeamWins: awayWins,
      draws: drawsCount,
      homeTeamGoals: homeGoals,
      awayTeamGoals: awayGoals,
      avgGoalsPerMatch: parseFloat(((homeGoals + awayGoals) / n).toFixed(2)),
      bttsRate: parseFloat(((btts / n) * 100).toFixed(1)),
      over25Rate: parseFloat(((over25 / n) * 100).toFixed(1)),
      recentMatches: recentMatches.slice(0, 5),
      dataSource: 'sofascore',
    }
  } catch (e) {
    console.warn('[getHeadToHead] Error:', e)
    return null
  }
}

// ─── ENRICHED PREDICTION DATA ─────────────────────────────────────────────────

export async function getEnrichedPredictionData(
  homeTeamId: number,
  awayTeamId: number,
  tournamentId: number,
  seasonId: number,
  fdCode?: string,
): Promise<EnrichedPredictionData> {
  const dataSources: string[] = []

  const [homeExtStats, awayExtStats, h2h, ssScorers, fdScorers] = await Promise.allSettled([
    getTeamExtendedStats(homeTeamId, 10),
    getTeamExtendedStats(awayTeamId, 10),
    getHeadToHead(homeTeamId, awayTeamId),
    getTournamentTopScorers(tournamentId, seasonId, 20),
    fdCode ? getTopScorersFromFD(fdCode) : Promise.resolve(null),
  ])

  let topScorers: TopScorer[] | undefined
  if (fdScorers.status === 'fulfilled' && fdScorers.value?.length) {
    topScorers = fdScorers.value; dataSources.push('football-data (scorers)')
  } else if (ssScorers.status === 'fulfilled' && ssScorers.value?.length) {
    topScorers = ssScorers.value; dataSources.push('sofascore (scorers)')
  }

  const homeExt = homeExtStats.status === 'fulfilled' ? homeExtStats.value ?? undefined : undefined
  const awayExt = awayExtStats.status === 'fulfilled' ? awayExtStats.value ?? undefined : undefined
  if (homeExt || awayExt) dataSources.push('sofascore (team-stats)')

  const h2hVal = h2h.status === 'fulfilled' ? h2h.value ?? undefined : undefined
  if (h2hVal) dataSources.push('sofascore (h2h)')

  return { homeExtStats: homeExt, awayExtStats: awayExt, h2h: h2hVal, topScorers, dataSources }
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

export function getTeamLogoUrl(teamId: number): string {
  return `https://api.sofascore.com/api/v1/team/${teamId}/image`
}

export function mapMatchStatus(statusType: string, statusCode?: number): string {
  if (statusCode !== undefined) {
    if (statusCode === 31) return 'halftime'
    if (statusCode >= 100) return 'finished'
    if (statusCode === 0) return 'not_started'
  }
  const map: Record<string, string> = {
    notstarted: 'not_started', inprogress: 'live', finished: 'finished',
    postponed: 'postponed', cancelled: 'cancelled', interrupted: 'interrupted',
    suspended: 'suspended', awarded: 'awarded',
  }
  return map[statusType?.toLowerCase()] || statusType
}

export function getMinutesFromTimestamp(match: SofaScoreMatch): number | null {
  if (match.status.type !== 'inprogress') return null
  const now = Math.floor(Date.now() / 1000)
  const startTime = match.time?.currentPeriodStartTimestamp ?? match.startTimestamp
  const elapsed = Math.floor((now - startTime) / 60)
  if (match.status.code === 6) return Math.min(elapsed, 45)
  if (match.status.code === 7) return 45 + Math.min(elapsed, 45)
  return elapsed
}

// Backward-compat aliases
export const getStandingsFromFootballData = getStandingsFromFD
export const getUpcomingMatchesFromFootballData = getUpcomingFromFD
export const getTopScorersFromFootballData = getTopScorersFromFD
