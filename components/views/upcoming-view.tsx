'use client'

import { useState, useEffect, useCallback } from 'react'
import { Calendar, RefreshCw, ChevronDown, MapPin, Tag, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { getLeagues, getUpcomingMatches, type League, type LeagueGroup, type UpcomingMatch } from '@/lib/api-client'

interface UpcomingViewProps {
  onPredictMatch?: (home: string, away: string, league: string) => void
}

export default function UpcomingView({ onPredictMatch }: UpcomingViewProps) {
  const [groups, setGroups] = useState<LeagueGroup[]>([])
  const [selectedLeague, setSelectedLeague] = useState<League | null>(null)
  const [matches, setMatches] = useState<UpcomingMatch[]>([])
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

  const loadMatches = useCallback(async (leagueId: string) => {
    setLoading(true)
    setMatches([])
    try {
      const res = await fetch(`/api/upcoming?league=${encodeURIComponent(leagueId)}`)
      const data = await res.json()
      setMatches(data.matches ?? data ?? [])
      setIsDemo(!!data.demo)
    } catch {
      setMatches([])
    } finally {
      setLoading(false)
    }
  }, [])

  const handleLeagueSelect = (league: League) => {
    setSelectedLeague(league)
    setLeagueOpen(false)
    loadMatches(league.id)
  }

  // Group matches by date
  const groupedByDate = matches.reduce<Record<string, UpcomingMatch[]>>((acc, m) => {
    if (!acc[m.date]) acc[m.date] = []
    acc[m.date].push(m)
    return acc
  }, {})

  return (
    <div className="flex flex-col gap-5 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold tracking-tight">Proximos Partidos</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Selecciona una liga para ver el calendario
          </p>
        </div>
        {selectedLeague && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => selectedLeague && loadMatches(selectedLeague.id)}
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

      {/* Demo badge */}
      {isDemo && (
        <Badge variant="outline" className="self-start text-[10px] border-draw/40 text-draw">
          Datos de demo — conecta el backend para datos reales
        </Badge>
      )}

      {/* Match list */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <RefreshCw className="size-6 text-muted-foreground animate-spin" />
        </div>
      )}

      {!loading && !selectedLeague && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <div className="size-12 rounded-full bg-secondary flex items-center justify-center">
            <Calendar className="size-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">Selecciona una liga</p>
          <p className="text-xs text-muted-foreground max-w-xs leading-relaxed">
            Elige una liga del selector para ver los proximos partidos programados
          </p>
        </div>
      )}

      {!loading && selectedLeague && matches.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <div className="size-12 rounded-full bg-secondary flex items-center justify-center">
            <Calendar className="size-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">Sin partidos proximos</p>
          <p className="text-xs text-muted-foreground">No hay partidos programados para esta liga</p>
        </div>
      )}

      {!loading && Object.entries(groupedByDate).map(([date, dayMatches]) => (
        <div key={date}>
          {/* Date divider */}
          <div className="flex items-center gap-3 mb-3">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              {date}
            </span>
            <div className="flex-1 h-px bg-border" />
            <span className="text-[10px] text-muted-foreground">{dayMatches.length} partidos</span>
          </div>

          <div className="flex flex-col gap-2">
            {dayMatches.map((match) => (
              <UpcomingMatchCard
                key={match.id}
                match={match}
                onPredict={onPredictMatch}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function UpcomingMatchCard({
  match,
  onPredict,
}: {
  match: UpcomingMatch
  onPredict?: (home: string, away: string, league: string) => void
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 hover:border-primary/40 transition-colors group">
      {/* Top row: league pill + time */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20 text-[10px] px-2 py-0">
            {match.league}
          </Badge>
          {match.round && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Tag className="size-2.5" />
              {match.round}
            </span>
          )}
        </div>
        <span className="font-mono text-[11px] text-muted-foreground">{match.time}</span>
      </div>

      {/* Teams row */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        {/* Home */}
        <div className="flex items-center gap-2.5">
          <TeamLogo logo={match.homeTeamLogo} name={match.homeTeam} />
          <span className="text-sm font-semibold truncate">{match.homeTeam}</span>
        </div>

        {/* Center VS */}
        <div className="flex flex-col items-center gap-0.5">
          <span className="font-mono text-xs font-bold bg-secondary rounded-md px-3 py-1 text-muted-foreground tracking-widest">
            VS
          </span>
        </div>

        {/* Away */}
        <div className="flex items-center gap-2.5 flex-row-reverse">
          <TeamLogo logo={match.awayTeamLogo} name={match.awayTeam} />
          <span className="text-sm font-semibold truncate text-right">{match.awayTeam}</span>
        </div>
      </div>

      {/* Bottom row: venue + predict button */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          {match.venue && (
            <>
              <MapPin className="size-2.5" />
              <span>{match.venue}</span>
            </>
          )}
        </div>
        {onPredict && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onPredict(match.homeTeam, match.awayTeam, match.league)}
            className="h-7 gap-1.5 text-[11px] text-primary hover:text-primary hover:bg-primary/10"
          >
            <Zap className="size-3" />
            Predecir
          </Button>
        )}
      </div>
    </div>
  )
}

function TeamLogo({ logo, name }: { logo?: string; name: string }) {
  const [errored, setErrored] = useState(false)
  if (!logo || errored) {
    return (
      <div className="size-7 rounded-full bg-secondary border border-border flex items-center justify-center text-[10px] font-bold text-muted-foreground shrink-0">
        {name.charAt(0)}
      </div>
    )
  }
  return (
    <img
      src={logo}
      alt={name}
      className="size-7 rounded-full bg-secondary border border-border object-contain p-0.5 shrink-0"
      onError={() => setErrored(true)}
    />
  )
}
