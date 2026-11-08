import { NextRequest, NextResponse } from 'next/server'
import {
  getTournamentStandings,
  getStandingsFromFD,
  TOURNAMENT_IDS,
  getTeamLogoUrl,
} from '@/lib/sofascore'
import { FALLBACK_STANDINGS, type FallbackStanding } from '@/lib/fallback-data'

export const revalidate = 1800

interface FormattedStanding {
  position: number
  team_name: string
  team_id: number
  team_logo: string
  played: number
  won: number
  draw: number
  lost: number
  goals_for: number
  goals_against: number
  goal_diff: number
  points: number
  promotion?: string
}

function normalizeFallbackStanding(row: FallbackStanding): FormattedStanding {
  return {
    position: row.position,
    team_name: row.team_name,
    team_id: row.team_id,
    team_logo: row.team_logo || getTeamLogoUrl(row.team_id),
    played: row.played,
    won: row.won,
    draw: row.draw,
    lost: row.lost,
    goals_for: row.goals_for,
    goals_against: row.goals_against,
    goal_diff: row.goal_diff,
    points: row.points,
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ league: string }> }
) {
  const { league } = await params
  const tournament = TOURNAMENT_IDS[league]

  if (!tournament) {
    return NextResponse.json({ error: 'Liga no encontrada' }, { status: 404 })
  }

  try {
    if (tournament.fdCode) {
      const fdRows = await getStandingsFromFD(tournament.fdCode)
      if (fdRows && fdRows.length > 0) {
        const standings: FormattedStanding[] = fdRows.map(row => ({
          position: row.position,
          team_name: row.team.name,
          team_id: row.team.id,
          team_logo: row.team.crest || getTeamLogoUrl(row.team.id),
          played: row.playedGames,
          won: row.won,
          draw: row.draw,
          lost: row.lost,
          goals_for: row.goalsFor,
          goals_against: row.goalsAgainst,
          goal_diff: row.goalDifference,
          points: row.points,
        }))
        return NextResponse.json({ standings, source: 'football-data', league: tournament.name, season: '2025/26' })
      }
    }

    const sofaRows = await getTournamentStandings(tournament.id, tournament.seasonId)
    if (sofaRows?.length > 0) {
      const standings: FormattedStanding[] = sofaRows.map(row => ({
        position: row.position,
        team_name: row.team.name,
        team_id: row.team.id,
        team_logo: getTeamLogoUrl(row.team.id),
        played: row.matches,
        won: row.wins,
        draw: row.draws,
        lost: row.losses,
        goals_for: row.scoresFor,
        goals_against: row.scoresAgainst,
        goal_diff: row.scoresFor - row.scoresAgainst,
        points: row.points,
        promotion: row.promotion?.text,
      }))
      return NextResponse.json({ standings, source: 'sofascore', league: tournament.name, season: '2025/26' })
    }

    const fallback = FALLBACK_STANDINGS[league]
    if (fallback?.length) {
      return NextResponse.json({
        standings: fallback.map(normalizeFallbackStanding),
        source: 'fallback',
        league: tournament.name,
        season: '2025/26',
        notice: 'Datos de referencia — fuentes en vivo no disponibles temporalmente',
      })
    }

    return NextResponse.json({ standings: [], league: tournament.name })
  } catch (error) {
    console.error('[Standings] error:', error)
    const fallback = FALLBACK_STANDINGS[league] ?? []
    return NextResponse.json({
      standings: fallback.map(normalizeFallbackStanding),
      source: 'fallback',
      league: tournament.name,
      season: '2025/26',
      notice: 'Error en fuentes en vivo',
    })
  }
}
