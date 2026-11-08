"use client"

import { useEffect, useState } from "react"
import { Loader2, Zap, WifiOff } from "lucide-react"
import type { StatusResponse } from "@/lib/api-client"
import { getStatus } from "@/lib/api-client"

export function StatusIndicator() {
  const [status, setStatus] = useState<StatusResponse | null>(null)

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const data = await getStatus()
        if (active) setStatus(data)
      } catch {
        /* ignore */
      }
    }
    load()
    const interval = setInterval(load, 60_000)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [])

  if (!status) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Conectando...
      </div>
    )
  }

  const ollamaOnline = status.chatbot?.available
  const modelName = status.chatbot?.model || "llama3:8b"

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5">
        {ollamaOnline ? (
          <Zap className="h-3.5 w-3.5 text-emerald-500" />
        ) : (
          <WifiOff className="h-3.5 w-3.5 text-red-500" />
        )}
        <span className={`text-xs font-medium ${ollamaOnline ? "text-emerald-400" : "text-red-400"}`}>
          {ollamaOnline ? modelName : "Offline"}
        </span>
      </div>
      {status.model_loaded && (
        <span className="text-[10px] text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">ML</span>
      )}
    </div>
  )
}
