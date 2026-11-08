'use client'

import { useState, useEffect, useCallback } from 'react'
import { BarChart3, RefreshCw, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { getLeagues, type League, type LeagueGroup, type StandingEntry } from '@/lib/api-client'

interface StandingsViewProps {
  onPredictTeam?: (team: string) => void
}

export default function StandingsView({ onPredictTeam }: StandingsViewProps) {
  const [groups, setGroups] = useState<LeagueGroup[]>([])
  const [selectedLeague, setSelectedLeague] = useState<League | null>(null)
  const [standings, setStandings] = useState<StandingEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [leaguesLoading, setLeaguesLoading] = useState(true)
  const [leagueOpen, setLeagueOpen] = useState(false)
  const [isDemo, setIsDemo] = useState(false)

  useEffect(() => {
    getLeagues()
      .then(setGroups)
      .catch(() => {})
      .finally(() => setLeaguesLoading(false))
  }, [])

  const loadStandings = useCallback(async (leagueId: string) => {
    setLoading(true)
    setStandings([])
    try {
      const res = await fetch(`/api/standings?league=${encodeURIComponent(leagueId)}`)
      const data = await res.json()
      setStandings(data.standings ?? data ?? [])
      setIsDemo(!!data.demo)
    } catch {
      setStandings([])
    } finally {
      setLoading(false)
    }
  }, [])

  const handleLeagueSelect = (league: League) => {
    setSelectedLeague(league)
    setLeagueOpen(false)
    loadStandings(league.id)
  }

  return (
    <div className="flex flex-col gap-5 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold tracking-tight">Tabla de Posiciones</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Clasificacion en tiempo real por liga
          </p>
        </div>
        {selectedLeague && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => selectedLeague && loadStandings(selectedLeague.id)}
            disabled={loading}
            className="gap-1.5 text-xs"
          >
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
            Actualizar
          </Button>
        )}
      </div>

      {/* League selector */}
      <div className="bg-card border border-border rounded-xl p-4">
        <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2 block">
          Liga
        </label>
        <div className="relative">
          <button
            onClick={() => setLeagueOpen((v) => !v)}
            disabled={leaguesLoading}
            className="w-full flex items-center justify-between bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm hover:border-primary/50 transition-colors"
          >
            <span className={selectedLeague ? 'text-foreground' : 'text-muted-foreground'}>
              {leaguesLoading
                ? 'Cargando ligas...'
                : selectedLeague
                ? `${selectedLeague.flag ?? ''} ${selectedLeague.name} · ${selectedLeague.country}`
                : 'Selecciona una liga...'}
            </span>
            <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', leagueOpen && 'rotate-180')} />
          </button>

          {leagueOpen && (
            <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-popover border border-border rounded-xl shadow-xl overflow-hidden">
              <div className="max-h-64 overflow-y-auto">
                {groups.map((group) => (
                  <div key={group.name}>
                    <p className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground bg-background/80 sticky top-0 border-b border-border">
                      {group.name}
                    </p>
                    {group.leagues.map((league) => (
                      <button
                        key={league.id}
                        onClick={() => handleLeagueSelect(league)}
                        className={cn(
                          'w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-secondary transition-colors text-left',
                          selectedLeague?.id === league.id && 'bg-primary/10 text-primary'
                        )}
                      >
                        {league.flag && <span>{league.flag}</span>}
                        <span className="flex-1">{league.name}</span>
                        <span className="text-xs text-muted-foreground">{league.country}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {isDemo && (
        <Badge variant="outline" className="self-start text-[10px] border-draw/40 text-draw">
          Datos de demo (LaLiga 2024/25) — conecta el backend para datos reales
        </Badge>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <RefreshCw className="size-6 text-muted-foreground animate-spin" />
        </div>
      )}

      {/* Empty */}
      {!loading && !selectedLeague && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <div className="size-12 rounded-full bg-secondary flex items-center justify-center">
            <BarChart3 className="size-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">Selecciona una liga</p>
          <p className="text-xs text-muted-foreground max-w-xs leading-relaxed">
            Elige una liga para ver la tabla de clasificacion actual
          </p>
        </div>
      )}

      {/* Table */}
      {!loading && standings.length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[28px_1fr_40px_repeat(3,_36px)_52px_52px_52px] items-center gap-2 px-4 py-2.5 border-b border-border bg-secondary/50">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-center">#</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Equipo</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-center">PJ</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-center">G</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-center">E</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-center">P</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right">GD</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Forma</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right pr-1">Pts</span>
          </div>

          <div className="divide-y divide-border">
            {standings.map((entry) => (
              <StandingRow key={entry.position} entry={entry} />
            ))}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 px-4 py-3 border-t border-border bg-secondary/30">
            <div className="flex items-center gap-1.5">
              <div className="w-0.5 h-4 bg-primary rounded-full" />
              <span className="text-[10px] text-muted-foreground">Champions</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-0.5 h-4 bg-blue-500 rounded-full" />
              <span className="text-[10px] text-muted-foreground">Europa</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-0.5 h-4 bg-loss rounded-full" />
              <span className="text-[10px] text-muted-foreground">Descenso</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StandingRow({ entry }: { entry: StandingEntry }) {
  const isTop3 = entry.position <= 3
  const isTop6 = entry.position <= 6
  const isBottom3 = entry.position >= 18

  const posColor = isTop3
    ? 'text-primary font-bold'
    : isTop6
    ? 'text-blue-400 font-semibold'
    : isBottom3
    ? 'text-loss'
    : 'text-muted-foreground'

  const rowBorder = isTop3
    ? 'border-l-2 border-l-primary'
    : isTop6
    ? 'border-l-2 border-l-blue-500'
    : isBottom3
    ? 'border-l-2 border-l-loss'
    : ''

  return (
    <div
      className={cn(
        'grid grid-cols-[28px_1fr_40px_repeat(3,_36px)_52px_52px_52px] items-center gap-2 px-4 py-2.5 hover:bg-secondary/50 transition-colors cursor-default',
        rowBorder
      )}
    >
      <span className={cn('text-sm font-mono text-center', posColor)}>{entry.position}</span>

      <div className="flex items-center gap-2 min-w-0">
        {entry.teamLogo ? (
          <img
            src={entry.teamLogo}
            alt={entry.teamName}
            className="size-5 object-contain shrink-0"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        ) : (
          <div className="size-5 rounded-full bg-secondary shrink-0 flex items-center justify-center text-[8px] font-bold text-muted-foreground">
            {entry.teamName.charAt(0)}
          </div>
        )}
        <span className="text-sm font-medium truncate">{entry.teamName}</span>
      </div>

      <span className="text-xs text-muted-foreground text-center font-mono">{entry.played}</span>
      <span className="text-xs text-center font-mono text-win">{entry.won}</span>
      <span className="text-xs text-center font-mono text-muted-foreground">{entry.drawn}</span>
      <span className="text-xs text-center font-mono text-loss">{entry.lost}</span>

      <span className={cn(
        'text-xs text-right font-mono',
        entry.goalDifference > 0 ? 'text-win' : entry.goalDifference < 0 ? 'text-loss' : 'text-muted-foreground'
      )}>
        {entry.goalDifference > 0 ? '+' : ''}{entry.goalDifference}
      </span>

      <div className="flex items-center gap-0.5 justify-end">
        {(entry.form ?? []).slice(-5).map((result, i) => (
          <span
            key={i}
            className={cn(
              'size-4 rounded flex items-center justify-center text-[8px] font-bold',
              result === 'W' && 'bg-win/20 text-win',
              result === 'D' && 'bg-secondary text-muted-foreground',
              result === 'L' && 'bg-loss/20 text-loss',
            )}
          >
            {result}
          </span>
        ))}
      </div>

      <span className="text-sm font-bold text-right font-mono pr-1">{entry.points}</span>
    </div>
  )
}
