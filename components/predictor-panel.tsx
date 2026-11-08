'use client'

import useSWR from 'swr'
import { useEffect, useState } from 'react'
import Image from 'next/image'
import { cn } from '@/lib/utils'
import {
  Loader2, Search, ChevronDown, TrendingUp, TrendingDown,
  Shield, Zap, Target, BarChart3, Clock, AlertCircle,
  CheckCircle2, Minus, ArrowUpRight, ArrowDownRight, Activity
} from 'lucide-react'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface League { id: string; name: string; country: string; tier: number; flag: string }
interface LeagueGroup { name: string; leagues: League[] }
interface Team { id: number; name: string; logo: string }
interface PredictorPanelProps {
  initialMatch?: {
    home_team_id?: number
    away_team_id?: number
    league_key?: string
    league?: string
    tournament?: string
    home_team?: string
    away_team?: string
    home_team_logo?: string
    away_team_logo?: string
    home_logo?: string
    away_logo?: string
    homeTeamId?: number
    awayTeamId?: number
    leagueKey?: string
  } | null
  onPredictionReady?: (pred: any) => void
}

export function PredictorPanel({ initialMatch, onPredictionReady }: PredictorPanelProps) {
  const [selectedLeague, setSelectedLeague] = useState<string>(initialMatch?.league_key ?? '')
  const [homeTeamId, setHomeTeamId] = useState<string>(
    initialMatch?.home_team_id?.toString() || initialMatch?.homeTeamId?.toString() || ''
  )
  const [awayTeamId, setAwayTeamId] = useState<string>(
    initialMatch?.away_team_id?.toString() || initialMatch?.awayTeamId?.toString() || ''
  )
  const [isPredicting, setIsPredicting] = useState(false)
  const [prediction, setPrediction] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'markets' | 'stats' | 'scores'>('overview')

  const { data: leagues } = useSWR<LeagueGroup[]>('/api/leagues', fetcher)
  const leagueKey = leagues?.some((group) => group.leagues.some((league) => league.id === selectedLeague)) ? selectedLeague : ''
  const { data: rawTeams, isLoading: teamsLoading } = useSWR<Team[] | { teams: Team[] }>(
    leagueKey ? `/api/teams/${leagueKey}` : null,
    fetcher
  )

  const teams: Team[] = Array.isArray(rawTeams)
    ? rawTeams
    : rawTeams && Array.isArray((rawTeams as any).teams)
    ? (rawTeams as any).teams
    : []

  useEffect(() => {
    if (!initialMatch || !leagues) return

    const candidate = (
      initialMatch.league_key || initialMatch.league || initialMatch.tournament || ''
    ).toString().trim()

    if (!candidate) return

    const normalized = (str: string) => str.toLowerCase().replace(/[^a-z0-9]/g, '')
    const resolved = leagues
      .flatMap((group) => group.leagues)
      .find((league) =>
        normalized(league.id) === normalized(candidate) ||
        normalized(league.name) === normalized(candidate)
      )

    if (resolved) {
      setSelectedLeague(resolved.id)
      return
    }

    if (selectedLeague) {
      setSelectedLeague('')
    }
  }, [initialMatch, leagues, selectedLeague])

  useEffect(() => {
    if (!initialMatch) return

    setHomeTeamId(
      initialMatch.home_team_id?.toString() || initialMatch.homeTeamId?.toString() || ''
    )
    setAwayTeamId(
      initialMatch.away_team_id?.toString() || initialMatch.awayTeamId?.toString() || ''
    )
  }, [initialMatch])

  const homeTeam = teams.find(t => t.id.toString() === homeTeamId)
  const awayTeam = teams.find(t => t.id.toString() === awayTeamId)
  const homeTeamLogo = homeTeam?.logo || initialMatch?.home_team_logo || initialMatch?.home_logo || ''
  const awayTeamLogo = awayTeam?.logo || initialMatch?.away_team_logo || initialMatch?.away_logo || ''
  const groupedLeagues = leagues ?? []

  const runPrediction = async () => {
    if (!selectedLeague || !homeTeamId || !awayTeamId) return
    if (homeTeamId === awayTeamId) { setError('Los equipos deben ser diferentes'); return }
    setIsPredicting(true)
    setError(null)
    setPrediction(null)
    setActiveTab('overview')
    try {
      const res = await fetch('/api/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          home_team_id: parseInt(homeTeamId),
          away_team_id: parseInt(awayTeamId),
          league: selectedLeague,
          home_team_name: homeTeam?.name,
          away_team_name: awayTeam?.name,
        }),
      })
      if (!res.ok) throw new Error('Error al predecir')
      const data = await res.json()
      setPrediction(data)
      onPredictionReady?.(data)
    } catch (e: any) {
      setError(e.message || 'Error desconocido')
    } finally {
      setIsPredicting(false)
    }
  }

  return (
    <div className="space-y-5 animate-fade-up">
      {/* ── Config + Hero Row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* Form Card (2 cols) */}
        <div className="card lg:col-span-2">
          <div className="card-header">
            <span className="card-title">Configurar Partido</span>
          </div>
          <div className="card-body space-y-4">
            {/* League */}
            <div>
              <label className="form-label">Liga</label>
              <div className="relative">
                <select
                  className="field-select"
                  value={selectedLeague}
                  onChange={e => { setSelectedLeague(e.target.value); setHomeTeamId(''); setAwayTeamId(''); setPrediction(null) }}
                >
                  <option value="">Selecciona una liga...</option>
                  {groupedLeagues.map((group) => (
                    <optgroup key={group.name} label={group.name}>
                      {group.leagues.map((l) => (
                        <option key={l.id} value={l.id}>{l.flag} {l.name}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-3 pointer-events-none" />
              </div>
            </div>

            {/* VS Selector */}
            <div className="relative">
              <div className="flex items-center gap-3">
                <div className="flex-1 space-y-1">
                  <label className="form-label">Local</label>
                  <div className="flex items-center gap-2">
                    <TeamBadge team={homeTeam} size="sm" fallbackLogo={homeTeamLogo} />
                    <div className="relative flex-1">
                      <select
                        className="field-select text-sm"
                        value={homeTeamId}
                        onChange={e => setHomeTeamId(e.target.value)}
                        disabled={!teams || teamsLoading}
                      >
                        <option value="">{teamsLoading ? 'Cargando…' : '— Local —'}</option>
                        {teams?.map(t => <option key={t.id} value={t.id.toString()}>{t.name}</option>)}
                      </select>
                      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-3 pointer-events-none" />
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 py-2">
                <div className="flex-1 h-px bg-border" />
                <span className="text-[10px] font-bold text-text-3 uppercase tracking-widest px-2">vs</span>
                <div className="flex-1 h-px bg-border" />
              </div>

              <div className="flex-1 space-y-1">
                <label className="form-label">Visitante</label>
                <div className="flex items-center gap-2">
                  <TeamBadge team={awayTeam} size="sm" fallbackLogo={awayTeamLogo} />
                  <div className="relative flex-1">
                    <select
                      className="field-select text-sm"
                      value={awayTeamId}
                      onChange={e => setAwayTeamId(e.target.value)}
                      disabled={!teams || teamsLoading}
                    >
                      <option value="">{teamsLoading ? 'Cargando…' : '— Visitante —'}</option>
                      {teams?.map(t => <option key={t.id} value={t.id.toString()}>{t.name}</option>)}
                    </select>
                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-3 pointer-events-none" />
                  </div>
                </div>
              </div>
            </div>

            {error && (
              <p className="text-xs text-red-custom bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2 flex items-center gap-2">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                {error}
              </p>
            )}

            <button
              className="btn-predict w-full"
              onClick={runPrediction}
              disabled={isPredicting || !selectedLeague || !homeTeamId || !awayTeamId}
            >
              {isPredicting ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Analizando con IA…</>
              ) : (
                <><Zap className="w-4 h-4" /> Analizar Partido</>
              )}
            </button>
          </div>
        </div>

        {/* Hero Card (3 cols) */}
        <div className="card lg:col-span-3">
          {isPredicting ? (
            <div className="flex flex-col items-center justify-center h-full py-16 gap-5">
              <div className="relative">
                <div className="w-14 h-14 rounded-full border-2 border-accent-green/20 border-t-accent-green animate-spin" />
                <Activity className="absolute inset-0 m-auto w-5 h-5 text-accent-green" />
              </div>
              <div className="text-center space-y-1">
                <p className="text-sm font-semibold text-text">Procesando análisis profundo…</p>
                <p className="text-xs text-text-3">Distribución Poisson · Índices Ataque/Defensa · Forma Reciente</p>
              </div>
            </div>
          ) : prediction ? (
            <PredictionHero prediction={prediction} />
          ) : (
            <div className="flex flex-col items-center justify-center h-full py-16 gap-4 text-center px-6">
              <div className="w-14 h-14 rounded-full bg-accent-green/8 border border-accent-green/20 flex items-center justify-center">
                <BarChart3 className="w-6 h-6 text-accent-green" />
              </div>
              <div className="space-y-1.5">
                <h3 className="font-bold text-text">Predictor Profesional IA</h3>
                <p className="text-sm text-text-2 max-w-xs leading-relaxed">
                  Análisis estadístico avanzado: Poisson, xG, índices de fuerza relativa y 20+ mercados de apuestas.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 justify-center mt-1">
                {['1X2', 'Over/Under', 'BTTS', 'Hándicap', 'Marcador', '1ª Mitad'].map(m => (
                  <span key={m} className="text-[10px] bg-surface-3 border border-border rounded px-2 py-0.5 text-text-3 font-medium">{m}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Detail Section ── */}
      {prediction && (
        <div className="space-y-5 animate-fade-up">
          {/* Tab Nav */}
          <div className="flex gap-1 p-1 bg-surface-2 border border-border rounded-xl w-fit">
            {(['overview', 'markets', 'scores', 'stats'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  'px-4 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all duration-200',
                  activeTab === tab
                    ? 'bg-accent-green text-black shadow-sm'
                    : 'text-text-3 hover:text-text'
                )}
              >
                {tab === 'overview' ? 'Resumen' : tab === 'markets' ? 'Mercados' : tab === 'scores' ? 'Marcadores' : 'Estadísticas'}
              </button>
            ))}
          </div>

          {/* ── OVERVIEW TAB ── */}
          {activeTab === 'overview' && (
            <div className="space-y-5">
              {/* Key Markets Row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <MarketChip
                  label="Over 1.5" value={`${prediction.over_15_prob?.toFixed(0)}%`}
                  prob={prediction.over_15_prob} color="green"
                  sublabel="Goles" icon={<Target className="w-3.5 h-3.5" />}
                />
                <MarketChip
                  label="Over 2.5" value={`${prediction.over_25_prob?.toFixed(0)}%`}
                  prob={prediction.over_25_prob} color={prediction.over_25 ? 'green' : 'gray'}
                  sublabel="Goles" icon={<TrendingUp className="w-3.5 h-3.5" />}
                />
                <MarketChip
                  label="Ambos Marcan" value={`${prediction.btts_prob?.toFixed(0)}%`}
                  prob={prediction.btts_prob} color={prediction.btts ? 'blue' : 'gray'}
                  sublabel="BTTS" icon={<Zap className="w-3.5 h-3.5" />}
                />
                <MarketChip
                  label="Over 3.5" value={`${prediction.over_35_prob?.toFixed(0)}%`}
                  prob={prediction.over_35_prob} color="orange"
                  sublabel="Goles" icon={<Activity className="w-3.5 h-3.5" />}
                />
              </div>

              {/* 1st Half + Special Markets */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                {/* 1st Half */}
                <div className="card">
                  <div className="card-header">
                    <span className="card-title flex items-center gap-2"><Clock className="w-4 h-4 text-text-3" /> 1ª Mitad</span>
                  </div>
                  <div className="card-body space-y-3">
                    <div className="grid grid-cols-3 gap-2">
                      <HtChip label="Local" value={`${prediction.first_half?.home_win?.toFixed(0)}%`} color="green" />
                      <HtChip label="Empate" value={`${prediction.first_half?.draw?.toFixed(0)}%`} color="gray" />
                      <HtChip label="Visitante" value={`${prediction.first_half?.away_win?.toFixed(0)}%`} color="blue" />
                    </div>
                    <div className="h-px bg-border" />
                    <div className="grid grid-cols-2 gap-2">
                      <MiniStat label="Over 0.5 HT" value={`${prediction.first_half?.over_05?.toFixed(1)}%`} color="green" />
                      <MiniStat label="Over 1.5 HT" value={`${prediction.first_half?.over_15_ht?.toFixed(1) ?? (prediction.first_half?.over_05 * 0.48).toFixed(1)}%`} color="gray" />
                    </div>
                  </div>
                </div>

                {/* Corners & Cards */}
                <div className="card">
                  <div className="card-header">
                    <span className="card-title flex items-center gap-2"><Shield className="w-4 h-4 text-text-3" /> Eventos</span>
                  </div>
                  <div className="card-body space-y-3">
                    <ExpandedEventStat
                      label="Corners"
                      total={prediction.expected_corners}
                      home={prediction.home_corners_exp ?? Math.round(prediction.expected_corners * 0.55)}
                      away={prediction.away_corners_exp ?? Math.round(prediction.expected_corners * 0.45)}
                      over={prediction.corners_over_9 ?? Math.round(45 + (prediction.expected_corners - 9) * 8)}
                      color="blue"
                    />
                    <div className="h-px bg-border" />
                    <ExpandedEventStat
                      label="Tarjetas"
                      total={prediction.expected_cards}
                      home={prediction.home_cards_exp ?? Math.round(prediction.expected_cards * 0.5)}
                      away={prediction.away_cards_exp ?? Math.round(prediction.expected_cards * 0.5)}
                      over={prediction.cards_over_4 ?? Math.round(35 + (prediction.expected_cards - 3) * 10)}
                      color="orange"
                    />
                  </div>
                </div>

                {/* xG & Model */}
                <div className="card">
                  <div className="card-header">
                    <span className="card-title flex items-center gap-2"><BarChart3 className="w-4 h-4 text-text-3" /> xG & Modelo</span>
                  </div>
                  <div className="card-body space-y-3">
                    <XgBar
                      homeTeam={prediction.home_team}
                      awayTeam={prediction.away_team}
                      homeLam={prediction.home_lambda}
                      awayLam={prediction.away_lambda}
                    />
                    <div className="h-px bg-border" />
                    <div className="grid grid-cols-2 gap-2">
                      <MiniStat label="Total xG" value={(prediction.home_lambda + prediction.away_lambda).toFixed(2)} />
                      <MiniStat label="Confianza" value={`${prediction.confidence?.toFixed(0)}%`} color={prediction.confidence >= 70 ? 'green' : prediction.confidence >= 55 ? 'blue' : 'orange'} />
                      <MiniStat label="Handicap" value={prediction.handicap_line ?? handicapLine(prediction.home_win_probability, prediction.away_win_probability)} />
                      <MiniStat label="DC Local" value={`${prediction.dc_home?.toFixed(0) ?? (prediction.home_win_probability + prediction.draw_probability).toFixed(0)}%`} />
                    </div>
                  </div>
                </div>
              </div>

              {/* AI Analysis */}
              {prediction.analysis?.length > 0 && (
                <div className="card">
                  <div className="card-header">
                    <span className="card-title flex items-center gap-2">
                      <Zap className="w-4 h-4 text-accent-green" /> Análisis Profesional IA
                    </span>
                    <span className={cn(
                      'tag text-xs',
                      prediction.confidence_label === 'Alta' ? 'tag-green' :
                      prediction.confidence_label === 'Media' ? 'tag-blue' : 'tag-orange'
                    )}>
                      Confianza {prediction.confidence_label}
                    </span>
                  </div>
                  <div className="card-body">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                      {prediction.analysis.map((a: string, i: number) => (
                        <AnalysisItem key={i} text={a} index={i} />
                      ))}
                    </div>
                    {prediction.value_bets && prediction.value_bets.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-border">
                        <p className="text-[10px] text-accent-green uppercase tracking-wider font-bold mb-2">⚡ Value Bets Detectados</p>
                        <div className="flex flex-wrap gap-2">
                          {prediction.value_bets.map((v: string, i: number) => (
                            <span key={i} className="text-xs bg-accent-green/10 border border-accent-green/20 text-accent-green rounded-md px-2.5 py-1 font-medium">{v}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── MARKETS TAB ── */}
          {activeTab === 'markets' && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* Result Markets */}
                <div className="card">
                  <div className="card-header"><span className="card-title">Mercados Resultado</span></div>
                  <div className="card-body space-y-2.5">
                    <MarketRow label="Victoria Local (1)" prob={prediction.home_win_probability} color="green" />
                    <MarketRow label="Empate (X)" prob={prediction.draw_probability} color="gray" />
                    <MarketRow label="Victoria Visitante (2)" prob={prediction.away_win_probability} color="blue" />
                    <div className="h-px bg-border my-1" />
                    <MarketRow label="Doble Oportunidad 1X" prob={prediction.home_win_probability + prediction.draw_probability} color="green" />
                    <MarketRow label="Doble Oportunidad X2" prob={prediction.draw_probability + prediction.away_win_probability} color="blue" />
                    <MarketRow label="Doble Oportunidad 12" prob={prediction.home_win_probability + prediction.away_win_probability} color="orange" />
                  </div>
                </div>

                {/* Goals Markets */}
                <div className="card">
                  <div className="card-header"><span className="card-title">Mercados de Goles</span></div>
                  <div className="card-body space-y-2.5">
                    <MarketRow label="Over 0.5 Goles" prob={prediction.over_05_prob ?? 95} color="green" />
                    <MarketRow label="Over 1.5 Goles" prob={prediction.over_15_prob} color="green" />
                    <MarketRow label="Over 2.5 Goles" prob={prediction.over_25_prob} color={prediction.over_25 ? 'green' : 'gray'} />
                    <MarketRow label="Over 3.5 Goles" prob={prediction.over_35_prob} color="orange" />
                    <MarketRow label="Over 4.5 Goles" prob={prediction.over_45_prob ?? Math.max(5, prediction.over_35_prob - 20)} color="orange" />
                    <div className="h-px bg-border my-1" />
                    <MarketRow label="Ambos Marcan (BTTS)" prob={prediction.btts_prob} color="blue" />
                    <MarketRow label="1T: Ambos Marcan" prob={prediction.btts_ht ?? prediction.btts_prob * 0.35} color="blue" />
                  </div>
                </div>

                {/* 1st Half Markets */}
                <div className="card">
                  <div className="card-header"><span className="card-title">Mercados 1ª Mitad</span></div>
                  <div className="card-body space-y-2.5">
                    <MarketRow label="1T Local Gana" prob={prediction.first_half?.home_win} color="green" />
                    <MarketRow label="1T Empate" prob={prediction.first_half?.draw} color="gray" />
                    <MarketRow label="1T Visitante Gana" prob={prediction.first_half?.away_win} color="blue" />
                    <div className="h-px bg-border my-1" />
                    <MarketRow label="1T Over 0.5" prob={prediction.first_half?.over_05} color="green" />
                    <MarketRow label="1T Over 1.5" prob={prediction.first_half?.over_15_ht ?? prediction.first_half?.over_05 * 0.45} color="orange" />
                  </div>
                </div>

                {/* Special Markets */}
                <div className="card">
                  <div className="card-header"><span className="card-title">Mercados Especiales</span></div>
                  <div className="card-body space-y-2.5">
                    <MarketRow label="Corners Over 8.5" prob={prediction.corners_over_8 ?? Math.round(35 + (prediction.expected_corners - 8) * 9)} color="blue" />
                    <MarketRow label="Corners Over 9.5" prob={prediction.corners_over_9 ?? Math.round(30 + (prediction.expected_corners - 9) * 8)} color="blue" />
                    <MarketRow label="Tarjetas Over 3.5" prob={prediction.cards_over_3 ?? Math.round(45 + (prediction.expected_cards - 3) * 12)} color="orange" />
                    <MarketRow label="Tarjetas Over 4.5" prob={prediction.cards_over_4 ?? Math.round(30 + (prediction.expected_cards - 3) * 10)} color="orange" />
                    <div className="h-px bg-border my-1" />
                    <MarketRow label="Gana en 90 min + OT" prob={prediction.home_win_probability * 1.05} color="green" />
                    <MarketRow label="Local Marca Primero" prob={prediction.home_score_first ?? Math.round(prediction.home_win_probability * 1.1)} color="green" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── SCORES TAB ── */}
          {activeTab === 'scores' && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div className="card">
                  <div className="card-header"><span className="card-title">Top 12 Marcadores Más Probables</span></div>
                  <div className="card-body">
                    <div className="grid grid-cols-3 gap-2.5">
                      {prediction.top_scores?.slice(0, 12).map((s: any, i: number) => (
                        <ScoreChipLarge key={i} score={s} rank={i} />
                      ))}
                    </div>
                  </div>
                </div>

                <div className="card">
                  <div className="card-header"><span className="card-title">Distribución por Categoría</span></div>
                  <div className="card-body space-y-3">
                    <ScoreCategoryBar
                      label="Local gana"
                      prob={prediction.home_win_probability}
                      scores={prediction.top_scores?.filter((s: any) => s.home > s.away).slice(0, 3)}
                      color="green"
                    />
                    <ScoreCategoryBar
                      label="Empate"
                      prob={prediction.draw_probability}
                      scores={prediction.top_scores?.filter((s: any) => s.home === s.away).slice(0, 3)}
                      color="gray"
                    />
                    <ScoreCategoryBar
                      label="Visitante gana"
                      prob={prediction.away_win_probability}
                      scores={prediction.top_scores?.filter((s: any) => s.home < s.away).slice(0, 3)}
                      color="blue"
                    />
                    <div className="pt-2 border-t border-border space-y-2">
                      <p className="text-[10px] text-text-3 uppercase tracking-wider font-bold">Parámetros del Modelo</p>
                      <div className="grid grid-cols-2 gap-2">
                        <MiniStat label={`λ ${prediction.home_team?.split(' ')[0]}`} value={prediction.home_lambda?.toFixed(3)} color="green" />
                        <MiniStat label={`λ ${prediction.away_team?.split(' ')[0]}`} value={prediction.away_lambda?.toFixed(3)} color="blue" />
                        <MiniStat label="Total xG" value={(prediction.home_lambda + prediction.away_lambda).toFixed(2)} />
                        <MiniStat label="Ventaja Casa" value="+8%" color="green" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── STATS TAB ── */}
          {activeTab === 'stats' && prediction.home_stats && prediction.away_stats && (
            <div className="space-y-5">
              {/* Team Comparison */}
              <div className="card">
                <div className="card-header">
                  <span className="card-title">Comparación de Equipos</span>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="flex items-center gap-1.5 text-accent-green font-semibold">
                      <span className="w-2 h-2 rounded-full bg-accent-green" />{prediction.home_team}
                    </span>
                    <span className="flex items-center gap-1.5 text-blue-custom font-semibold">
                      <span className="w-2 h-2 rounded-full bg-blue-custom" />{prediction.away_team}
                    </span>
                  </div>
                </div>
                <div className="card-body space-y-1">
                  <StatRow label="Posición en Liga" homeVal={`#${prediction.home_stats.position}`} awayVal={`#${prediction.away_stats.position}`} homeRaw={-prediction.home_stats.position} awayRaw={-prediction.away_stats.position} />
                  <StatRow label="Puntos" homeVal={prediction.home_stats.points} awayVal={prediction.away_stats.points} homeRaw={prediction.home_stats.points} awayRaw={prediction.away_stats.points} />
                  <StatRow label="Partidos Jugados" homeVal={prediction.home_stats.played} awayVal={prediction.away_stats.played} homeRaw={prediction.home_stats.played} awayRaw={prediction.away_stats.played} />
                  <StatRow label="Victorias" homeVal={prediction.home_stats.won} awayVal={prediction.away_stats.won} homeRaw={prediction.home_stats.won} awayRaw={prediction.away_stats.won} />
                  <StatRow label="Empates" homeVal={prediction.home_stats.draw} awayVal={prediction.away_stats.draw} homeRaw={prediction.home_stats.draw} awayRaw={prediction.away_stats.draw} neutral />
                  <StatRow label="Derrotas" homeVal={prediction.home_stats.lost} awayVal={prediction.away_stats.lost} homeRaw={-prediction.home_stats.lost} awayRaw={-prediction.away_stats.lost} />
                  <StatRow label="Goles a Favor" homeVal={prediction.home_stats.goals_for} awayVal={prediction.away_stats.goals_for} homeRaw={prediction.home_stats.goals_for} awayRaw={prediction.away_stats.goals_for} />
                  <StatRow label="Goles en Contra" homeVal={prediction.home_stats.goals_against} awayVal={prediction.away_stats.goals_against} homeRaw={-prediction.home_stats.goals_against} awayRaw={-prediction.away_stats.goals_against} />
                  <StatRow label="Diferencia de Goles" homeVal={dgStr(prediction.home_stats)} awayVal={dgStr(prediction.away_stats)} homeRaw={prediction.home_stats.goals_for - prediction.home_stats.goals_against} awayRaw={prediction.away_stats.goals_for - prediction.away_stats.goals_against} />
                  <StatRow label="Puntos por Partido" homeVal={(prediction.home_stats.points / prediction.home_stats.played).toFixed(2)} awayVal={(prediction.away_stats.points / prediction.away_stats.played).toFixed(2)} homeRaw={prediction.home_stats.points / prediction.home_stats.played} awayRaw={prediction.away_stats.points / prediction.away_stats.played} />
                  <StatRow label="Índice Ataque (rel.)" homeVal={prediction.home_stats.attack_strength?.toFixed(3)} awayVal={prediction.away_stats.attack_strength?.toFixed(3)} homeRaw={prediction.home_stats.attack_strength} awayRaw={prediction.away_stats.attack_strength} />
                  <StatRow label="Índice Defensa (rel.)" homeVal={prediction.home_stats.defence_strength?.toFixed(3)} awayVal={prediction.away_stats.defence_strength?.toFixed(3)} homeRaw={-prediction.home_stats.defence_strength} awayRaw={-prediction.away_stats.defence_strength} noLast />
                </div>
              </div>

              {/* Team Form Indicator */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <FormCard team={prediction.home_team} stats={prediction.home_stats} lambda={prediction.home_lambda} color="green" />
                <FormCard team={prediction.away_team} stats={prediction.away_stats} lambda={prediction.away_lambda} color="blue" />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dgStr(s: any) {
  const d = s.goals_for - s.goals_against
  return d > 0 ? `+${d}` : `${d}`
}

function handicapLine(hw: number, aw: number): string {
  const diff = hw - aw
  if (diff > 25) return '-0.75'
  if (diff > 15) return '-0.5'
  if (diff > 5) return '-0.25'
  if (diff < -25) return '+0.75'
  if (diff < -15) return '+0.5'
  if (diff < -5) return '+0.25'
  return '0'
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TeamBadge({ team, size = 'md', fallbackLogo }: { team?: Team; size?: 'sm' | 'md'; fallbackLogo?: string }) {
  const sz = size === 'sm' ? 'w-8 h-8' : 'w-10 h-10'
  const logo = team?.logo || fallbackLogo
  return (
    <div className={cn('rounded-full bg-surface-3 border border-border-2 flex items-center justify-center overflow-hidden flex-shrink-0', sz)}>
      {logo ? (
        <Image src={logo} alt={team?.name || 'Equipo'} width={size === 'sm' ? 24 : 32} height={size === 'sm' ? 24 : 32} className="object-contain p-0.5"
          onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
      ) : (
        <div className="w-3 h-3 rounded-full bg-border-2 opacity-40" />
      )}
    </div>
  )
}

function PredictionHero({ prediction }: { prediction: any }) {
  const hw = prediction.home_win_probability
  const dw = prediction.draw_probability
  const aw = prediction.away_win_probability
  const winner = prediction.predicted_result

  return (
    <>
      <div className="card-header">
        <span className="card-title">Predicción IA</span>
        <span className={cn(
          'tag text-xs',
          prediction.confidence_label === 'Alta' ? 'tag-green' :
          prediction.confidence_label === 'Media' ? 'tag-blue' : 'tag-orange'
        )}>
          Confianza {prediction.confidence_label}
        </span>
      </div>
      {/* Teams */}
      <div className="pred-hero">
        <div className="pred-team">
          <div className="w-16 h-16 rounded-full bg-surface-3 border border-border-2 overflow-hidden p-1.5 flex-shrink-0">
            {prediction.home_team_logo && (
              <Image src={prediction.home_team_logo} alt={prediction.home_team} width={52} height={52} className="object-contain"
                onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
            )}
          </div>
          <span className="font-bold text-sm text-center leading-tight">{prediction.home_team}</span>
          <span className={cn('font-mono text-3xl font-bold', hw > aw ? 'text-accent-green' : 'text-text-2')}>
            {hw.toFixed(1)}%
          </span>
          {winner === 'home' && (
            <span className="winner-badge flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> FAVORITO
            </span>
          )}
        </div>

        <div className="vs-divider">
          <span className="font-bold text-text-3 text-lg tracking-widest">VS</span>
          <div className="text-center">
            <span className="font-mono text-3xl font-bold text-text">{prediction.predicted_home_goals}-{prediction.predicted_away_goals}</span>
            <p className="text-[10px] text-text-3 uppercase tracking-wider mt-0.5">Marcador esp.</p>
          </div>
          {dw >= hw && dw >= aw && <span className="winner-badge bg-border-2 text-text-2 border-border">EMPATE PROBABLE</span>}
          {/* λ indicators */}
          <div className="flex gap-3 text-[10px] text-text-3">
            <span>λ {prediction.home_lambda?.toFixed(2)}</span>
            <span>λ {prediction.away_lambda?.toFixed(2)}</span>
          </div>
        </div>

        <div className="pred-team">
          <div className="w-16 h-16 rounded-full bg-surface-3 border border-border-2 overflow-hidden p-1.5 flex-shrink-0">
            {prediction.away_team_logo && (
              <Image src={prediction.away_team_logo} alt={prediction.away_team} width={52} height={52} className="object-contain"
                onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
            )}
          </div>
          <span className="font-bold text-sm text-center leading-tight">{prediction.away_team}</span>
          <span className={cn('font-mono text-3xl font-bold', aw > hw ? 'text-blue-custom' : 'text-text-2')}>
            {aw.toFixed(1)}%
          </span>
          {winner === 'away' && (
            <span className="winner-badge bg-blue-custom/20 text-blue-custom border-blue-custom/30 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> FAVORITO
            </span>
          )}
        </div>
      </div>

      {/* Prob bars */}
      <div className="px-5 pb-5 space-y-2">
        <ProbBar label={prediction.home_team} value={hw} color="green" />
        <ProbBar label="Empate" value={dw} color="gray" />
        <ProbBar label={prediction.away_team} value={aw} color="blue" />
      </div>
    </>
  )
}

function ProbBar({ label, value, color }: { label: string; value: number; color: 'green' | 'gray' | 'blue' }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-text-2 w-24 truncate flex-shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-surface-3 rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-1000',
            color === 'green' ? 'bg-accent-green' : color === 'blue' ? 'bg-blue-custom' : 'bg-border-2'
          )}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="font-mono text-xs font-semibold w-12 text-right text-text">{value.toFixed(1)}%</span>
    </div>
  )
}

function MarketRow({ label, prob, color }: { label: string; prob: number; color: 'green' | 'blue' | 'orange' | 'gray' }) {
  const clampedProb = Math.min(Math.max(prob || 0, 0), 100)
  const colorMap = {
    green: 'text-accent-green bg-accent-green',
    blue: 'text-blue-custom bg-blue-custom',
    orange: 'text-orange-custom bg-orange-custom',
    gray: 'text-text-2 bg-border-2',
  }
  const c = colorMap[color]
  const isHigh = clampedProb >= 65
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="text-xs text-text-2 flex-1 min-w-0 truncate">{label}</span>
      <div className="flex items-center gap-2">
        <div className="w-24 h-1 bg-surface-3 rounded-full overflow-hidden">
          <div className={cn('h-full rounded-full', c.split(' ')[1])} style={{ width: `${clampedProb}%` }} />
        </div>
        <span className={cn('font-mono text-xs font-bold w-10 text-right', isHigh ? c.split(' ')[0] : 'text-text-2')}>
          {clampedProb.toFixed(0)}%
        </span>
        {isHigh && <CheckCircle2 className={cn('w-3.5 h-3.5 flex-shrink-0', c.split(' ')[0])} />}
        {!isHigh && <Minus className="w-3.5 h-3.5 flex-shrink-0 text-text-3" />}
      </div>
    </div>
  )
}

function MarketChip({ label, value, prob, color, sublabel, icon }: {
  label: string; value: string; prob: number; color: 'green' | 'blue' | 'orange' | 'gray'
  sublabel?: string; icon?: React.ReactNode
}) {
  const colorMap = {
    green: { border: 'border-accent-green/30 bg-accent-green/5', bar: 'bg-accent-green', text: 'text-accent-green', icon: 'text-accent-green/60' },
    blue: { border: 'border-blue-custom/30 bg-blue-custom/5', bar: 'bg-blue-custom', text: 'text-blue-custom', icon: 'text-blue-custom/60' },
    orange: { border: 'border-orange-custom/30 bg-orange-custom/5', bar: 'bg-orange-custom', text: 'text-orange-custom', icon: 'text-orange-custom/60' },
    gray: { border: 'border-border-2', bar: 'bg-border-2', text: 'text-text-2', icon: 'text-text-3' },
  }
  const c = colorMap[color]
  const isHigh = prob >= 60
  return (
    <div className={cn('bg-surface-2 border rounded-xl p-4 space-y-2.5 relative overflow-hidden', c.border)}>
      {isHigh && <div className={cn('absolute inset-0 opacity-[0.03]', c.bar)} />}
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-text-3 uppercase tracking-wider font-bold">{label}</p>
        <span className={cn(c.icon)}>{icon}</span>
      </div>
      <p className={cn('font-mono text-2xl font-bold', c.text)}>{value}</p>
      {sublabel && <p className="text-[10px] text-text-3">{sublabel}</p>}
      <div className="h-0.5 bg-surface-3 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all duration-1000', c.bar)} style={{ width: `${Math.min(prob, 100)}%` }} />
      </div>
    </div>
  )
}

function HtChip({ label, value, color }: { label: string; value: string; color: 'green' | 'blue' | 'gray' }) {
  const colorMap = {
    green: 'text-accent-green',
    blue: 'text-blue-custom',
    gray: 'text-text-2',
  }
  return (
    <div className="bg-surface-3 border border-border rounded-lg p-2.5 text-center">
      <p className="text-[10px] text-text-3 uppercase tracking-wider font-bold">{label}</p>
      <p className={cn('font-mono text-lg font-bold mt-0.5', colorMap[color])}>{value}</p>
    </div>
  )
}

function MiniStat({ label, value, color }: { label: string; value: any; color?: 'green' | 'blue' | 'orange' | 'gray' }) {
  const colorMap = {
    green: 'text-accent-green',
    blue: 'text-blue-custom',
    orange: 'text-orange-custom',
    gray: 'text-text-2',
  }
  return (
    <div className="bg-surface-3 border border-border rounded-lg p-2.5">
      <p className="text-[10px] text-text-3 uppercase tracking-wider font-bold leading-tight">{label}</p>
      <p className={cn('font-mono text-base font-bold mt-0.5', color ? colorMap[color] : 'text-text')}>{value}</p>
    </div>
  )
}

function XgBar({ homeTeam, awayTeam, homeLam, awayLam }: { homeTeam: string; awayTeam: string; homeLam: number; awayLam: number }) {
  const total = homeLam + awayLam
  const homeW = (homeLam / total) * 100
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-[10px] text-text-3 font-medium">
        <span className="text-accent-green">{homeTeam?.split(' ')[0]}</span>
        <span>xG esperado</span>
        <span className="text-blue-custom">{awayTeam?.split(' ')[0]}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm font-bold text-accent-green w-8 text-right">{homeLam?.toFixed(2)}</span>
        <div className="flex-1 flex h-2 rounded-full overflow-hidden gap-0.5">
          <div className="bg-accent-green rounded-l-full" style={{ width: `${homeW}%` }} />
          <div className="bg-blue-custom rounded-r-full" style={{ width: `${100 - homeW}%` }} />
        </div>
        <span className="font-mono text-sm font-bold text-blue-custom w-8">{awayLam?.toFixed(2)}</span>
      </div>
    </div>
  )
}

function ExpandedEventStat({ label, total, home, away, over, color }: {
  label: string; total: number; home: number; away: number; over: number; color: 'blue' | 'orange'
}) {
  const colorMap = {
    blue: 'text-blue-custom',
    orange: 'text-orange-custom',
  }
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-text-3 uppercase tracking-wider font-bold">{label}</p>
        <span className={cn('font-mono text-lg font-bold', colorMap[color])}>~{total}</span>
      </div>
      <div className="grid grid-cols-3 gap-1.5 text-center">
        <div className="bg-surface-3/60 rounded px-2 py-1">
          <p className="text-[9px] text-text-3">Local</p>
          <p className="font-mono text-xs font-bold text-text">~{home}</p>
        </div>
        <div className="bg-surface-3/60 rounded px-2 py-1">
          <p className="text-[9px] text-text-3">Visitante</p>
          <p className="font-mono text-xs font-bold text-text">~{away}</p>
        </div>
        <div className="bg-surface-3/60 rounded px-2 py-1">
          <p className="text-[9px] text-text-3">Over {total - 1}.5</p>
          <p className={cn('font-mono text-xs font-bold', colorMap[color])}>{over}%</p>
        </div>
      </div>
    </div>
  )
}

function ScoreChipLarge({ score, rank }: { score: any; rank: number }) {
  const isTop = rank === 0
  const isSecond = rank === 1
  return (
    <div className={cn(
      'rounded-xl border p-3 text-center space-y-1 transition-all',
      isTop ? 'border-accent-green/40 bg-accent-green/8 shadow-[0_0_12px_rgba(0,229,160,0.1)]' :
      isSecond ? 'border-border-2 bg-surface-3' : 'border-border bg-surface-2'
    )}>
      <div className={cn('text-[9px] font-bold uppercase tracking-wider', isTop ? 'text-accent-green' : 'text-text-3')}>
        {rank === 0 ? '🥇 1º' : rank === 1 ? '🥈 2º' : rank === 2 ? '🥉 3º' : `${rank + 1}º`}
      </div>
      <div className={cn('font-mono text-xl font-bold', isTop ? 'text-text' : 'text-text-2')}>
        {score.home}–{score.away}
      </div>
      <div className={cn('font-mono text-xs font-semibold', isTop ? 'text-accent-green' : 'text-text-3')}>
        {score.prob.toFixed(1)}%
      </div>
    </div>
  )
}

function ScoreCategoryBar({ label, prob, scores, color }: {
  label: string; prob: number; scores: any[]; color: 'green' | 'gray' | 'blue'
}) {
  const colorMap = {
    green: { bar: 'bg-accent-green', text: 'text-accent-green' },
    gray: { bar: 'bg-border-2', text: 'text-text-2' },
    blue: { bar: 'bg-blue-custom', text: 'text-blue-custom' },
  }
  const c = colorMap[color]
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-2 font-medium">{label}</span>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {scores?.slice(0, 3).map((s: any, i: number) => (
              <span key={i} className="text-[10px] font-mono bg-surface-3 rounded px-1.5 py-0.5 text-text-3">{s.home}-{s.away}</span>
            ))}
          </div>
          <span className={cn('font-mono text-sm font-bold w-12 text-right', c.text)}>{prob?.toFixed(1)}%</span>
        </div>
      </div>
      <div className="h-1.5 bg-surface-3 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all duration-1000', c.bar)} style={{ width: `${prob}%` }} />
      </div>
    </div>
  )
}

function AnalysisItem({ text, index }: { text: string; index: number }) {
  const icons = [TrendingUp, Shield, Target, BarChart3, Activity, AlertCircle, CheckCircle2, Zap]
  const Icon = icons[index % icons.length]
  return (
    <div className="flex items-start gap-2.5 p-3 bg-surface-3/50 border border-border/60 rounded-lg">
      <div className="w-6 h-6 rounded-md bg-accent-green/10 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Icon className="w-3.5 h-3.5 text-accent-green" />
      </div>
      <p className="text-sm text-text-2 leading-relaxed">{text}</p>
    </div>
  )
}

function FormCard({ team, stats, lambda, color }: { team: string; stats: any; lambda: number; color: 'green' | 'blue' }) {
  const ppg = stats.points / stats.played
  const gfPG = stats.goals_for / stats.played
  const gaPG = stats.goals_against / stats.played
  const wr = (stats.won / stats.played) * 100
  const colorCls = color === 'green' ? 'text-accent-green border-accent-green/20 bg-accent-green/5' : 'text-blue-custom border-blue-custom/20 bg-blue-custom/5'

  return (
    <div className={cn('card border', colorCls)}>
      <div className="card-header">
        <span className="card-title text-sm">{team}</span>
        <span className={cn('text-xs font-mono font-bold', color === 'green' ? 'text-accent-green' : 'text-blue-custom')}>
          λ {lambda?.toFixed(2)}
        </span>
      </div>
      <div className="card-body grid grid-cols-3 gap-3">
        <div className="text-center">
          <p className="text-[10px] text-text-3 uppercase font-bold">PPP</p>
          <p className={cn('font-mono text-xl font-bold', color === 'green' ? 'text-accent-green' : 'text-blue-custom')}>{ppg.toFixed(2)}</p>
          <p className="text-[10px] text-text-3">pts/partido</p>
        </div>
        <div className="text-center">
          <p className="text-[10px] text-text-3 uppercase font-bold">GF/P</p>
          <p className="font-mono text-xl font-bold text-text">{gfPG.toFixed(2)}</p>
          <p className="text-[10px] text-text-3">goles/partido</p>
        </div>
        <div className="text-center">
          <p className="text-[10px] text-text-3 uppercase font-bold">% VIC</p>
          <p className="font-mono text-xl font-bold text-text">{wr.toFixed(0)}%</p>
          <p className="text-[10px] text-text-3">victorias</p>
        </div>
        <div className="col-span-3 grid grid-cols-3 gap-2 pt-1 border-t border-border/40">
          <div className="text-center">
            <p className="text-xs text-accent-green font-bold">{stats.won}V</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-text-2 font-bold">{stats.draw}E</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-red-custom font-bold">{stats.lost}D</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatRow({ label, homeVal, awayVal, homeRaw, awayRaw, noLast, neutral }: {
  label: string; homeVal: any; awayVal: any; homeRaw: number; awayRaw: number; noLast?: boolean; neutral?: boolean
}) {
  const total = Math.abs(homeRaw) + Math.abs(awayRaw)
  const homeW = total > 0 ? (Math.abs(homeRaw) / total) * 100 : 50
  const homeBetter = homeRaw >= awayRaw
  return (
    <div className={cn('grid grid-cols-3 items-center gap-3 py-2.5', !noLast && 'border-b border-border/50')}>
      <span className={cn('font-mono text-sm font-semibold text-right',
        neutral ? 'text-text' : homeBetter ? 'text-accent-green' : 'text-text-2'
      )}>{homeVal}</span>
      <div className="flex flex-col items-center gap-1.5">
        <span className="text-[10px] text-text-3 uppercase tracking-wider text-center leading-tight">{label}</span>
        {!neutral && (
          <div className="flex w-full h-1 rounded-full overflow-hidden gap-0.5">
            <div className="bg-accent-green rounded-l-full" style={{ width: `${homeW}%` }} />
            <div className="bg-blue-custom rounded-r-full" style={{ width: `${100 - homeW}%` }} />
          </div>
        )}
      </div>
      <span className={cn('font-mono text-sm font-semibold',
        neutral ? 'text-text' : !homeBetter ? 'text-blue-custom' : 'text-text-2'
      )}>{awayVal}</span>
    </div>
  )
}

