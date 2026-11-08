'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Bot, User, Loader2, TrendingUp, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { sendChatMessage, type ChatMessage, type MatchContext } from '@/lib/api-client'

const SUGGESTIONS = [
  'Dame picks para Real Madrid vs Barcelona',
  'Predicción Premier League hoy',
  '¿Over 2.5 o Under en Liverpool vs City?',
  'Corners Over 9.5 en el Clásico',
  'Mejores picks BTTS de hoy',
]

interface ChatInterfaceProps {
  matchContext?: MatchContext
  onPredictionRequest?: (home: string, away: string, league?: string) => void
}

export default function ChatInterface({
  matchContext,
  onPredictionRequest,
}: ChatInterfaceProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content:
        '¡Hola! Soy **PredictIA**, tu asistente de predicciones deportivas con IA. Tengo acceso a datos en tiempo real de SofaScore y football-data.org.\n\nPuedo ayudarte con:\n- Predicciones 1X2, Over/Under, BTTS\n- Corners y tarjetas totales\n- Marcadores exactos\n- Picks recomendados para Draftea\n\n¿Sobre qué partido quieres analizar hoy?',
      timestamp: new Date(),
    },
  ])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = useCallback(
    async (text?: string) => {
      const msg = (text ?? input).trim()
      if (!msg || isLoading) return

      setInput('')
      setError(null)
      setIsLoading(true)

      const userMessage: ChatMessage = { role: 'user', content: msg, timestamp: new Date() }
      setMessages((prev) => [...prev, userMessage])

      try {
        const res = await sendChatMessage({
          message: msg,
          history: messages.slice(-10),
          matchContext,
        })

        const assistantMessage: ChatMessage = {
          role: 'assistant',
          content: res.response,
          timestamp: new Date(),
        }
        setMessages((prev) => [...prev, assistantMessage])

        // If response contains team names, trigger prediction panel
        if (res.prediction && onPredictionRequest) {
          onPredictionRequest(
            res.prediction.homeTeam,
            res.prediction.awayTeam,
            res.prediction.league
          )
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Error desconocido'
        setError(msg)
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: `Lo siento, ocurrió un error: ${msg}. Verifica que el servidor FastAPI esté activo.`,
            timestamp: new Date(),
          },
        ])
      } finally {
        setIsLoading(false)
        textareaRef.current?.focus()
      }
    },
    [input, isLoading, messages, matchContext, onPredictionRequest]
  )

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 scrollbar-thin scrollbar-thumb-border">
        {messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} />
        ))}

        {isLoading && (
          <div className="flex gap-3 items-start">
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4 text-primary" />
            </div>
            <div className="bg-card border border-border rounded-xl px-4 py-3">
              <div className="flex gap-1.5 items-center">
                <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
                <span className="text-xs text-muted-foreground">Analizando datos...</span>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="flex gap-2 items-center text-xs text-destructive-foreground bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Suggestions */}
      {messages.length <= 1 && (
        <div className="px-4 pb-2">
          <p className="text-xs text-muted-foreground mb-2">Sugerencias:</p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => handleSend(s)}
                className="text-xs bg-secondary hover:bg-accent hover:text-accent-foreground border border-border rounded-full px-3 py-1.5 transition-colors cursor-pointer text-muted-foreground"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="px-4 pb-4 pt-2 border-t border-border">
        {matchContext && (
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs text-muted-foreground">
              Contexto:{' '}
              <span className="text-foreground font-medium">
                {matchContext.homeTeam} vs {matchContext.awayTeam}
              </span>
            </span>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              {matchContext.league ?? 'Liga'}
            </Badge>
          </div>
        )}
        <div className="flex gap-2 items-end">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Pregunta sobre un partido, pide picks, estadísticas..."
            className="resize-none min-h-[44px] max-h-32 bg-secondary border-border text-sm leading-relaxed"
            rows={1}
            disabled={isLoading}
          />
          <Button
            onClick={() => handleSend()}
            disabled={!input.trim() || isLoading}
            size="icon"
            className="shrink-0 bg-primary hover:bg-primary/90 text-primary-foreground h-11 w-11"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            <span className="sr-only">Enviar</span>
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground mt-1.5 text-center">
          Enter para enviar · Shift+Enter para nueva línea
        </p>
      </div>
    </div>
  )
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'

  return (
    <div className={cn('flex gap-3 items-start', isUser && 'flex-row-reverse')}>
      {/* Avatar */}
      <div
        className={cn(
          'w-8 h-8 rounded-full flex items-center justify-center shrink-0',
          isUser ? 'bg-primary/20' : 'bg-primary/20'
        )}
      >
        {isUser ? (
          <User className="w-4 h-4 text-primary" />
        ) : (
          <Bot className="w-4 h-4 text-primary" />
        )}
      </div>

      {/* Bubble */}
      <div
        className={cn(
          'max-w-[80%] rounded-xl px-4 py-3 text-sm leading-relaxed',
          isUser
            ? 'bg-primary text-primary-foreground rounded-tr-sm'
            : 'bg-card border border-border text-foreground rounded-tl-sm'
        )}
      >
        <FormattedMessage content={message.content} />
        {message.timestamp && (
          <p className={cn('text-[10px] mt-1.5', isUser ? 'text-primary-foreground/60 text-right' : 'text-muted-foreground')}>
            {message.timestamp.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
          </p>
        )}
      </div>
    </div>
  )
}

function FormattedMessage({ content }: { content: string }) {
  // Simple markdown-like rendering: bold, code blocks, line breaks
  const parts = content.split('\n')
  return (
    <>
      {parts.map((line, i) => {
        const formatted = line
          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
          .replace(/`(.+?)`/g, '<code class="bg-black/20 rounded px-1 font-mono text-xs">$1</code>')
          .replace(/^- /, '• ')

        return (
          <span key={i}>
            <span dangerouslySetInnerHTML={{ __html: formatted || '&nbsp;' }} />
            {i < parts.length - 1 && <br />}
          </span>
        )
      })}
    </>
  )
}
