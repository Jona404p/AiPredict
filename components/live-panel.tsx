'use client'

import useSWR from 'swr'
import Image from 'next/image'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Search, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface LiveMatch {
  id: number
  sofascore_id: number
  home_team: string
  away_team: string
  home_team_id: number
  away_team_id: number
  home_logo: string
  away_logo: string
  home_score: number
  away_score: number
  home_ht: number | null
  away_ht: number | null
  status: string
  status_desc: string
  minute: string
  tournament: string
  start_time: string
}

interface LivePanelProps {
  onPredict?: (match: LiveMatch) => void
}

export function LivePanel({ onPredict }: LivePanelProps) {
  const { data, isLoading, mutate } = useSWR<{ matches: LiveMatch[] }>(
    '/api/live',
    fetcher,
    { refreshInterval: 30000 } // Refresh every 30 seconds
  )

  const matches = data?.matches || []

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold tracking-wider uppercase">
            Partidos en Vivo
          </h2>
          {matches.length > 0 && (
            <Badge className="bg-destructive text-destructive-foreground animate-pulse">
              {matches.length} LIVE
            </Badge>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => mutate()}
          className="border-border-2"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Actualizar
        </Button>
      </div>

      {isLoading && (
        <Card className="bg-surface border-border">
          <CardContent className="py-8">
            <div className="flex flex-col items-center justify-center gap-4">
              <div className="w-8 h-8 border-2 border-accent-green border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-text-2">Buscando partidos en vivo...</p>
            </div>
          </CardContent>
        </Card>
      )}

      {matches.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {matches.map((match) => (
            <Card 
              key={match.id} 
              className="bg-surface border-border hover:border-destructive/50 transition-all"
            >
              <CardContent className="p-4 space-y-4">
                {/* Header */}
                <div className="flex items-center justify-between">
                  <Badge variant="secondary" className="bg-surface-2 text-text-2 text-xs">
                    ⚽ {match.tournament}
                  </Badge>
                  <div className="flex items-center gap-2">
                    <div className="relative flex items-center gap-1">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-destructive"></span>
                      </span>
                      <span className="text-xs font-semibold text-destructive uppercase">LIVE</span>
                    </div>
                    <span className="text-xs font-mono font-bold text-foreground bg-surface-2 px-2 py-0.5 rounded">
                      {match.minute}
                    </span>
                  </div>
                </div>

                {/* Score */}
                <div className="flex items-center justify-between">
                  <div className="flex flex-col items-center gap-2 flex-1">
                    <div className="w-12 h-12 relative rounded-full overflow-hidden bg-surface-3 border border-border-2">
                      <Image
                        src={match.home_logo}
                        alt={match.home_team}
                        fill
                        className="object-contain p-1"
                        onError={(e) => {
                          const img = e.target as HTMLImageElement
                          img.style.display = 'none'
                        }}
                      />
                    </div>
                    <span className="text-xs font-medium text-center line-clamp-2">
                      {match.home_team}
                    </span>
                  </div>

                  <div className="flex flex-col items-center px-4">
                    <span className="text-3xl font-mono font-bold">
                      {match.home_score} - {match.away_score}
                    </span>
                    {match.home_ht !== null && (
                      <span className="text-xs text-text-3 mt-1">
                        1T: {match.home_ht} - {match.away_ht}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-col items-center gap-2 flex-1">
                    <div className="w-12 h-12 relative rounded-full overflow-hidden bg-surface-3 border border-border-2">
                      <Image
                        src={match.away_logo}
                        alt={match.away_team}
                        fill
                        className="object-contain p-1"
                        onError={(e) => {
                          const img = e.target as HTMLImageElement
                          img.style.display = 'none'
                        }}
                      />
                    </div>
                    <span className="text-xs font-medium text-center line-clamp-2">
                      {match.away_team}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-2">
                  <Button 
                    variant="outline"
                    size="sm"
                    className="flex-1 border-border-2"
                    onClick={() => {
                      // Show stats (can be expanded)
                      alert('Stats coming soon!')
                    }}
                  >
                    Ver Stats
                  </Button>
                  <Button 
                    size="sm" 
                    className="flex-1 bg-primary text-primary-foreground hover:bg-accent-green/90"
                    onClick={() => onPredict?.(match as any)}
                  >
                    <Search className="w-3 h-3 mr-1" />
                    Predecir
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!isLoading && matches.length === 0 && (
        <Card className="bg-surface border-border">
          <CardContent className="py-12 flex flex-col items-center justify-center gap-4">
            <div className="text-4xl">🔴</div>
            <h3 className="font-semibold text-lg">No hay partidos en vivo</h3>
            <p className="text-text-2 text-center max-w-md">
              Vuelve durante un día de partidos para ver los marcadores en tiempo real
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
