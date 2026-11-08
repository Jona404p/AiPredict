import { NextRequest, NextResponse } from 'next/server'
import { TOURNAMENT_IDS, getTeamLogoUrl, getUpcomingTournamentMatches, getUpcomingFromFD, resolveCurrentSeasonId } from '@/lib/sofascore'

export const revalidate = 900 // 15 min

export async function GET(req: NextRequest) {
  const leagueKey = req.nextUrl.searchParams.get('league') ?? ''
  const tournament = TOURNAMENT_IDS[leagueKey]

  // No league key → return empty
  if (!leagueKey) {
    return NextResponse.json({ matches: [] })
  }

  // Unknown league
  if (!tournament) {
    return NextResponse.json({ error: 'Liga no encontrada' }, { status: 404 })
  }

  try {
    // 1️⃣ football-data.org PRIMARY (only for leagues with fdCode)
    if (tournament.fdCode) {
      const fdMatches = await getUpcomingFromFD(tournament.fdCode)
      if (fdMatches && fdMatches.length > 0) {
        const now = Date.now()
        const formatted = fdMatches
          .filter(m => new Date(m.utcDate).getTime() > now)
          .slice(0, 20)
          .map((m, idx) => {
            const kickoff = new Date(m.utcDate)
            return {
              id: String(m.id),
              homeTeam: m.homeTeam.name,
              awayTeam: m.awayTeam.name,
              homeTeamId: m.homeTeam.id,
              awayTeamId: m.awayTeam.id,
              homeTeamLogo: m.homeTeam.crest || getTeamLogoUrl(m.homeTeam.id),
              awayTeamLogo: m.awayTeam.crest || getTeamLogoUrl(m.awayTeam.id),
              league: tournament.name,
              leagueId: leagueKey,
              date: kickoff.toLocaleDateString('es-ES', { weekday: 'short', month: 'short', day: 'numeric' }),
              time: kickoff.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
              venue: '',
              round: m.matchday ? `Jornada ${m.matchday}` : '',
              timestamp: kickoff.getTime(),
            }
          })

        if (formatted.length > 0) {
          return NextResponse.json({ matches: formatted, source: 'football-data' })
        }
      }
    }

    // 2️⃣ SofaScore FALLBACK — try configured seasonId first, then resolve current
    let matches = await getUpcomingTournamentMatches(tournament.id, tournament.seasonId)

    if (!matches.length) {
      const currentSeasonId = await resolveCurrentSeasonId(tournament.id)
      if (currentSeasonId && currentSeasonId !== tournament.seasonId) {
        matches = await getUpcomingTournamentMatches(tournament.id, currentSeasonId)
      }
    }

    if (matches.length > 0) {
      const now = Date.now()
      const formatted = matches
        .filter(m => m.startTimestamp * 1000 > now)
        .slice(0, 20)
        .map(m => {
          const kickoff = new Date(m.startTimestamp * 1000)
          return {
            id: String(m.id),
            homeTeam: m.homeTeam.name,
            awayTeam: m.awayTeam.name,
            homeTeamId: m.homeTeam.id,
            awayTeamId: m.awayTeam.id,
            homeTeamLogo: getTeamLogoUrl(m.homeTeam.id),
            awayTeamLogo: getTeamLogoUrl(m.awayTeam.id),
            league: m.tournament?.name || tournament.name,
            leagueId: leagueKey,
            date: kickoff.toLocaleDateString('es-ES', { weekday: 'short', month: 'short', day: 'numeric' }),
            time: kickoff.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
            venue: m.venue?.stadium?.name || '',
            round: m.roundInfo?.name || (m.roundInfo?.round ? `Jornada ${m.roundInfo.round}` : ''),
            timestamp: kickoff.getTime(),
          }
        })

      if (formatted.length > 0) {
        return NextResponse.json({ matches: formatted, source: 'sofascore' })
      }
    }

    // 3️⃣ Static fallback with realistic upcoming matches
    return NextResponse.json({ matches: generateFallbackMatches(leagueKey, tournament.name), source: 'fallback', demo: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[Upcoming] error:', message)
    return NextResponse.json({ matches: generateFallbackMatches(leagueKey, tournament.name), source: 'fallback', demo: true })
  }
}

// ─── STATIC FALLBACK DATA ─────────────────────────────────────────────────────

const FALLBACK_MATCHES: Record<string, Array<{ home: string; away: string; home_id: number; away_id: number }>> = {
  spain_laliga: [
    { home: 'Real Madrid', away: 'FC Barcelona', home_id: 2829, away_id: 2817 },
    { home: 'Atlético Madrid', away: 'Sevilla FC', home_id: 2836, away_id: 2833 },
    { home: 'Athletic Club', away: 'Real Sociedad', home_id: 2848, away_id: 2869 },
    { home: 'Villarreal', away: 'Real Betis', home_id: 2815, away_id: 2816 },
    { home: 'Valencia CF', away: 'Girona FC', home_id: 2831, away_id: 2859 },
  ],
  england_premier_league: [
    { home: 'Manchester City', away: 'Arsenal', home_id: 17, away_id: 42 },
    { home: 'Liverpool', away: 'Chelsea', home_id: 44, away_id: 38 },
    { home: 'Manchester United', away: 'Tottenham Hotspur', home_id: 35, away_id: 33 },
    { home: 'Aston Villa', away: 'Newcastle United', home_id: 40, away_id: 39 },
    { home: 'Brighton', away: 'West Ham United', home_id: 3, away_id: 37 },
  ],
  germany_bundesliga: [
    { home: 'Bayern Munich', away: 'Borussia Dortmund', home_id: 2673, away_id: 2675 },
    { home: 'Bayer Leverkusen', away: 'RB Leipzig', home_id: 2672, away_id: 2681 },
    { home: 'VfB Stuttgart', away: 'Eintracht Frankfurt', home_id: 2676, away_id: 2671 },
    { home: 'SC Freiburg', away: 'VfL Wolfsburg', home_id: 2692, away_id: 2694 },
  ],
  italy_serie_a: [
    { home: 'Inter Milan', away: 'AC Milan', home_id: 2714, away_id: 2692 },
    { home: 'Juventus', away: 'Napoli', home_id: 2687, away_id: 2686 },
    { home: 'Roma', away: 'Lazio', home_id: 2670, away_id: 2685 },
    { home: 'Atalanta', away: 'Fiorentina', home_id: 2681, away_id: 2690 },
  ],
  france_ligue_1: [
    { home: 'Paris Saint-Germain', away: 'Marseille', home_id: 1644, away_id: 1641 },
    { home: 'Monaco', away: 'Lille', home_id: 1649, away_id: 1650 },
    { home: 'Lyon', away: 'Nice', home_id: 1643, away_id: 1653 },
  ],
  mexico_liga_mx: [
    { home: 'Club América', away: 'Guadalajara', home_id: 6075, away_id: 6117 },
    { home: 'Cruz Azul', away: 'Tigres UANL', home_id: 6098, away_id: 6076 },
    { home: 'Monterrey', away: 'Pumas UNAM', home_id: 6099, away_id: 6101 },
    { home: 'Toluca', away: 'León', home_id: 6108, away_id: 6111 },
  ],
  argentina_liga_profesional: [
    { home: 'River Plate', away: 'Boca Juniors', home_id: 3211, away_id: 3204 },
    { home: 'Racing Club', away: 'Independiente', home_id: 3221, away_id: 3209 },
    { home: 'San Lorenzo', away: 'Vélez Sarsfield', home_id: 3217, away_id: 3202 },
  ],
  brazil_serie_a: [
    { home: 'Flamengo', away: 'Palmeiras', home_id: 5926, away_id: 5981 },
    { home: 'Corinthians', away: 'São Paulo', home_id: 5929, away_id: 5930 },
    { home: 'Botafogo', away: 'Fluminense', home_id: 5924, away_id: 5927 },
  ],
  champions_league: [
    { home: 'Real Madrid', away: 'Manchester City', home_id: 2829, away_id: 17 },
    { home: 'Bayern Munich', away: 'Paris Saint-Germain', home_id: 2673, away_id: 1644 },
    { home: 'Barcelona', away: 'Arsenal', home_id: 2817, away_id: 42 },
    { home: 'Inter Milan', away: 'Borussia Dortmund', home_id: 2714, away_id: 2675 },
  ],
}

function generateFallbackMatches(league: string, competitionName: string) {
  const fallbackData = FALLBACK_MATCHES[league] || FALLBACK_MATCHES['spain_laliga']
  const now = Date.now()

  return fallbackData.map((match, index) => {
    const daysFromNow = Math.floor(index / 3) + 1
    const hour = [19, 21, 18][index % 3]
    const matchDate = new Date(now)
    matchDate.setDate(matchDate.getDate() + daysFromNow)
    matchDate.setHours(hour, 0, 0, 0)

    return {
      id: String(10000 + index),
      homeTeam: match.home,
      awayTeam: match.away,
      homeTeamId: match.home_id,
      awayTeamId: match.away_id,
      homeTeamLogo: getTeamLogoUrl(match.home_id),
      awayTeamLogo: getTeamLogoUrl(match.away_id),
      league: competitionName,
      leagueId: league,
      date: matchDate.toLocaleDateString('es-ES', { weekday: 'short', month: 'short', day: 'numeric' }),
      time: matchDate.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
      venue: '',
      round: `Jornada ${35 + Math.floor(index / 5)}`,
      timestamp: matchDate.getTime(),
    }
  })
}
