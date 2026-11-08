import { NextResponse } from 'next/server'
import { TOURNAMENT_IDS } from '@/lib/sofascore'

export const revalidate = 3600 // Revalidate every hour

interface League {
  id: string
  name: string
  country: string
  tier: number
  flag: string
}

interface LeagueGroup {
  name: string
  leagues: League[]
}

const FLAG_MAP: Record<string, string> = {
  Europe: '🇪🇺',
  Spain: '🇪🇸',
  England: '🏴',
  Germany: '🇩🇪',
  Italy: '🇮🇹',
  France: '🇫🇷',
  Portugal: '🇵🇹',
  Netherlands: '🇳🇱',
  Belgium: '🇧🇪',
  Turkey: '🇹🇷',
  Mexico: '🇲🇽',
  Argentina: '🇦🇷',
  Brazil: '🇧🇷',
  USA: '🇺🇸',
  Colombia: '🇨🇴',
}

export async function GET() {
  try {
    const groups: Record<string, League[]> = {}

    Object.entries(TOURNAMENT_IDS).forEach(([key, config]) => {
      const groupName =
        config.tier === 0 ? '🌐 Internacionales' :
        config.tier === 1 ? '🏆 Top Europa' :
        config.tier === 2 ? '🌍 Europa' :
        '🌎 Américas'

      if (!groups[groupName]) {
        groups[groupName] = []
      }

      groups[groupName].push({
        id: key,
        name: config.name,
        country: config.country,
        tier: config.tier,
        flag: FLAG_MAP[config.country] || '⚽',
      })
    })

    const sortedGroups: LeagueGroup[] = Object.entries(groups)
      .map(([name, leagues]) => ({
        name,
        leagues: leagues.sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))

    return NextResponse.json(sortedGroups)
  } catch (error) {
    console.error('[Leagues] Error:', error)

    return NextResponse.json([
      {
        name: '🏆 Top Europa',
        leagues: [
          { id: 'spain_laliga', name: 'La Liga', country: 'Spain', tier: 1, flag: '🇪🇸' },
          { id: 'england_premier_league', name: 'Premier League', country: 'England', tier: 1, flag: '🏴' },
          { id: 'germany_bundesliga', name: 'Bundesliga', country: 'Germany', tier: 1, flag: '🇩🇪' },
          { id: 'italy_serie_a', name: 'Serie A', country: 'Italy', tier: 1, flag: '🇮🇹' },
          { id: 'france_ligue_1', name: 'Ligue 1', country: 'France', tier: 1, flag: '🇫🇷' },
        ],
      },
      {
        name: '🌐 Internacionales',
        leagues: [
          { id: 'champions_league', name: 'Champions League', country: 'Europe', tier: 0, flag: '🇪🇺' },
        ],
      },
    ])
  }
}
