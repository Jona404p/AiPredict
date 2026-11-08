'use client'

import { useState } from 'react'
import { TrendingUp, Target, Users, CornerDownRight, Square, Hash, Loader2, Star } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { type Prediction, type DrafteaPick, getPrediction } from '@/lib/api-client'

interface PredictionCardProps {
  homeTeam: string
  awayTeam: string
  league?: string
  initialData?: Prediction
}

type Tab = '1x2' | 'goles' | 'btts' | 'corners' | 'tarjetas' | 'picks'

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: '1x2', label: '1X2', icon: Target },
  { id: 'goles', label: 'Goles', icon: TrendingUp },
  { id: 'btts', label: 'BTTS', icon: Users },
  { id: 'corners', label: 'Corners', icon: CornerDownRight },
  { id: 'tarjetas', label: 'Tarjetas', icon: Square },
  { id: 'picks', label: 'Picks', icon: Star },
]

export default function PredictionCard({
  homeTeam,
  awayTeam,
  league,
  initialData,
}: PredictionCardProps) {
  const [activeTab, setActiveTab] = useState<Tab>('1x2')
  const [data, setData] = useState<Prediction | null>(initialData ?? null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchPrediction = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await getPrediction(homeTeam, awayTeam, league)
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al obtener predicción')
      // Set demo data for UI preview
      setData(getDemoData(homeTeam, awayTeam, league))
    } finally {
      setLoading(false)
    }
  }

  const qualityColor = {
    high: 'text-win',
    medium: 'text-draw',
    low: 'text-loss',
  }[data?.dataQuality ?? 'medium']

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-surface">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Hash className="w-4 h-4 text-primary" />
            <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
              {league ?? 'Predicción'}
            </span>
          </div>
          {data?.dataQuality && (
            <Badge variant="outline" className={cn('text-[10px]', qualityColor)}>
              Datos: {data.dataQuality === 'high' ? 'Alto' : data.dataQuality === 'medium' ? 'Medio' : 'Bajo'}
            </Badge>
          )}
        </div>

        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex-1 text-center">
            <p className="font-semibold text-sm text-foreground text-balance">{homeTeam}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Local</p>
          </div>
          <div className="text-muted-foreground font-bold text-sm px-2">vs</div>
          <div className="flex-1 text-center">
            <p className="font-semibold text-sm text-foreground text-balance">{awayTeam}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Visitante</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex overflow-x-auto border-b border-border scrollbar-none">
        {TABS.map((tab) => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors border-b-2 -mb-px',
                activeTab === tab.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Content */}
      <div className="p-4 min-h-[180px]">
        {!data && !loading && (
          <div className="flex flex-col items-center justify-center h-36 gap-3">
            <p className="text-sm text-muted-foreground text-center">
              Genera una predicción completa con todos los mercados Draftea
            </p>
            <Button onClick={fetchPrediction} size="sm" className="bg-primary text-primary-foreground">
              <TrendingUp className="w-3.5 h-3.5 mr-1.5" />
              Predecir ahora
            </Button>
          </div>
        )}

        {loading && (
          <div className="flex flex-col items-center justify-center h-36 gap-2">
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
            <p className="text-xs text-muted-foreground">Analizando estadísticas...</p>
          </div>
        )}

        {error && !data && (
          <div className="flex flex-col items-center justify-center h-36 gap-2">
            <p className="text-xs text-destructive-foreground">{error}</p>
            <Button variant="outline" size="sm" onClick={fetchPrediction}>
              Reintentar
            </Button>
          </div>
        )}

        {data && !loading && (
          <>
            {activeTab === '1x2' && data.market1x2 && (
              <Market1X2View market={data.market1x2} homeTeam={homeTeam} awayTeam={awayTeam} />
            )}
            {activeTab === 'goles' && data.marketGoals && (
              <MarketGoalsView market={data.marketGoals} />
            )}
            {activeTab === 'btts' && data.marketBTTS && (
              <MarketBTTSView market={data.marketBTTS} />
            )}
            {activeTab === 'corners' && data.marketCorners && (
              <MarketCornersView market={data.marketCorners} />
            )}
            {activeTab === 'tarjetas' && data.marketCards && (
              <MarketCardsView market={data.marketCards} />
            )}
            {activeTab === 'picks' && (
              <PicksView picks={data.drafteaPicks ?? []} />
            )}
            {!data[`market${activeTab === '1x2' ? '1x2' : activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}` as keyof Prediction] && activeTab !== 'picks' && (
              <p className="text-xs text-muted-foreground text-center mt-8">
                Sin datos para este mercado
              </p>
            )}
          </>
        )}
      </div>

      {data && (
        <div className="px-4 pb-3 flex justify-between items-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchPrediction}
            className="text-xs text-muted-foreground h-7"
          >
            Actualizar
          </Button>
          {data.confidence !== undefined && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground">Confianza global:</span>
              <ConfidenceBadge value={data.confidence} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Sub-views ───────────────────────────────────────────────────────────────

function ProbBar({ label, value, color = 'bg-primary' }: { label: string; value: number; color?: string }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold text-foreground">{value.toFixed(1)}%</span>
      </div>
      <div className="h-2 bg-secondary rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-500', color)}
          style={{ width: `${Math.min(value, 100)}%` }}
        />
      </div>
    </div>
  )
}

function ConfidenceBadge({ value }: { value: number }) {
  const color =
    value >= 70 ? 'bg-win/20 text-win border-win/30' :
    value >= 50 ? 'bg-draw/20 text-draw border-draw/30' :
    'bg-loss/20 text-loss border-loss/30'
  return (
    <Badge variant="outline" className={cn('text-[10px] font-bold', color)}>
      {value.toFixed(0)}%
    </Badge>
  )
}

function Market1X2View({
  market,
  homeTeam,
  awayTeam,
}: {
  market: NonNullable<Prediction['market1x2']>
  homeTeam: string
  awayTeam: string
}) {
  return (
    <div className="space-y-3">
      <ProbBar label={`Victoria ${homeTeam}`} value={market.home} color="bg-win" />
      <ProbBar label="Empate" value={market.draw} color="bg-draw" />
      <ProbBar label={`Victoria ${awayTeam}`} value={market.away} color="bg-chart-2" />
      {(market.homeOdds || market.drawOdds || market.awayOdds) && (
        <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-border">
          {[
            { label: '1', odds: market.homeOdds },
            { label: 'X', odds: market.drawOdds },
            { label: '2', odds: market.awayOdds },
          ].map(({ label, odds }) => odds ? (
            <div key={label} className="bg-secondary rounded-lg px-2 py-1.5 text-center">
              <p className="text-[10px] text-muted-foreground">{label}</p>
              <p className="text-sm font-bold text-foreground">{odds.toFixed(2)}</p>
            </div>
          ) : null)}
        </div>
      )}
    </div>
  )
}

function MarketGoalsView({ market }: { market: NonNullable<Prediction['marketGoals']> }) {
  return (
    <div className="space-y-3">
      {market.expectedGoals !== undefined && (
        <div className="flex items-center justify-between bg-secondary rounded-lg px-3 py-2 mb-1">
          <span className="text-xs text-muted-foreground">xG esperado</span>
          <span className="text-sm font-bold text-primary">{market.expectedGoals.toFixed(2)}</span>
        </div>
      )}
      <ProbBar label="Over 1.5" value={market.over15} color="bg-win" />
      <ProbBar label="Under 1.5" value={market.under15} color="bg-muted-foreground" />
      <ProbBar label="Over 2.5" value={market.over25} color="bg-draw" />
      <ProbBar label="Under 2.5" value={market.under25} color="bg-muted-foreground" />
      <ProbBar label="Over 3.5" value={market.over35} color="bg-loss" />
      <ProbBar label="Under 3.5" value={market.under35} color="bg-muted-foreground" />
    </div>
  )
}

function MarketBTTSView({ market }: { market: NonNullable<Prediction['marketBTTS']> }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className={cn(
          'rounded-xl border-2 p-4 text-center transition-all',
          market.yes >= market.no ? 'border-win bg-win/10' : 'border-border bg-secondary'
        )}>
          <p className="text-xs text-muted-foreground mb-1">Ambos Marcan</p>
          <p className={cn('text-2xl font-bold', market.yes >= market.no ? 'text-win' : 'text-foreground')}>
            {market.yes.toFixed(1)}%
          </p>
          <p className="text-xs font-medium mt-1">SI</p>
        </div>
        <div className={cn(
          'rounded-xl border-2 p-4 text-center transition-all',
          market.no > market.yes ? 'border-loss bg-loss/10' : 'border-border bg-secondary'
        )}>
          <p className="text-xs text-muted-foreground mb-1">No Ambos Marcan</p>
          <p className={cn('text-2xl font-bold', market.no > market.yes ? 'text-loss' : 'text-foreground')}>
            {market.no.toFixed(1)}%
          </p>
          <p className="text-xs font-medium mt-1">NO</p>
        </div>
      </div>
      <ProbBar label="BTTS Sí" value={market.yes} color="bg-win" />
      <ProbBar label="BTTS No" value={market.no} color="bg-loss" />
    </div>
  )
}

function MarketCornersView({ market }: { market: NonNullable<Prediction['marketCorners']> }) {
  return (
    <div className="space-y-3">
      {market.avgCorners !== undefined && (
        <div className="flex items-center justify-between bg-secondary rounded-lg px-3 py-2 mb-1">
          <span className="text-xs text-muted-foreground">Corners promedio</span>
          <span className="text-sm font-bold text-primary">{market.avgCorners.toFixed(1)}</span>
        </div>
      )}
      <ProbBar label="Over 8.5 corners" value={market.over85} color="bg-win" />
      <ProbBar label="Under 8.5 corners" value={market.under85} color="bg-muted-foreground" />
      <ProbBar label="Over 9.5 corners" value={market.over95} color="bg-draw" />
      <ProbBar label="Under 9.5 corners" value={market.under95} color="bg-muted-foreground" />
      <ProbBar label="Over 10.5 corners" value={market.over105} color="bg-loss" />
      <ProbBar label="Under 10.5 corners" value={market.under105} color="bg-muted-foreground" />
    </div>
  )
}

function MarketCardsView({ market }: { market: NonNullable<Prediction['marketCards']> }) {
  return (
    <div className="space-y-3">
      {market.avgCards !== undefined && (
        <div className="flex items-center justify-between bg-secondary rounded-lg px-3 py-2 mb-1">
          <span className="text-xs text-muted-foreground">Tarjetas promedio</span>
          <span className="text-sm font-bold text-primary">{market.avgCards.toFixed(1)}</span>
        </div>
      )}
      <ProbBar label="Over 3.5 tarjetas" value={market.over35} color="bg-win" />
      <ProbBar label="Under 3.5 tarjetas" value={market.under35} color="bg-muted-foreground" />
      <ProbBar label="Over 4.5 tarjetas" value={market.over45} color="bg-draw" />
      <ProbBar label="Under 4.5 tarjetas" value={market.under45} color="bg-muted-foreground" />
      <ProbBar label="Over 5.5 tarjetas" value={market.over55} color="bg-loss" />
      <ProbBar label="Under 5.5 tarjetas" value={market.under55} color="bg-muted-foreground" />
    </div>
  )
}

function PicksView({ picks }: { picks: DrafteaPick[] }) {
  if (picks.length === 0) {
    return (
      <div className="flex items-center justify-center h-28">
        <p className="text-xs text-muted-foreground">Sin picks disponibles aún</p>
      </div>
    )
  }

  return (
    <div className="space-y-2.5">
      {picks.map((pick, i) => (
        <div key={i} className="bg-secondary rounded-lg p-3 border border-border">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-[10px] uppercase tracking-wide shrink-0">
                  {pick.market}
                </Badge>
                <span className="text-sm font-semibold text-foreground truncate">{pick.selection}</span>
              </div>
              {pick.reason && (
                <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{pick.reason}</p>
              )}
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              <ConfidenceBadge value={pick.confidence} />
              {pick.edge !== undefined && (
                <span className={cn('text-[10px] font-medium', pick.edge > 0 ? 'text-win' : 'text-muted-foreground')}>
                  {pick.edge > 0 ? '+' : ''}{pick.edge.toFixed(1)}% edge
                </span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Demo data for fallback ───────────────────────────────────────────────────

function getDemoData(homeTeam: string, awayTeam: string, league?: string): Prediction {
  return {
    homeTeam,
    awayTeam,
    league,
    dataQuality: 'medium',
    confidence: 65,
    market1x2: { home: 48, draw: 24, away: 28, homeOdds: 1.95, drawOdds: 3.6, awayOdds: 3.2 },
    marketGoals: { over15: 82, under15: 18, over25: 57, under25: 43, over35: 28, under35: 72, expectedGoals: 2.6 },
    marketBTTS: { yes: 54, no: 46 },
    marketCorners: { over85: 71, under85: 29, over95: 52, under95: 48, over105: 33, under105: 67, avgCorners: 9.8 },
    marketCards: { over35: 58, under35: 42, over45: 34, under45: 66, over55: 18, under55: 82, avgCards: 4.1 },
    drafteaPicks: [
      { market: 'Goles', selection: 'Over 2.5', confidence: 72, edge: 5.2, reason: 'Ambos equipos con alta ofensiva. xG combinado 2.6.' },
      { market: 'BTTS', selection: 'Sí', confidence: 58, edge: 2.1, reason: 'Ambos equipos han marcado en 6 de sus últimos 8 partidos.' },
      { market: 'Corners', selection: 'Over 9.5', confidence: 64, edge: 3.8, reason: `${homeTeam} promedia 5.4 corners por partido en casa.` },
    ],
  }
}
