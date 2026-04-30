import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session, SessionUsage } from './types'

type Props = {
  session: Session | null
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

function pct(value: number): string {
  return `${(value * 100).toFixed(0)}%`
}

function contextBarColor(percent: number): string {
  if (percent >= 0.80) return '#f85149'
  if (percent >= 0.60) return '#e3b341'
  return '#3fb950'
}

export function SessionUsagePanel({ session }: Props) {
  const [usage, setUsage] = useState<SessionUsage | null>(null)
  const [loading, setLoading] = useState(false)
  const sessionIdRef = useRef<string | null>(null)

  const fetchUsage = useCallback(async (id: string) => {
    setLoading(true)
    try {
      const result = await window.termhub.getSessionUsage(id)
      if (sessionIdRef.current === id) {
        setUsage(result)
      }
    } catch {
      // Usage data is non-critical; silently ignore fetch errors.
    } finally {
      if (sessionIdRef.current === id) {
        setLoading(false)
      }
    }
  }, [])

  // Reset and fetch when the active session changes.
  useEffect(() => {
    if (!session) {
      sessionIdRef.current = null
      setUsage(null)
      setLoading(false)
      return
    }
    sessionIdRef.current = session.id
    setUsage(null)
    void fetchUsage(session.id)
  }, [session, fetchUsage])

  // Subscribe to push events from the poll loop.
  useEffect(() => {
    const unsub = window.termhub.onSessionUsageChanged((sessionId, updatedUsage) => {
      if (sessionIdRef.current === sessionId) {
        setUsage(updatedUsage)
      }
    })
    return unsub
  }, [])

  if (!session) return <p className="hint">No active session.</p>

  if (loading && usage === null) return <p className="hint">Loading…</p>

  if (usage === null) return <p className="hint">No usage data yet.</p>

  const { contextWindow, cumulative, cacheHitRate, webFetches, webSearches, turns, model } = usage
  const hasMax = contextWindow.max > 0
  const barColor = contextBarColor(contextWindow.percent)
  const isHighUsage = hasMax && contextWindow.percent >= 0.80

  return (
    <div className="usage-panel">
      <div className="usage-ctx-row">
        <span className="usage-label">Context</span>
        <span className="usage-ctx-nums">
          {fmt(contextWindow.used)}
          {hasMax ? ` / ${fmt(contextWindow.max)}` : ''}
          {hasMax ? ` (${pct(contextWindow.percent)})` : ''}
        </span>
      </div>

      {hasMax && (
        <div className="usage-bar-track">
          <div
            className="usage-bar-fill"
            style={{
              width: `${Math.min(contextWindow.percent * 100, 100).toFixed(1)}%`,
              background: barColor,
            }}
          />
        </div>
      )}

      {isHighUsage && (
        <p className="usage-warn">Context window ≥80% full</p>
      )}

      <div className="usage-stat-row">
        <span className="usage-stat-label">Output tokens</span>
        <span className="usage-stat-val">{fmt(cumulative.outputTokens)}</span>
      </div>

      <div className="usage-stat-row">
        <span className="usage-stat-label">Cache hit rate</span>
        <span className="usage-stat-val">{pct(cacheHitRate)}</span>
      </div>

      <div className="usage-meta-row">
        <span className="usage-meta">{turns} turn{turns !== 1 ? 's' : ''}</span>
        {webSearches > 0 && <span className="usage-meta">{webSearches} search</span>}
        {webFetches > 0 && <span className="usage-meta">{webFetches} fetch</span>}
      </div>

      {model && (
        <div className="usage-footer" title={usage.jsonlPath}>
          {model}
        </div>
      )}
    </div>
  )
}
