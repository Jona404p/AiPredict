'use client'

import { cn } from '@/lib/utils'
import {
  BarChart3,
  Calendar,
  MessageCircle,
  Trophy,
  Zap,
  Radio,
  Bot,
} from 'lucide-react'

interface SidebarProps {
  currentPage: string
  onNavigate: (page: string) => void
  status: {
    modelLoaded: boolean
    sofascoreAvailable?: boolean
  }
}

const navItems = [
  { id: 'predict',   label: 'Predictor',     icon: Zap,           group: 'principal' },
  { id: 'chat',      label: 'Chat IA',        icon: Bot,           group: 'principal' },
  { id: 'upcoming',  label: 'Próximos',       icon: Calendar,      group: 'datos' },
  { id: 'live',      label: 'En Vivo',        icon: Radio,         group: 'datos' },
  { id: 'standings', label: 'Posiciones',     icon: Trophy,        group: 'datos' },
  { id: 'stats',     label: 'Estadísticas',   icon: BarChart3,     group: 'datos' },
]

export function AppSidebar({ currentPage, onNavigate, status }: SidebarProps) {
  const groups = {
    principal: navItems.filter(i => i.group === 'principal'),
    datos:     navItems.filter(i => i.group === 'datos'),
  }

  return (
    <aside className="w-60 bg-surface border-r border-border flex flex-col h-full overflow-y-auto">
      {/* Logo */}
      <div className="p-5 border-b border-border">
        <h1 className="text-2xl tracking-wider">
          <span className="text-accent-green font-bold">PREDICT</span>
          <span className="text-foreground font-bold">IA</span>
        </h1>
        <p className="text-[10px] text-text-3 uppercase tracking-widest mt-0.5">
          Análisis de fútbol con IA
        </p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-2">
        {/* Grupo: Herramientas */}
        <div className="px-5 py-3 text-[9px] font-bold uppercase tracking-widest text-text-3">
          Herramientas
        </div>
        {groups.principal.map((item) => (
          <NavButton key={item.id} item={item} currentPage={currentPage} onNavigate={onNavigate} />
        ))}

        {/* Grupo: Datos en vivo */}
        <div className="px-5 pt-4 pb-3 text-[9px] font-bold uppercase tracking-widest text-text-3">
          Datos en Vivo
        </div>
        {groups.datos.map((item) => (
          <NavButton key={item.id} item={item} currentPage={currentPage} onNavigate={onNavigate} />
        ))}
      </nav>

      {/* Footer / Status */}
      <div className="mt-auto p-4 border-t border-border space-y-1.5">
        <StatusRow online={true} label="Chat IA Local" />
        <StatusRow online={status.sofascoreAvailable} label="SofaScore" />
        <p className="text-[10px] text-text-3 pt-1">
          Temporada 2025/26 · Datos en tiempo real
        </p>
      </div>
    </aside>
  )
}

function NavButton({
  item,
  currentPage,
  onNavigate,
}: {
  item: { id: string; label: string; icon: React.ElementType }
  currentPage: string
  onNavigate: (id: string) => void
}) {
  const active = currentPage === item.id
  return (
    <button
      onClick={() => onNavigate(item.id)}
      className={cn(
        'w-full flex items-center gap-3 px-5 py-2.5 text-sm font-medium transition-all',
        'border-l-2',
        active
          ? 'text-accent-green bg-accent-green/10 border-l-accent-green'
          : 'text-text-2 hover:text-foreground hover:bg-surface-2 border-l-transparent'
      )}
    >
      <item.icon className="w-4 h-4" />
      {item.label}
      {item.id === 'chat' && (
        <span className="ml-auto text-[9px] bg-accent-green/20 text-accent-green border border-accent-green/30 px-1.5 py-0.5 rounded-full font-bold tracking-wider">
          LOCAL
        </span>
      )}
      {item.id === 'live' && (
        <span className="ml-auto w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
      )}
    </button>
  )
}

function StatusRow({ online, label }: { online?: boolean; label: string }) {
  const isLoading = online === undefined
  return (
    <div className="flex items-center gap-2 text-xs text-text-3">
      <div
        className={cn(
          'w-1.5 h-1.5 rounded-full',
          isLoading ? 'bg-surface-4' : online ? 'bg-accent-green shadow-accent-glow' : 'bg-destructive'
        )}
      />
      <span>
        {label} {isLoading ? 'Cargando...' : online ? 'Online' : 'Offline'}
      </span>
    </div>
  )
}
