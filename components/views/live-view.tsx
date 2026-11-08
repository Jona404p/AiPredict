'use client'

import { useState, useEffect, useCallback } from 'react'
import { Radio, RefreshCw, Zap, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { getLiveMatches, type LiveMatch } from '@/lib/api-client'

interface LiveViewProps {
  onPredictMatch?: (home: string, away: string, league: string) => void
}

export default function LiveView({ onPredictMatch }: LiveViewProps) {
  const [matches, setMatches] = useState<LiveMatch[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const fetchMatches = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getLiveMatches()
      setMatches(data)
      setLastUpdated(new Date())
    } catch {
      // keep stale data
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
    <div className="flex flex-col gap-5 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold tracking-tight">En Vivo</h1>
            {live.length > 0 && (
              <Badge className="bg-live/20 text-live border-live/30 text-[10px]">
                {live.length} en directo
              </Badge>
            )}
          </div>
          {lastUpdated && (
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Actualizado: {lastUpdated.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              {' · '}Auto-refresh 30s
            </p>
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={fetchMatches}
          disabled={loading}
          className="gap-1.5 text-xs"
        >
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
          Actualizar
        </Button>
      </div>

      {/* Loading */}
      {loading && matches.length === 0 && (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="size-6 text-muted-foreground animate-spin" />
        </div>
      )}

      {/* Empty */}
      {!loading && matches.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
          <div className="size-12 rounded-full bg-secondary flex items-center justify-center">
            <Radio className="size-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">Sin partidos en vivo</p>
          <p className="text-xs text-muted-foreground max-w-xs leading-relaxed">
            No hay partidos en directo ahora mismo. Vuelve mas tarde o conecta el backend para datos reales.
          </p>
        </div>
      )}

      {/* Live section */}
      {live.length > 0 && (
        <LiveSection
          title="En Directo"
          accent="text-live"
          dot
          matches={live}
          onPredict={onPredictMatch}
        />
      )}

      {/* Halftime section */}
      {halftime.length > 0 && (
        <LiveSection
          title="Descanso"
          accent="text-draw"
          matches={halftime}
          onPredict={onPredictMatch}
        />
      )}

      {/* Upcoming section */}
      {upcoming.length > 0 && (
        <LiveSection
          title="Proximos"
          accent="text-muted-foreground"
          matches={upcoming}
          onPredict={onPredictMatch}
        />
      )}
    </div>
  )
}

function LiveSection({
  title,
  accent,
  dot,
  matches,
  onPredict,
}: {
  title: string
  accent: string
  dot?: boolean
  matches: LiveMatch[]
  onPredict?: (home: string, away: string, league: string) => void
}) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <div className="flex items-center gap-2">
          {dot && <span className="size-2 rounded-full bg-live animate-pulse" />}
          <span className={cn('text-[11px] font-semibold uppercase tracking-widest', accent)}>
            {title}
          </span>
        </div>
        <div className="flex-1 h-px bg-border" />
        <span className="text-[10px] text-muted-foreground">{matches.length}</span>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        {matches.map((match) => (
          <LiveMatchCard key={match.id} match={match} onPredict={onPredict} />
        ))}
      </div>
    </div>
  )
}

function LiveMatchCard({
  match,
  onPredict,
}: {
  match: LiveMatch
  onPredict?: (home: string, away: string, league: string) => void
}) {
  const isLive = match.status === 'live'
  const isHalf = match.status === 'halftime'
  const isUpcoming = match.status === 'upcoming'

  return (
    <div
      className={cn(
        'bg-card border rounded-xl p-4 flex flex-col gap-3 hover:border-primary/40 transition-colors',
        isLive ? 'border-live/30' : 'border-border'
      )}
    >
      {/* Top: league + status */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">{match.league}</span>
        {isLive && (
          <div className="flex items-center gap-1.5 bg-live/10 border border-live/20 text-live text-[10px] font-bold px-2 py-0.5 rounded-full">
            <span className="size-1.5 rounded-full bg-live animate-pulse" />
            {match.minute}&apos;
          </div>
        )}
        {isHalf && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-draw/40 text-draw">
            Descanso
          </Badge>
        )}
        {isUpcoming && match.startTime && (
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Clock className="size-3" />
            {match.startTime}
          </div>
        )}
      </div>

      {/* Teams */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div className="text-sm font-semibold truncate">{match.homeTeam}</div>
        <div className={cn(
          'font-mono text-lg font-bold tracking-widest px-3 py-1 rounded-lg',
          isLive ? 'bg-live/10 text-foreground' : 'bg-secondary text-muted-foreground'
        )}>
          {isUpcoming
            ? 'VS'
            : `${match.homeScore} - ${match.awayScore}`}
        </div>
        <div className="text-sm font-semibold truncate text-right">{match.awayTeam}</div>
      </div>

      {/* Predict button */}
      {onPredict && (
        <button
          onClick={() => onPredict(match.homeTeam, match.awayTeam, match.league)}
          className="flex items-center justify-center gap-1.5 text-[11px] font-medium text-primary hover:text-primary/80 transition-colors border-t border-border pt-2.5"
        >
          <Zap className="size-3" />
          Analizar con IA
        </button>
      )}
    </div>
  )
}
