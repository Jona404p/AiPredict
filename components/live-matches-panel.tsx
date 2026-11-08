'use client'

import { useEffect, useState, useCallback } from 'react'
import { Radio, RefreshCw, Clock, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getLiveMatches, type LiveMatch } from '@/lib/api-client'

interface LiveMatchesPanelProps {
  onMatchSelect?: (home: string, away: string, league: string) => void
}

export default function LiveMatchesPanel({ onMatchSelect }: LiveMatchesPanelProps) {
  const [matches, setMatches] = useState<LiveMatch[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const fetchMatches = useCallback(async () => {
    try {
      const data = await getLiveMatches()
      setMatches(data)
      setLastUpdated(new Date())
    } catch {
      // silently fail; keep showing stale data
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchMatches()
    const interval = setInterval(fetchMatches, 30_000)
    return () => clearInterval(interval)
  }, [fetchMatches])

  const live = matches.filter((m) => m.status === 'live')
  const halftime = matches.filter((m) => m.status === 'halftime')
  const upcoming = matches.filter((m) => m.status === 'upcoming')

  return (
    <div className="flex flex-col h-full">
      {/* Panel header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Radio className="w-4 h-4 text-live" />
          <span className="text-sm font-semibold">En Vivo</span>
          {live.length > 0 && (
            <Badge className="bg-live/20 text-live border-live/30 text-[10px] px-1.5 py-0">
              {live.length}
            </Badge>
          )}
        </div>
        <button
          onClick={fetchMatches}
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Actualizar partidos"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
        </button>
      </div>

      {/* Match list */}
      <div className="flex-1 overflow-y-auto">
        {loading && matches.length === 0 && (
          <div className="flex items-center justify-center h-24">
            <RefreshCw className="w-5 h-5 text-muted-foreground animate-spin" />
          </div>
        )}

        {!loading && matches.length === 0 && (
          <div className="flex flex-col items-center justify-center h-24 gap-1.5">
            <p className="text-xs text-muted-foreground">Sin partidos disponibles</p>
          </div>
        )}

        {/* Live */}
        {live.length > 0 && (
          <MatchSection
            title="En curso"
            matches={live}
            onSelect={onMatchSelect}
            accent="text-live"
          />
        )}

        {/* Half-time */}
        {halftime.length > 0 && (
          <MatchSection
            title="Descanso"
            matches={halftime}
            onSelect={onMatchSelect}
            accent="text-draw"
          />
        )}

        {/* Upcoming */}
        {upcoming.length > 0 && (
          <MatchSection
            title="Próximos"
            matches={upcoming}
            onSelect={onMatchSelect}
            accent="text-muted-foreground"
          />
        )}
      </div>

      {/* Footer */}
      {lastUpdated && (
        <div className="px-4 py-2 border-t border-border shrink-0">
          <p className="text-[10px] text-muted-foreground">
            Actualizado:{' '}
            {lastUpdated.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            {' · '}Auto-refresh 30s
          </p>
        </div>
      )}
    </div>
  )
}

function MatchSection({
  title,
  matches,
  onSelect,
  accent,
}: {
  title: string
  matches: LiveMatch[]
  onSelect?: (home: string, away: string, league: string) => void
  accent: string
}) {
  return (
    <div>
      <div className="px-4 py-2 sticky top-0 bg-background z-10">
        <p className={cn('text-[10px] font-semibold uppercase tracking-widest', accent)}>{title}</p>
      </div>
      <div className="divide-y divide-border">
        {matches.map((match) => (
          <MatchRow key={match.id} match={match} onSelect={onSelect} />
        ))}
      </div>
    </div>
  )
}

function MatchRow({
  match,
  onSelect,
}: {
  match: LiveMatch
  onSelect?: (home: string, away: string, league: string) => void
}) {
  const isLive = match.status === 'live'
  const isHalf = match.status === 'halftime'

  return (
    <button
      onClick={() => onSelect?.(match.homeTeam, match.awayTeam, match.league)}
      className="w-full px-4 py-3 hover:bg-secondary transition-colors text-left group"
    >
      <div className="flex items-center justify-between gap-2">
        {/* Teams + score */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-foreground truncate">{match.homeTeam}</span>
            <span className={cn(
              'text-sm font-bold tabular-nums shrink-0',
              isLive ? 'text-foreground' : 'text-muted-foreground'
            )}>
              {match.status === 'upcoming' ? '-' : match.homeScore}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 mt-0.5">
            <span className="text-xs text-muted-foreground truncate">{match.awayTeam}</span>
            <span className={cn(
              'text-sm font-bold tabular-nums shrink-0',
              isLive ? 'text-foreground' : 'text-muted-foreground'
            )}>
              {match.status === 'upcoming' ? '-' : match.awayScore}
            </span>
          </div>
        </div>

        {/* Status badge */}
        <div className="flex flex-col items-end gap-1 shrink-0">
          {isLive && (
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-live animate-pulse" />
              <span className="text-[10px] font-bold text-live">{match.minute}&apos;</span>
            </div>
          )}
          {isHalf && (
            <Badge variant="outline" className="text-[9px] px-1 py-0 text-draw border-draw/40">
              HT
            </Badge>
          )}
          {match.status === 'upcoming' && match.startTime && (
            <div className="flex items-center gap-1 text-muted-foreground">
              <Clock className="w-3 h-3" />
              <span className="text-[10px]">{match.startTime}</span>
            </div>
          )}
          <ChevronRight className="w-3 h-3 text-muted-foreground group-hover:text-foreground transition-colors" />
        </div>
      </div>

      {/* League */}
      <p className="text-[10px] text-muted-foreground mt-1.5">{match.league}</p>
    </button>
  )
}
