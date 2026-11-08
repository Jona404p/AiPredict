'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { getLeagues, type League, type LeagueGroup } from '@/lib/api-client'

interface LeagueSelectorProps {
  selectedLeague: League | null
  onLeagueChange: (league: League | null) => void
  homeTeam: string
  awayTeam: string
  onHomeTeamChange: (v: string) => void
  onAwayTeamChange: (v: string) => void
  onPredict: () => void
  predicting: boolean
}

export default function LeagueSelector({
  selectedLeague,
  onLeagueChange,
  homeTeam,
  awayTeam,
  onHomeTeamChange,
  onAwayTeamChange,
  onPredict,
  predicting,
}: LeagueSelectorProps) {
  const [groups, setGroups] = useState<LeagueGroup[]>([])
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    getLeagues()
      .then(setGroups)
      .catch(() => {})
  }, [])

  const filtered = groups
    .map((g) => ({
      ...g,
      leagues: g.leagues.filter(
        (l) =>
          l.name.toLowerCase().includes(search.toLowerCase()) ||
          l.country.toLowerCase().includes(search.toLowerCase())
      ),
    }))
    .filter((g) => g.leagues.length > 0)

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Nueva Prediccion
      </h3>

      {/* League picker */}
      <div className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between bg-secondary border border-border rounded-lg px-3 py-2 text-sm hover:border-primary/50 transition-colors"
        >
          <span className={selectedLeague ? 'text-foreground' : 'text-muted-foreground'}>
            {selectedLeague ? (
              <span className="flex items-center gap-2">
                {selectedLeague.flag && <span>{selectedLeague.flag}</span>}
                {selectedLeague.name}
              </span>
            ) : (
              'Seleccionar liga...'
            )}
          </span>
          <ChevronDown className={cn('w-4 h-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
        </button>

        {open && (
          <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-popover border border-border rounded-lg shadow-xl overflow-hidden">
            <div className="p-2 border-b border-border">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar liga..."
                  className="pl-8 h-8 text-xs bg-secondary border-border"
                  autoFocus
                />
              </div>
            </div>
            <div className="max-h-52 overflow-y-auto">
              {filtered.map((group) => (
                <div key={group.name}>
                  <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground bg-background/60 sticky top-0">
                    {group.name}
                  </p>
                  {group.leagues.map((league) => (
                    <button
                      key={league.id}
                      onClick={() => {
                        onLeagueChange(league)
                        setOpen(false)
                        setSearch('')
                      }}
                      className={cn(
                        'w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-secondary transition-colors text-left',
                        selectedLeague?.id === league.id && 'bg-primary/10 text-primary'
                      )}
                    >
                      {league.flag && <span className="text-base">{league.flag}</span>}
                      <span className="flex-1 truncate">{league.name}</span>
                      <span className="text-xs text-muted-foreground shrink-0">{league.country}</span>
                    </button>
                  ))}
                </div>
              ))}
              {filtered.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">Sin resultados</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Teams */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-muted-foreground mb-1 block">Local</label>
          <Input
            value={homeTeam}
            onChange={(e) => onHomeTeamChange(e.target.value)}
            placeholder="Equipo local"
            className="h-9 text-sm bg-secondary border-border"
          />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground mb-1 block">Visitante</label>
          <Input
            value={awayTeam}
            onChange={(e) => onAwayTeamChange(e.target.value)}
            placeholder="Equipo visitante"
            className="h-9 text-sm bg-secondary border-border"
          />
        </div>
      </div>

      <Button
        onClick={onPredict}
        disabled={!homeTeam.trim() || !awayTeam.trim() || predicting}
        className="w-full bg-primary hover:bg-primary/90 text-primary-foreground text-sm h-9"
      >
        {predicting ? 'Analizando...' : 'Predecir partido'}
      </Button>

      {selectedLeague && (
        <div className="flex items-center justify-between">
          <Badge variant="outline" className="text-[10px]">
            {selectedLeague.flag} {selectedLeague.name} · {selectedLeague.country}
          </Badge>
          <button
            onClick={() => onLeagueChange(null)}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Limpiar
          </button>
        </div>
      )}
    </div>
  )
}
