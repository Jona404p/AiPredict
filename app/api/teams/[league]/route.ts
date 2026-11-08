import { NextRequest, NextResponse } from 'next/server'
import { getTournamentTeams, TOURNAMENT_IDS, getTeamLogoUrl } from '@/lib/sofascore'

export const revalidate = 3600 // Revalidate every hour

// Datos de respaldo por liga
const FALLBACK_TEAMS: Record<string, Array<{ id: number; name: string }>> = {
  spain_laliga: [
    { id: 2829, name: 'Real Madrid' },
    { id: 2817, name: 'FC Barcelona' },
    { id: 2836, name: 'Atlético Madrid' },
    { id: 2848, name: 'Athletic Club' },
    { id: 2859, name: 'Girona FC' },
    { id: 2869, name: 'Real Sociedad' },
    { id: 2815, name: 'Villarreal' },
    { id: 2816, name: 'Real Betis' },
    { id: 2833, name: 'Sevilla FC' },
    { id: 2820, name: 'Getafe CF' },
    { id: 2821, name: 'CA Osasuna' },
    { id: 2831, name: 'Valencia CF' },
    { id: 2825, name: 'Celta de Vigo' },
    { id: 2858, name: 'Real Valladolid' },
    { id: 2853, name: 'Rayo Vallecano' },
    { id: 2846, name: 'RCD Espanyol' },
    { id: 2857, name: 'UD Las Palmas' },
    { id: 24264, name: 'CD Leganés' },
    { id: 2819, name: 'Deportivo Alavés' },
    { id: 2824, name: 'RCD Mallorca' },
  ],
  england_premier_league: [
    { id: 17, name: 'Manchester City' },
    { id: 42, name: 'Arsenal' },
    { id: 44, name: 'Liverpool' },
    { id: 38, name: 'Chelsea' },
    { id: 35, name: 'Manchester United' },
    { id: 33, name: 'Tottenham Hotspur' },
    { id: 40, name: 'Aston Villa' },
    { id: 39, name: 'Newcastle United' },
    { id: 3, name: 'Brighton & Hove Albion' },
    { id: 37, name: 'West Ham United' },
    { id: 36, name: 'Fulham' },
    { id: 7, name: 'Brentford' },
    { id: 31, name: 'Crystal Palace' },
    { id: 14, name: 'Nottingham Forest' },
    { id: 48, name: 'Wolverhampton' },
    { id: 15, name: 'Everton' },
    { id: 30, name: 'AFC Bournemouth' },
    { id: 25, name: 'Leicester City' },
    { id: 50, name: 'Ipswich Town' },
    { id: 41, name: 'Southampton' },
  ],
  germany_bundesliga: [
    { id: 2672, name: 'Bayer Leverkusen' },
    { id: 2673, name: 'Bayern Munich' },
    { id: 2675, name: 'Borussia Dortmund' },
    { id: 2681, name: 'RB Leipzig' },
    { id: 2676, name: 'VfB Stuttgart' },
    { id: 2671, name: 'Eintracht Frankfurt' },
    { id: 2692, name: 'SC Freiburg' },
    { id: 2695, name: 'TSG Hoffenheim' },
    { id: 2674, name: 'Werder Bremen' },
    { id: 2694, name: 'VfL Wolfsburg' },
  ],
  italy_serie_a: [
    { id: 2714, name: 'Inter Milan' },
    { id: 2692, name: 'AC Milan' },
    { id: 2687, name: 'Juventus' },
    { id: 2686, name: 'Napoli' },
    { id: 2681, name: 'Atalanta' },
    { id: 2670, name: 'Roma' },
    { id: 2685, name: 'Lazio' },
    { id: 2690, name: 'Fiorentina' },
    { id: 2672, name: 'Torino' },
    { id: 2677, name: 'Bologna' },
  ],
  france_ligue_1: [
    { id: 1644, name: 'Paris Saint-Germain' },
    { id: 1649, name: 'Monaco' },
    { id: 1643, name: 'Olympique Lyon' },
    { id: 1641, name: 'Marseille' },
    { id: 1650, name: 'Lille' },
    { id: 1661, name: 'Rennes' },
    { id: 1653, name: 'Nice' },
    { id: 1659, name: 'Lens' },
    { id: 1646, name: 'Strasbourg' },
    { id: 1656, name: 'Montpellier' },
  ],
  mexico_liga_mx: [
    { id: 6075, name: 'Club América' },
    { id: 6117, name: 'Guadalajara' },
    { id: 6098, name: 'Cruz Azul' },
    { id: 6076, name: 'Tigres UANL' },
    { id: 6099, name: 'Monterrey' },
    { id: 6101, name: 'Pumas UNAM' },
    { id: 6107, name: 'Santos Laguna' },
    { id: 6108, name: 'Toluca' },
    { id: 6111, name: 'León' },
    { id: 6114, name: 'Pachuca' },
  ],
  argentina_liga_profesional: [
    { id: 3211, name: 'River Plate' },
    { id: 3204, name: 'Boca Juniors' },
    { id: 3221, name: 'Racing Club' },
    { id: 3217, name: 'San Lorenzo' },
    { id: 3209, name: 'Independiente' },
    { id: 3202, name: 'Vélez Sarsfield' },
    { id: 3210, name: 'Lanús' },
    { id: 3220, name: 'Estudiantes' },
    { id: 3203, name: 'Talleres' },
    { id: 3224, name: 'Huracán' },
  ],
  brazil_serie_a: [
    { id: 5926, name: 'Flamengo' },
    { id: 5981, name: 'Palmeiras' },
    { id: 5929, name: 'Corinthians' },
    { id: 5930, name: 'São Paulo' },
    { id: 5927, name: 'Fluminense' },
    { id: 5924, name: 'Botafogo' },
    { id: 5975, name: 'Grêmio' },
    { id: 5974, name: 'Internacional' },
    { id: 5932, name: 'Santos' },
    { id: 5940, name: 'Atlético Mineiro' },
  ],
  champions_league: [
    { id: 2829, name: 'Real Madrid' },
    { id: 2673, name: 'Bayern Munich' },
    { id: 17, name: 'Manchester City' },
    { id: 1644, name: 'Paris Saint-Germain' },
    { id: 2714, name: 'Inter Milan' },
    { id: 2817, name: 'FC Barcelona' },
    { id: 2675, name: 'Borussia Dortmund' },
    { id: 42, name: 'Arsenal' },
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
      // Intentar con datos de respaldo
      const fallback = FALLBACK_TEAMS[league]
      if (fallback) {
        return NextResponse.json(
          fallback.map(t => ({
            id: t.id,
            name: t.name,
            logo: getTeamLogoUrl(t.id),
          }))
        )
      }
      return NextResponse.json({ error: 'Liga no encontrada' }, { status: 404 })
    }

    // Obtener equipos de SofaScore
    const teams = await getTournamentTeams(tournamentConfig.id, tournamentConfig.seasonId)
    
    if (teams.length > 0) {
      const formatted = teams.map(t => ({
        id: t.id,
        name: t.name,
        logo: getTeamLogoUrl(t.id),
      }))
      return NextResponse.json(formatted)
    }
    
    // Fallback si no hay datos
    const fallback = FALLBACK_TEAMS[league]
    if (fallback) {
      return NextResponse.json(
        fallback.map(t => ({
          id: t.id,
          name: t.name,
          logo: getTeamLogoUrl(t.id),
        }))
      )
    }
    
    return NextResponse.json([])
  } catch (error) {
    console.error(`[Teams] Error for ${league}:`, error)
    
    // En caso de error, intentar con datos de respaldo
    const fallback = FALLBACK_TEAMS[league]
    if (fallback) {
      return NextResponse.json(
        fallback.map(t => ({
          id: t.id,
          name: t.name,
          logo: getTeamLogoUrl(t.id),
        })),
        { headers: { 'X-Data-Source': 'fallback' } }
      )
    }
    
    return NextResponse.json({ error: 'Error obteniendo equipos' }, { status: 500 })
  }
}
