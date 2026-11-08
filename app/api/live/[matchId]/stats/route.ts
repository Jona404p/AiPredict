import { NextRequest, NextResponse } from 'next/server'
import { getMatchStatistics, getMatchDetails } from '@/lib/sofascore'

export const revalidate = 30 // Revalidate every 30 seconds

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ matchId: string }> }
) {
  const { matchId } = await params
  const id = parseInt(matchId)
  
  if (isNaN(id)) {
    return NextResponse.json({ error: 'ID de partido inválido' }, { status: 400 })
  }

  try {
    const [stats, match] = await Promise.all([
      getMatchStatistics(id),
      getMatchDetails(id),
    ])
    
    if (!stats || !match) {
      return NextResponse.json({ error: 'Partido no encontrado' }, { status: 404 })
    }

    // Formatear estadísticas
    const formattedStats: Record<string, { home: number | string; away: number | string }> = {}
    
    if (stats.groups) {
      stats.groups.forEach(group => {
        group.statisticsItems?.forEach(item => {
          const key = item.name
            .toLowerCase()
            .replace(/\s+/g, '_')
            .replace(/[^a-z0-9_]/g, '')
          
          formattedStats[key] = {
            home: item.homeValue,
            away: item.awayValue,
          }
        })
      })
    }

    return NextResponse.json({
      match: {
        id: match.id,
        home_team: match.homeTeam.name,
        away_team: match.awayTeam.name,
        home_score: match.homeScore?.current ?? 0,
        away_score: match.awayScore?.current ?? 0,
        status: match.status.description,
      },
      statistics: formattedStats,
    })
  } catch (error) {
    console.error(`[Live Stats] Error for ${matchId}:`, error)
    return NextResponse.json({ error: 'Error obteniendo estadísticas' }, { status: 500 })
  }
}
