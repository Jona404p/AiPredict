'use client'

import useSWR from 'swr'
import { useState } from 'react'
import Image from 'next/image'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { Search, MessageCircle } from 'lucide-react'

const fetcher = (url: string) => fetch(url).then(r => r.json())

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

interface UpcomingMatch {
  id: string
  homeTeam: string
  awayTeam: string
  homeTeamLogo: string
  awayTeamLogo: string
  league: string
  date: string
  time: string
  venue?: string
  round?: string
  timestamp?: number
  homeTeamId?: number
  awayTeamId?: number
}

interface UpcomingPanelProps {
  onPredict?: (match: UpcomingMatch) => void
}

const fetchUpcomingMatches = async (url: string): Promise<UpcomingMatch[]> => {
  const res = await fetch(url)
  if (!res.ok) return []
  const data = await res.json()
  return data?.matches ?? []
}

export function UpcomingPanel({ onPredict }: UpcomingPanelProps) {
  const [selectedLeague, setSelectedLeague] = useState<string>('')
  
  const { data: leagues } = useSWR<LeagueGroup[]>('/api/leagues', fetcher)
  const { data: matches, isLoading } = useSWR<UpcomingMatch[]>(
    selectedLeague ? `/api/upcoming?league=${selectedLeague}` : null,
    fetchUpcomingMatches
  )

  const groupedLeagues = leagues ?? []

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold tracking-wider uppercase">
          Próximos Partidos
        </h2>
      </div>

      <Card className="bg-surface border-border">
        <CardHeader>
          <CardTitle className="text-sm font-semibold tracking-wider uppercase text-text-2">
            Selecciona una Liga
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={selectedLeague} onValueChange={setSelectedLeague}>
            <SelectTrigger className="bg-surface-2 border-border-2">
              <SelectValue placeholder="Selecciona una liga..." />
            </SelectTrigger>
            <SelectContent className="bg-surface-2 border-border-2">
              {groupedLeagues.map((group) => (
                <div key={group.name}>
                  <div className="px-2 py-1.5 text-xs font-bold text-text-3 uppercase tracking-wider">
                    {group.name}
                  </div>
                  {group.leagues.map((league) => (
                    <SelectItem key={league.id} value={league.id}>
                      <span className="flex items-center gap-2">
                        <span>{league.flag}</span>
                        <span>{league.name}</span>
                      </span>
                    </SelectItem>
                  ))}
                </div>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {isLoading && (
        <Card className="bg-surface border-border">
          <CardContent className="py-8">
            <div className="flex flex-col items-center justify-center gap-4">
              <div className="w-8 h-8 border-2 border-accent-green border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-text-2">Cargando partidos...</p>
            </div>
          </CardContent>
        </Card>
      )}

      {matches && matches.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {matches.map((match) => (
            <Card 
              key={match.id} 
              className="bg-surface border-border hover:border-accent-green/30 transition-all cursor-pointer group"
              onClick={() => onPredict?.(match)}
            >
              <CardContent className="p-4 space-y-4">
                {/* Header */}
                <div className="flex items-center justify-between">
                  <Badge variant="secondary" className="bg-surface-2 text-text-2 text-xs">
                    ⚽ {match.league}
                  </Badge>
                  <span className="text-xs text-text-3">
                    {match.date} · {match.time}
                  </span>
                </div>

                {/* Teams */}
                <div className="flex items-center justify-between">
                  <div className="flex flex-col items-center gap-2 flex-1">
                    <div className="w-12 h-12 relative rounded-full overflow-hidden bg-surface-3 border border-border-2">
                      <Image
                        src={match.homeTeamLogo}
                        alt={match.homeTeam}
                        fill
                        className="object-contain p-1"
                        onError={(e) => {
                          const img = e.target as HTMLImageElement
                          img.style.display = 'none'
                        }}
                      />
                    </div>
                    <span className="text-xs font-medium text-center line-clamp-2">
                      {match.homeTeam}
                    </span>
                  </div>

                  <div className="flex flex-col items-center px-3">
                    <span className="text-lg font-bold text-text-3">VS</span>
                  </div>

                  <div className="flex flex-col items-center gap-2 flex-1">
                    <div className="w-12 h-12 relative rounded-full overflow-hidden bg-surface-3 border border-border-2">
                      <Image
                        src={match.awayTeamLogo}
                        alt={match.awayTeam}
                        fill
                        className="object-contain p-1"
                        onError={(e) => {
                          const img = e.target as HTMLImageElement
                          img.style.display = 'none'
                        }}
                      />
                    </div>
                    <span className="text-xs font-medium text-center line-clamp-2">
                      {match.awayTeam}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  {match.round && (
                    <Badge variant="outline" className="text-xs border-border-2 text-text-3">
                      {match.round}
                    </Badge>
                  )}
                  <Button 
                    size="sm" 
                    className="ml-auto bg-primary text-primary-foreground hover:bg-accent-green/90"
                    onClick={(e) => {
                      e.stopPropagation()
                      onPredict?.(match)
                    }}
                  >
                    <Search className="w-3 h-3 mr-1" />
                    Predecir
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {matches && matches.length === 0 && (
        <Card className="bg-surface border-border">
          <CardContent className="py-12 flex flex-col items-center justify-center gap-4">
            <div className="text-4xl">📅</div>
            <h3 className="font-semibold text-lg">Sin partidos próximos</h3>
            <p className="text-text-2 text-center max-w-md">
              No hay partidos programados para esta liga en los próximos días
            </p>
          </CardContent>
        </Card>
      )}

      {!selectedLeague && !isLoading && (
        <Card className="bg-surface border-border">
          <CardContent className="py-12 flex flex-col items-center justify-center gap-4">
            <div className="text-4xl">📅</div>
            <h3 className="font-semibold text-lg">Partidos Próximos</h3>
            <p className="text-text-2 text-center max-w-md">
              Selecciona una liga para ver los próximos partidos y hacer predicciones con IA
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function groupLeagues(leagues: League[]): Record<string, League[]> {
  const groups: Record<string, League[]> = {}
  
  leagues.forEach(league => {
    const groupName = league.tier === 0 ? '🌐 Internacionales' :
      league.tier === 1 ? '🏆 Top Europa' :
      league.tier === 2 ? '🌍 Europa' :
      '🌎 Américas'
    
    if (!groups[groupName]) groups[groupName] = []
    groups[groupName].push(league)
  })
  
  return groups
}
