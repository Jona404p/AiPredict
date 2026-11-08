import { NextResponse } from 'next/server'
import { getLiveMatches, getTeamLogoUrl, mapMatchStatus, getMinutesFromTimestamp } from '@/lib/sofascore'

export const revalidate = 30 // Revalidate every 30 seconds

interface FormattedLiveMatch {
  id: number
  sofascore_id: number
  home_team: string
  away_team: string
  home_team_id: number
  away_team_id: number
  home_logo: string
  away_logo: string
  home_score: number
  away_score: number
  home_ht: number | null
  away_ht: number | null
  status: string
  status_desc: string
  minute: string
  tournament: string
  start_time: string
}

export async function GET() {
  try {
    const matches = await getLiveMatches()
    
    if (matches.length > 0) {
      const formatted: FormattedLiveMatch[] = matches
        .filter(m => m.tournament?.category?.slug?.includes('football') || true) // Solo fútbol
        .slice(0, 50) // Limitar cantidad
        .map(m => {
          const minutes = getMinutesFromTimestamp(m)
          let statusDesc = ''
          
          if (m.status.code === 6) {
            statusDesc = minutes ? `${minutes}'` : 'En juego'
          } else if (m.status.code === 7) {
            statusDesc = minutes ? `${minutes}'` : '2do Tiempo'
          } else if (m.status.code === 31) {
            statusDesc = 'Entretiempo'
          } else {
            statusDesc = m.status.description || 'En juego'
          }

          return {
            id: m.id,
            sofascore_id: m.id,
            home_team: m.homeTeam.name,
            away_team: m.awayTeam.name,
            home_team_id: m.homeTeam.id,
            away_team_id: m.awayTeam.id,
            home_logo: getTeamLogoUrl(m.homeTeam.id),
            away_logo: getTeamLogoUrl(m.awayTeam.id),
            home_score: m.homeScore?.current ?? 0,
            away_score: m.awayScore?.current ?? 0,
            home_ht: m.homeScore?.period1 ?? null,
            away_ht: m.awayScore?.period1 ?? null,
            status: mapMatchStatus(m.status.type, m.status.code),
            status_desc: statusDesc,
            minute: minutes ? `${minutes}'` : statusDesc,
            tournament: m.tournament?.name || 'Fútbol',
            start_time: new Date(m.startTimestamp * 1000).toLocaleTimeString('es-ES', {
              hour: '2-digit',
              minute: '2-digit',
            }),
          }
        })
      
      return NextResponse.json({ matches: formatted })
    }
    
    // Si no hay partidos en vivo, devolver array vacío
    return NextResponse.json({ matches: [] })
  } catch (error) {
    console.error('[Live] Error:', error)
    
    // En caso de error, devolver vacío (no hay partidos)
    return NextResponse.json({ 
      matches: [],
      error: 'No se pudieron cargar los partidos en vivo'
    })
  }
}
