import { NextRequest, NextResponse } from 'next/server'
import { getUpcomingTournamentMatches, getUpcomingFromFD, TOURNAMENT_IDS, getTeamLogoUrl } from '@/lib/sofascore'

export const revalidate = 900 // Revalidate every 15 minutes

interface FormattedMatch {
  id: number
  home_team: string
  away_team: string
  home_team_id: number
  away_team_id: number
  home_team_logo: string
  away_team_logo: string
  date: string
  start_timestamp: number
  competition: string
  round_label: string
  league_key: string
}

// Fallback de partidos simulados por liga
const FALLBACK_MATCHES: Record<string, Array<{ home: string; away: string; home_id: number; away_id: number }>> = {
  spain_laliga: [
    { home: 'Real Madrid', away: 'FC Barcelona', home_id: 2829, away_id: 2817 },
    { home: 'Atlético Madrid', away: 'Sevilla FC', home_id: 2836, away_id: 2833 },
    { home: 'Athletic Club', away: 'Real Sociedad', home_id: 2848, away_id: 2869 },
    { home: 'Villarreal', away: 'Real Betis', home_id: 2815, away_id: 2816 },
    { home: 'Valencia CF', away: 'Girona FC', home_id: 2831, away_id: 2859 },
    { home: 'Getafe CF', away: 'CA Osasuna', home_id: 2820, away_id: 2821 },
  ],
  england_premier_league: [
    { home: 'Manchester City', away: 'Arsenal', home_id: 17, away_id: 42 },
    { home: 'Liverpool', away: 'Chelsea', home_id: 44, away_id: 38 },
    { home: 'Manchester United', away: 'Tottenham Hotspur', home_id: 35, away_id: 33 },
    { home: 'Aston Villa', away: 'Newcastle United', home_id: 40, away_id: 39 },
    { home: 'Brighton', away: 'West Ham United', home_id: 3, away_id: 37 },
    { home: 'Fulham', away: 'Crystal Palace', home_id: 36, away_id: 31 },
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
    { home: 'Rennes', away: 'Lens', home_id: 1661, away_id: 1659 },
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
    { home: 'Estudiantes', away: 'Talleres', home_id: 3220, away_id: 3203 },
  ],
  brazil_serie_a: [
    { home: 'Flamengo', away: 'Palmeiras', home_id: 5926, away_id: 5981 },
    { home: 'Corinthians', away: 'São Paulo', home_id: 5929, away_id: 5930 },
    { home: 'Botafogo', away: 'Fluminense', home_id: 5924, away_id: 5927 },
    { home: 'Grêmio', away: 'Internacional', home_id: 5975, away_id: 5974 },
  ],
  champions_league: [
    { home: 'Real Madrid', away: 'Manchester City', home_id: 2829, away_id: 17 },
    { home: 'Bayern Munich', away: 'Paris Saint-Germain', home_id: 2673, away_id: 1644 },
    { home: 'Barcelona', away: 'Arsenal', home_id: 2817, away_id: 42 },
    { home: 'Inter Milan', away: 'Borussia Dortmund', home_id: 2714, away_id: 2675 },
  ],
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ league: string }> }
) {
  const { league } = await params
  
  try {
    const tournamentConfig = TOURNAMENT_IDS[league]
    
    if (!tournamentConfig) {
      return NextResponse.json({ error: 'Liga no encontrada' }, { status: 404 })
    }

    // 1️⃣ football-data.org PRIMARY
    if (tournamentConfig.fdCode) {
      const fdMatches = await getUpcomingFromFD(tournamentConfig.fdCode)
      if (fdMatches && fdMatches.length > 0) {
        const formatted: FormattedMatch[] = fdMatches
          .filter(m => new Date(m.utcDate).getTime() > Date.now())
          .slice(0, 20)
          .map((m, index) => ({
            id: m.id,
            home_team: m.homeTeam.name,
            away_team: m.awayTeam.name,
            home_team_id: m.homeTeam.id,
            away_team_id: m.awayTeam.id,
            home_team_logo: m.homeTeam.crest || getTeamLogoUrl(m.homeTeam.id),
            away_team_logo: m.awayTeam.crest || getTeamLogoUrl(m.awayTeam.id),
            date: m.utcDate,
            start_timestamp: Math.floor(new Date(m.utcDate).getTime() / 1000),
            competition: tournamentConfig.name,
            round_label: `Jornada ${m.matchday || index + 1}`,
            league_key: league,
          }))
        return NextResponse.json(formatted, { headers: { 'X-Data-Source': 'football-data' } })
      }
    }

    // 2️⃣ SofaScore FALLBACK
    const matches = await getUpcomingTournamentMatches(tournamentConfig.id, tournamentConfig.seasonId)
    if (matches.length > 0) {
      const formatted: FormattedMatch[] = matches
        .filter(m => m.startTimestamp * 1000 > Date.now())
        .slice(0, 20)
        .map(m => ({
          id: m.id,
          home_team: m.homeTeam.name,
          away_team: m.awayTeam.name,
          home_team_id: m.homeTeam.id,
          away_team_id: m.awayTeam.id,
          home_team_logo: getTeamLogoUrl(m.homeTeam.id),
          away_team_logo: getTeamLogoUrl(m.awayTeam.id),
          date: new Date(m.startTimestamp * 1000).toISOString(),
          start_timestamp: m.startTimestamp,
          competition: m.tournament?.name || tournamentConfig.name,
          round_label: m.roundInfo?.name || `Jornada ${m.roundInfo?.round || ''}`,
          league_key: league,
        }))
      return NextResponse.json(formatted, { headers: { 'X-Data-Source': 'sofascore' } })
    }

    // 3️⃣ Static fallback
    return NextResponse.json(generateFallbackMatches(league, tournamentConfig.name), {
      headers: { 'X-Data-Source': 'fallback' },
    })
  } catch (error) {
    console.error(`[Upcoming] Error for ${league}:`, error)
    
    const tournamentConfig = TOURNAMENT_IDS[league]
    return NextResponse.json(
      generateFallbackMatches(league, tournamentConfig?.name || league),
      { headers: { 'X-Data-Source': 'fallback' } }
    )
  }
}

function generateFallbackMatches(league: string, competitionName: string): FormattedMatch[] {
  const fallbackData = FALLBACK_MATCHES[league] || FALLBACK_MATCHES['spain_laliga']
  const now = Date.now()
  
  return fallbackData.map((match, index) => {
    // Generar fechas escalonadas (cada 1-2 días)
    const daysFromNow = Math.floor(index / 2) + 1
    const hoursOffset = (index % 3) * 2 + 18 // 18:00, 20:00, 22:00
    const matchDate = new Date(now)
    matchDate.setDate(matchDate.getDate() + daysFromNow)
    matchDate.setHours(hoursOffset, 0, 0, 0)
    
    return {
      id: 10000 + index,
      home_team: match.home,
      away_team: match.away,
      home_team_id: match.home_id,
      away_team_id: match.away_id,
      home_team_logo: getTeamLogoUrl(match.home_id),
      away_team_logo: getTeamLogoUrl(match.away_id),
      date: matchDate.toISOString(),
      start_timestamp: Math.floor(matchDate.getTime() / 1000),
      competition: competitionName,
      round_label: `Jornada ${35 + Math.floor(index / 6)}`,
      league_key: league,
    }
  })
}
