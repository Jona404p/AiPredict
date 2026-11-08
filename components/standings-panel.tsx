'use client'

import useSWR from 'swr'
import { useState } from 'react'
import Image from 'next/image'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

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

interface Standing {
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

// Normalizes any API shape → Standing[]
async function fetchStandings(url: string): Promise<Standing[]> {
  const res = await fetch(url)
  if (!res.ok) return []
  const data = await res.json()
  if (Array.isArray(data)) return data
  if (Array.isArray(data.standings)) return data.standings
  if (Array.isArray(data.data)) return data.data
  return []
}

const fetchLeagues = (url: string) => fetch(url).then(r => r.json())

export function StandingsPanel() {
  const [selectedLeague, setSelectedLeague] = useState<string>('')

  const { data: leagueData } = useSWR<LeagueGroup[]>('/api/leagues', fetchLeagues)
  const { data: standings = [], isLoading } = useSWR<Standing[]>(
    selectedLeague ? `/api/standings/${selectedLeague}` : null,
    fetchStandings
  )

  const groupedLeagues = leagueData ?? []
  const total = standings.length

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold tracking-wider uppercase">
          Tabla de Posiciones
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
              <p className="text-sm text-text-2">Cargando tabla...</p>
            </div>
          </CardContent>
        </Card>
      )}

      {!isLoading && selectedLeague && standings.length > 0 && (
        <Card className="bg-surface border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-2">
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-text-3">#</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-text-3">Equipo</th>
                  <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wider text-text-3">PJ</th>
                  <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wider text-text-3">G</th>
                  <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wider text-text-3">E</th>
                  <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wider text-text-3">P</th>
                  <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wider text-text-3">GF</th>
                  <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wider text-text-3">GC</th>
                  <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wider text-text-3">DG</th>
                  <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wider text-text-3">Pts</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((row, idx) => {
                  const isTop4 = idx < 4
                  const isRelegation = total >= 10 && row.position > total - 3
                  return (
                    <tr
                      key={row.team_id ?? idx}
                      className={cn(
                        'border-b border-border transition-colors hover:bg-surface-2',
                        isTop4 && 'bg-accent-green-dim/30'
                      )}
                    >
                      <td className={cn(
                        'px-4 py-3 font-mono font-bold',
                        isTop4 ? 'text-accent-green' : isRelegation ? 'text-destructive' : 'text-text-2'
                      )}>
                        {row.position}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <TeamLogo src={row.team_logo} name={row.team_name} />
                          <span className="font-medium truncate">{row.team_name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center text-text-2">{row.played}</td>
                      <td className="px-4 py-3 text-center text-text-2">{row.won}</td>
                      <td className="px-4 py-3 text-center text-text-2">{row.draw}</td>
                      <td className="px-4 py-3 text-center text-text-2">{row.lost}</td>
                      <td className="px-4 py-3 text-center text-text-2">{row.goals_for}</td>
                      <td className="px-4 py-3 text-center text-text-2">{row.goals_against}</td>
                      <td className={cn(
                        'px-4 py-3 text-center font-mono font-semibold',
                        row.goal_diff > 0 ? 'text-accent-green' : row.goal_diff < 0 ? 'text-destructive' : 'text-text-2'
                      )}>
                        {row.goal_diff > 0 ? '+' : ''}{row.goal_diff}
                      </td>
                      <td className="px-4 py-3 text-center font-mono font-bold text-foreground">
                        {row.points}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {!isLoading && selectedLeague && standings.length === 0 && (
        <Card className="bg-surface border-border">
          <CardContent className="py-12 flex flex-col items-center justify-center gap-4">
            <div className="text-4xl">📊</div>
            <h3 className="font-semibold text-lg">Sin datos disponibles</h3>
            <p className="text-text-2 text-center max-w-md">
              No se pudo cargar la tabla para esta liga
            </p>
          </CardContent>
        </Card>
      )}

      {!selectedLeague && !isLoading && (
        <Card className="bg-surface border-border">
          <CardContent className="py-12 flex flex-col items-center justify-center gap-4">
            <div className="text-4xl">📊</div>
            <h3 className="font-semibold text-lg">Tabla de Posiciones</h3>
            <p className="text-text-2 text-center max-w-md">
              Selecciona una liga para ver la clasificación actual con todos los detalles
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function TeamLogo({ src, name }: { src?: string; name: string }) {
  const [errored, setErrored] = useState(false)

  if (!src || errored) {
    return (
      <div className="w-6 h-6 rounded-full bg-surface-3 border border-border-2 flex items-center justify-center text-xs font-bold text-text-3 flex-shrink-0">
        {name?.charAt(0) ?? '?'}
      </div>
    )
  }

  return (
    <div className="w-6 h-6 relative rounded-full overflow-hidden bg-surface-3 flex-shrink-0">
      <Image
        src={src}
        alt={name}
        fill
        className="object-contain p-0.5"
        onError={() => setErrored(true)}
        unoptimized
      />
    </div>
  )
}
