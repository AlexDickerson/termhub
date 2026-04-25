import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session, SessionPr } from './types'
import { isMergeEnabled } from './pr-utils'

type Props = {
  session: Session | null
}

type MergeDialogState = {
  open: boolean
  pr: SessionPr | null
}

function CiDot({ ciState }: { ciState: SessionPr['ciState'] }) {
  if (ciState === null) return null
  const label =
    ciState === 'success' ? 'CI passing' :
    ciState === 'failure' ? 'CI failing' :
    'CI pending'
  const cls =
    ciState === 'success' ? 'pr-ci-dot pr-ci-success' :
    ciState === 'failure' ? 'pr-ci-dot pr-ci-failure' :
    'pr-ci-dot pr-ci-pending'
  return <span className={cls} title={label} aria-label={label} />
}

function PrStateBadge({ state }: { state: SessionPr['state'] }) {
  const cls =
    state === 'open' ? 'pr-badge pr-badge-open' :
    state === 'merged' ? 'pr-badge pr-badge-merged' :
    'pr-badge pr-badge-closed'
  return <span className={cls}>{state}</span>
}

export function SessionPrPanel({ session }: Props) {
  const [pr, setPr] = useState<SessionPr | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mergeDialog, setMergeDialog] = useState<MergeDialogState>({
    open: false,
    pr: null,
  })
  const [merging, setMerging] = useState(false)
  const sessionIdRef = useRef<string | null>(null)

  const fetchPr = useCallback(
    async (id: string) => {
      setLoading(true)
      setError(null)
      try {
        const result = await window.termhub.getSessionPr(id)
        // Guard stale responses if session changed while request was in flight.
        if (sessionIdRef.current === id) {
          setPr(result)
        }
      } catch (err) {
        if (sessionIdRef.current === id) {
          setError(err instanceof Error ? err.message : String(err))
        }
      } finally {
        if (sessionIdRef.current === id) {
          setLoading(false)
        }
      }
    },
    [],
  )

  // Reset and fetch when the active session changes.
  useEffect(() => {
    if (!session) {
      sessionIdRef.current = null
      setPr(null)
      setError(null)
      setLoading(false)
      return
    }
    sessionIdRef.current = session.id
    setPr(null)
    setError(null)
    void fetchPr(session.id)
  }, [session, fetchPr])

  // Subscribe to push events from the poll loop.
  useEffect(() => {
    const unsub = window.termhub.onSessionPrChanged((sessionId, updatedPr) => {
      if (sessionIdRef.current === sessionId) {
        setPr(updatedPr)
      }
    })
    return unsub
  }, [])

  const handleOpenGitHub = () => {
    if (pr?.url) window.termhub.openExternal(pr.url)
  }

  const handleMergeClick = () => {
    if (!pr) return
    setMergeDialog({ open: true, pr })
  }

  const handleMergeConfirm = async () => {
    if (!session || !mergeDialog.pr) return
    setMergeDialog((d) => ({ ...d, open: false }))
    setMerging(true)
    try {
      await window.termhub.mergeSessionPr(session.id, mergeDialog.pr.number)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setMerging(false)
    }
  }

  const handleMergeCancel = () => {
    setMergeDialog({ open: false, pr: null })
  }

  if (!session) {
    return <p className="hint">No active session.</p>
  }

  if (loading && pr === null) {
    return <p className="hint">Loading…</p>
  }

  if (error) {
    return (
      <div>
        <p className="hint error">{error}</p>
        <button
          className="pr-action-btn"
          onClick={() => { void fetchPr(session.id) }}
        >
          Retry
        </button>
      </div>
    )
  }

  if (pr === null) {
    return (
      <div>
        <p className="hint">No PR yet for this branch.</p>
        <button
          className="pr-action-btn"
          onClick={() => { void fetchPr(session.id) }}
        >
          Refresh
        </button>
      </div>
    )
  }

  const mergeAllowed = isMergeEnabled(pr)
  const mergeTitle = !mergeAllowed
    ? pr.state !== 'open'
      ? 'PR is not open'
      : 'CI must pass before merging'
    : undefined

  return (
    <div className="pr-panel">
      <div className="pr-header">
        <CiDot ciState={pr.ciState} />
        <PrStateBadge state={pr.state} />
        <span className="pr-number">#{pr.number}</span>
      </div>
      <div className="pr-title" title={pr.title}>{pr.title}</div>
      <div className="pr-actions">
        <button
          className="pr-action-btn"
          onClick={handleOpenGitHub}
        >
          Open in GitHub
        </button>
        <button
          className="pr-action-btn pr-merge-btn"
          onClick={handleMergeClick}
          disabled={!mergeAllowed || merging}
          title={mergeTitle}
        >
          {merging ? 'Merging…' : 'Merge'}
        </button>
        <button
          className="pr-action-btn pr-refresh-btn"
          onClick={() => { void fetchPr(session.id) }}
          title="Refresh PR status"
          disabled={loading}
        >
          {loading ? '…' : 'Refresh'}
        </button>
      </div>

      {mergeDialog.open && mergeDialog.pr ? (
        <div className="pr-confirm-overlay">
          <div className="pr-confirm-dialog">
            <p className="pr-confirm-msg">
              Squash-merge PR #{mergeDialog.pr.number} and delete branch?
            </p>
            <p className="pr-confirm-title">{mergeDialog.pr.title}</p>
            <div className="pr-confirm-actions">
              <button
                className="pr-action-btn pr-merge-btn"
                onClick={() => { void handleMergeConfirm() }}
              >
                Confirm Merge
              </button>
              <button
                className="pr-action-btn"
                onClick={handleMergeCancel}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
