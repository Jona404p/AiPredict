'use client'

import { useState, useEffect, useRef } from 'react'
import { Brain, Play, Square, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { getLeagues, type League, type LeagueGroup } from '@/lib/api-client'

type TrainStatus = 'idle' | 'running' | 'done' | 'error'

export default function TrainView() {
  const [groups, setGroups] = useState<LeagueGroup[]>([])
  const [selectedLeagues, setSelectedLeagues] = useState<Set<string>>(new Set())
  const [selectedSeasons, setSelectedSeasons] = useState<Set<number>>(new Set([new Date().getFullYear()]))
  const [status, setStatus] = useState<TrainStatus>('idle')
  const [log, setLog] = useState<string[]>(['Esperando inicio del entrenamiento...'])
  const logRef = useRef<HTMLDivElement>(null)

  const currentYear = new Date().getFullYear()
  const seasons = [currentYear, currentYear - 1, currentYear - 2]

  useEffect(() => {
    getLeagues()
      .then(setGroups)
      .catch(() => {})
  }, [])

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [log])

  const allLeagues = groups.flatMap((g) => g.leagues)

  const toggleLeague = (id: string) => {
    setSelectedLeagues((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSeason = (year: number) => {
    setSelectedSeasons((prev) => {
      const next = new Set(prev)
      if (next.has(year)) next.delete(year)
      else next.add(year)
      return next
    })
  }

  const appendLog = (line: string) => {
    setLog((prev) => [...prev, line])
  }

  const startTraining = async () => {
    if (selectedLeagues.size === 0) {
      appendLog('[ERROR] Selecciona al menos una liga para entrenar.')
      return
    }
    if (selectedSeasons.size === 0) {
      appendLog('[ERROR] Selecciona al menos una temporada.')
      return
    }

    setStatus('running')
    setLog([`[${new Date().toLocaleTimeString('es-ES')}] Iniciando entrenamiento...`])

    try {
      const res = await fetch('/api/train', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leagues: [...selectedLeagues],
          seasons: [...selectedSeasons],
        }),
      })

      if (!res.body) {
        const data = await res.json()
        if (data.message) appendLog(data.message)
        if (data.error) {
          appendLog(`[ERROR] ${data.error}`)
          setStatus('error')
        } else {
          setStatus('done')
          appendLog('[OK] Entrenamiento completado.')
        }
        return
      }

      // Streaming
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)
        chunk.split('\n').filter(Boolean).forEach((line) => {
          appendLog(line)
        })
      }
      setStatus('done')
      appendLog(`[${new Date().toLocaleTimeString('es-ES')}] Entrenamiento completado con exito.`)
    } catch (err) {
      appendLog(`[ERROR] El backend no esta disponible. Conecta el servidor Python para entrenar el modelo.`)
      appendLog(`Detalle: ${err instanceof Error ? err.message : String(err)}`)
      setStatus('error')
    }
  }

  const stopTraining = () => {
    setStatus('idle')
    appendLog(`[${new Date().toLocaleTimeString('es-ES')}] Entrenamiento cancelado por el usuario.`)
  }

  return (
    <div className="flex flex-col gap-5 max-w-3xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-lg font-bold tracking-tight">Entrenar Modelo</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Descarga datos historicos y entrena el ensemble de ML (GradientBoosting + RandomForest)
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {/* Config panel */}
        <div className="flex flex-col gap-4">
          {/* Description */}
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-start gap-3">
              <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <Brain className="size-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium mb-1">Sobre el modelo</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  El entrenamiento descarga datos historicos de las ligas seleccionadas,
                  calcula features avanzadas (xG, forma ponderada, H2H, posicion de tabla,
                  SofaScore ratings) y entrena un ensemble de GradientBoosting + RandomForest.
                </p>
              </div>
            </div>
          </div>

          {/* League selection */}
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Ligas
              </label>
              {selectedLeagues.size > 0 && (
                <Badge variant="outline" className="text-[10px] px-1.5">
                  {selectedLeagues.size} seleccionadas
                </Badge>
              )}
            </div>
            <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-1">
              {allLeagues.length === 0 && (
                <p className="text-xs text-muted-foreground py-2">Cargando ligas...</p>
              )}
              {allLeagues.map((league) => (
                <LeagueCheckbox
                  key={league.id}
                  league={league}
                  checked={selectedLeagues.has(league.id)}
                  onChange={() => toggleLeague(league.id)}
                  disabled={status === 'running'}
                />
              ))}
            </div>
          </div>

          {/* Season selection */}
          <div className="bg-card border border-border rounded-xl p-4">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-3 block">
              Temporadas
            </label>
            <div className="flex gap-2">
              {seasons.map((year) => (
                <button
                  key={year}
                  onClick={() => toggleSeason(year)}
                  disabled={status === 'running'}
                  className={cn(
                    'flex-1 py-2 rounded-lg border text-sm font-semibold transition-colors',
                    selectedSeasons.has(year)
                      ? 'bg-primary/10 border-primary/40 text-primary'
                      : 'bg-secondary border-border text-muted-foreground hover:border-primary/30'
                  )}
                >
                  {year}
                </button>
              ))}
            </div>
          </div>

          {/* Action button */}
          {status !== 'running' ? (
            <Button
              onClick={startTraining}
              disabled={selectedLeagues.size === 0}
              className="w-full gap-2 bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              <Play className="size-4" />
              Iniciar Entrenamiento
            </Button>
          ) : (
            <Button
              onClick={stopTraining}
              variant="destructive"
              className="w-full gap-2"
            >
              <Square className="size-4" />
              Cancelar
            </Button>
          )}
        </div>

        {/* Log panel */}
        <div className="flex flex-col bg-card border border-border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Terminal className="size-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Log de Entrenamiento</span>
            </div>
            <StatusBadge status={status} />
          </div>
          <div
            ref={logRef}
            className="flex-1 p-4 font-mono text-[11px] text-primary leading-relaxed overflow-y-auto bg-background min-h-[280px] max-h-[480px]"
          >
            {log.map((line, i) => (
              <div key={i} className={cn(
                'mb-0.5',
                line.startsWith('[ERROR]') && 'text-loss',
                line.startsWith('[OK]') && 'text-win',
                line.startsWith('[WARN]') && 'text-draw',
              )}>
                {line}
              </div>
            ))}
            {status === 'running' && (
              <div className="flex items-center gap-1.5 mt-1 text-primary/60">
                <span className="animate-pulse">_</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function LeagueCheckbox({
  league,
  checked,
  onChange,
  disabled,
}: {
  league: League
  checked: boolean
  onChange: () => void
  disabled: boolean
}) {
  return (
    <label
      className={cn(
        'flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer transition-colors text-sm',
        checked
          ? 'bg-primary/5 border-primary/30 text-foreground'
          : 'bg-secondary border-border text-muted-foreground hover:border-primary/20',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
    >
      <input
        type="checkbox"
        className="accent-primary cursor-pointer size-3.5"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
      />
      {league.flag && <span className="text-base leading-none">{league.flag}</span>}
      <span className="flex-1 truncate">{league.name}</span>
      <span className="text-[10px] text-muted-foreground shrink-0">{league.country}</span>
    </label>
  )
}

function StatusBadge({ status }: { status: TrainStatus }) {
  if (status === 'idle') return null
  if (status === 'running') {
    return (
      <Badge className="bg-draw/20 text-draw border-draw/30 text-[10px] gap-1">
        <span className="size-1.5 rounded-full bg-draw animate-pulse" />
        Entrenando
      </Badge>
    )
  }
  if (status === 'done') {
    return (
      <Badge className="bg-win/20 text-win border-win/30 text-[10px]">
        Completado
      </Badge>
    )
  }
  return (
    <Badge className="bg-loss/20 text-loss border-loss/30 text-[10px]">
      Error
    </Badge>
  )
}
