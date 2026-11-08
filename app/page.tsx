'use client'

import useSWR from 'swr'
import { useState } from 'react'
import { AppSidebar } from '@/components/app-sidebar'
import { StandingsPanel } from '@/components/standings-panel'
import { UpcomingPanel } from '@/components/upcoming-panel'
import { LivePanel } from '@/components/live-panel'
import { PredictorPanel } from '@/components/predictor-panel'
import { ChatbotPanel } from '@/components/chatbot-panel'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'

const fetcher = (url: string) => fetch(url).then(r => r.json())

function normalizeMatchForPrediction(match: any) {
  return {
    home_team_id: match.home_team_id ?? match.homeTeamId ?? match.homeTeam?.id ?? match.home_team?.id,
    away_team_id: match.away_team_id ?? match.awayTeamId ?? match.awayTeam?.id ?? match.away_team?.id,
    league_key: match.league_key ?? match.leagueKey ?? match.league ?? match.tournament ?? '',
    league: match.league ?? match.tournament ?? '',
    home_team: match.home_team ?? match.homeTeam ?? '',
    away_team: match.away_team ?? match.awayTeam ?? '',
    home_team_logo: match.home_team_logo ?? match.home_logo ?? '',
    away_team_logo: match.away_team_logo ?? match.away_logo ?? '',
  }
}

export default function HomePage() {
  const [currentPage, setCurrentPage] = useState('predict')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [selectedMatch, setSelectedMatch] = useState<any>(null)
  const [predictionContext, setPredictionContext] = useState<Record<string, unknown> | null>(null)

  const { data: status } = useSWR('/api/status', fetcher, { refreshInterval: 60000 })

  const handleNavigate = (page: string) => {
    setCurrentPage(page)
    setSelectedMatch(null)
    setSidebarOpen(false)
  }

  const handlePredictFromMatch = (match: any) => {
    setSelectedMatch(normalizeMatchForPrediction(match))
    setCurrentPage('predict')
  }

  const handlePredictionReady = (pred: any) => {
    setPredictionContext(pred)
  }

  const getPageTitle = () => {
    switch (currentPage) {
      case 'predict': return 'Predictor IA'
      case 'upcoming': return 'Próximos Partidos'
      case 'live': return 'En Vivo'
      case 'standings': return 'Tabla de Posiciones'
      case 'chat': return 'Chat IA Local'
      case 'stats': return 'Estadísticas'
      default: return 'PredictIA'
    }
  }

  // Páginas que muestran el chat en columna lateral
  const showChatSidebar = currentPage === 'predict'

  return (
    <div className="h-screen flex bg-background overflow-hidden">
      {/* Mobile Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div className={cn(
        'fixed lg:static inset-y-0 left-0 z-50 transform transition-transform duration-200 ease-in-out lg:transform-none',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      )}>
        <AppSidebar
          currentPage={currentPage}
          onNavigate={handleNavigate}
          status={{
            modelLoaded: status?.model_loaded ?? true,
            sofascoreAvailable: status?.sofascore?.available,
          }}
        />
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Header */}
        <header className="h-14 bg-surface border-b border-border flex items-center justify-between px-4 lg:px-7 flex-shrink-0">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="w-5 h-5" />
            </Button>
            <span className="text-sm font-semibold uppercase tracking-wider text-text-2">
              {getPageTitle()}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <StatusPill online={true} label="Chat Local" />
            <StatusPill online={status?.sofascore?.available} label="SofaScore" />
            {status?.football_data?.configured && (
              <StatusPill online={status?.football_data?.available ?? false} label="FD.org" />
            )}
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-hidden">
          {/* Predictor con chat lateral */}
          {currentPage === 'predict' && (
            <div className="h-full flex gap-0">
              <div className="flex-1 overflow-y-auto p-4 lg:p-7">
                <PredictorPanel
                  initialMatch={selectedMatch}
                  onPredictionReady={handlePredictionReady}
                />
              </div>
              {/* Chat lateral en desktop */}
              <div className="hidden xl:flex flex-col w-96 border-l border-border p-4 bg-surface/50">
                <ChatbotPanel predictionContext={predictionContext} />
              </div>
            </div>
          )}

          {/* Chat dedicado en mobile / página propia */}
          {currentPage === 'chat' && (
            <div className="h-full p-4 lg:p-7">
              <ChatbotPanel predictionContext={predictionContext} />
            </div>
          )}

          {currentPage === 'upcoming' && (
            <div className="h-full overflow-y-auto p-4 lg:p-7">
              <UpcomingPanel onPredict={handlePredictFromMatch} />
            </div>
          )}

          {currentPage === 'live' && (
            <div className="h-full overflow-y-auto p-4 lg:p-7">
              <LivePanel onPredict={handlePredictFromMatch} />
            </div>
          )}

          {currentPage === 'standings' && (
            <div className="h-full overflow-y-auto p-4 lg:p-7">
              <StandingsPanel />
            </div>
          )}

          {currentPage === 'stats' && (
            <div className="h-full overflow-y-auto p-4 lg:p-7">
              <StatsPanel />
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

function StatusPill({ online, label }: { online?: boolean; label: string }) {
  const isLoading = online === undefined
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-2 border border-border rounded-full text-xs font-mono">
      <div className={cn(
        'w-1.5 h-1.5 rounded-full',
        isLoading ? 'bg-surface-4' : online ? 'bg-accent-green shadow-accent-glow' : 'bg-destructive'
      )} />
      <span className="text-text-2">
        {label} {isLoading ? 'Cargando...' : online ? 'Online' : 'Offline'}
      </span>
    </div>
  )
}

function StatsPanel() {
  return (
    <div className="space-y-6 animate-fade-up">
      <h2 className="text-xl font-bold tracking-wider uppercase">Estadísticas</h2>
      <Card className="bg-surface border-border">
        <CardContent className="py-12 flex flex-col items-center justify-center gap-4">
          <div className="text-5xl">📊</div>
          <h3 className="font-semibold text-lg">Estadísticas Avanzadas</h3>
          <p className="text-text-2 text-center max-w-md">
            Próximamente: análisis detallado de equipos, tendencias históricas y métricas avanzadas.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
