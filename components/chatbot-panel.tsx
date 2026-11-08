'use client'

import { useState, useRef, useEffect } from 'react'
import { Send, Bot, User, Loader2, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

interface ChatbotPanelProps {
  predictionContext?: Record<string, unknown> | null
}

function parseMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^• (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>)/, '<ul class="list-none space-y-1 pl-2">$1</ul>')
    .replace(/\n\n/g, '<br/><br/>')
    .replace(/\n/g, '<br/>')
}

export function ChatbotPanel({ predictionContext }: ChatbotPanelProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        '¡Hola! Soy **PredictIA**, tu asistente local de análisis de fútbol ⚽\n\n¿Tienes dudas sobre las predicciones, quieres entender las métricas o aprender sobre alguna liga? Pregúntame lo que quieras.',
      timestamp: new Date(),
    },
  ])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || isStreaming) return

    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setIsStreaming(true)

    // Placeholder del asistente
    const assistantId = `a-${Date.now()}`
    setMessages((prev) => [
      ...prev,
      { id: assistantId, role: 'assistant', content: '', timestamp: new Date() },
    ])

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...messages, userMsg].map((m) => ({
            role: m.role,
            content: m.content,
          })),
          predictionContext: predictionContext ?? undefined,
        }),
      })

      if (!res.ok) throw new Error('Error al conectar con el chatbot')
      if (!res.body) throw new Error('Sin respuesta')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (!line.trim()) continue
          // Protocolo Vercel AI data stream
          if (line.startsWith('0:')) {
            try {
              const token = JSON.parse(line.slice(2))
              accumulated += token
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, content: accumulated } : m))
              )
            } catch {}
          }
          // f: = messageId, e:/d: = finish — ignorar
        }
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: '❌ Error al conectar con el chatbot. Intenta de nuevo.' }
            : m
        )
      )
    } finally {
      setIsStreaming(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const clearChat = () => {
    setMessages([
      {
        id: 'welcome',
        role: 'assistant',
        content:
          '¡Hola! Soy **PredictIA**, tu asistente local de análisis de fútbol ⚽\n\n¿En qué te puedo ayudar?',
        timestamp: new Date(),
      },
    ])
  }

  const SUGGESTIONS = predictionContext
    ? ['¿Quién es el favorito?', 'Explica la predicción', 'Probabilidad de Over 2.5', 'Análisis del partido']
    : ['¿Qué es el xG?', 'Explica el modelo Poisson', 'Info sobre La Liga 2025/26', '¿Cómo funciona BTTS?']

  return (
    <div className="flex flex-col h-full bg-surface border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface-2 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-accent-green/20 border border-accent-green/30 flex items-center justify-center">
            <Bot className="w-4 h-4 text-accent-green" />
          </div>
          <div>
            <p className="text-sm font-semibold text-text">PredictIA Chat</p>
            <p className="text-[10px] text-text-3 font-mono uppercase tracking-wider">
              IA Local · Sin API externa
            </p>
          </div>
        </div>
        <button
          onClick={clearChat}
          className="p-1.5 hover:bg-surface-3 rounded-lg transition-colors text-text-3 hover:text-text-2"
          title="Limpiar chat"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn('flex gap-2.5', msg.role === 'user' ? 'flex-row-reverse' : 'flex-row')}
          >
            {/* Avatar */}
            <div
              className={cn(
                'w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5',
                msg.role === 'assistant'
                  ? 'bg-accent-green/20 border border-accent-green/30'
                  : 'bg-blue-custom/20 border border-blue-custom/30'
              )}
            >
              {msg.role === 'assistant' ? (
                <Bot className="w-3.5 h-3.5 text-accent-green" />
              ) : (
                <User className="w-3.5 h-3.5 text-blue-custom" />
              )}
            </div>

            {/* Bubble */}
            <div
              className={cn(
                'max-w-[80%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed',
                msg.role === 'assistant'
                  ? 'bg-surface-2 border border-border text-text'
                  : 'bg-blue-custom/15 border border-blue-custom/25 text-text'
              )}
            >
              {msg.content === '' && isStreaming ? (
                <span className="inline-flex gap-1 items-center text-text-3">
                  <span className="w-1 h-1 bg-accent-green rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1 h-1 bg-accent-green rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1 h-1 bg-accent-green rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </span>
              ) : (
                <span
                  dangerouslySetInnerHTML={{ __html: parseMarkdown(msg.content) }}
                  className="[&_strong]:font-semibold [&_strong]:text-text [&_ul]:mt-1 [&_li]:before:content-['•'] [&_li]:before:text-accent-green [&_li]:before:mr-1.5 [&_li]:flex [&_li]:gap-1"
                />
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Suggestion chips */}
      {messages.length <= 2 && (
        <div className="px-4 pb-2 flex flex-wrap gap-1.5 flex-shrink-0">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => { setInput(s); inputRef.current?.focus() }}
              className="text-[11px] px-2.5 py-1 bg-surface-2 border border-border rounded-full text-text-2 hover:text-text hover:border-accent-green/50 transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="px-3 pb-3 pt-2 border-t border-border flex-shrink-0">
        <div className="flex items-end gap-2 bg-surface-2 border border-border rounded-xl px-3 py-2 focus-within:border-accent-green/50 transition-colors">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Pregunta sobre el partido o las métricas..."
            rows={1}
            disabled={isStreaming}
            className="flex-1 bg-transparent text-sm text-text placeholder:text-text-3 resize-none outline-none min-h-[20px] max-h-[80px] leading-5 disabled:opacity-50"
            style={{ height: 'auto' }}
            onInput={(e) => {
              const el = e.target as HTMLTextAreaElement
              el.style.height = 'auto'
              el.style.height = Math.min(el.scrollHeight, 80) + 'px'
            }}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || isStreaming}
            className={cn(
              'w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-all',
              input.trim() && !isStreaming
                ? 'bg-accent-green hover:bg-accent-green/80 text-background'
                : 'bg-surface-3 text-text-3 cursor-not-allowed'
            )}
          >
            {isStreaming ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
        <p className="text-[10px] text-text-3 text-center mt-1.5">
          Enter para enviar · Shift+Enter para nueva línea
        </p>
      </div>
    </div>
  )
}
