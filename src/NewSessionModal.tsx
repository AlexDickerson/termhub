import { useEffect, useRef, useState } from 'react'
import { PERMISSION_MODES, type AgentDef, type NewSessionOptions } from './types'

type Props = {
  // Pre-resolved so the dialog opens with a sensible cwd already filled in.
  initialCwd: string
  agents: AgentDef[]
  onCreate: (opts: NewSessionOptions) => void
  onCancel: () => void
}

type CliChoice = 'shell' | 'claude' | 'codex' | 'gemini'

// Only claude takes an agent / permission mode; codex and gemini ignore both
// (see the open_session tool description). The dialog hides them rather than
// offering settings that silently do nothing.
const CLAUDE_ONLY: CliChoice[] = ['claude']

export function NewSessionModal({ initialCwd, agents, onCreate, onCancel }: Props) {
  const [cwd, setCwd] = useState(initialCwd)
  const [cli, setCli] = useState<CliChoice>('claude')
  const [model, setModel] = useState('')
  const [agent, setAgent] = useState('')
  const [permissionMode, setPermissionMode] = useState('')
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')

  const overlayRef = useRef<HTMLDivElement>(null)
  const cwdRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    cwdRef.current?.focus()
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onCancel])

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === overlayRef.current) onCancel()
  }

  const pickFolder = async () => {
    const picked = await window.termhub.pickFolder()
    if (picked) setCwd(picked)
  }

  const showClaudeOptions = CLAUDE_ONLY.includes(cli)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedCwd = cwd.trim()
    if (!trimmedCwd) return
    onCreate({
      cwd: trimmedCwd,
      cli: cli === 'shell' ? undefined : cli,
      model: model.trim() || undefined,
      agent: showClaudeOptions ? agent.trim() || undefined : undefined,
      permissionMode: showClaudeOptions ? permissionMode || undefined : undefined,
      name: name.trim() || undefined,
      prompt: cli === 'shell' ? undefined : prompt.trim() || undefined,
    })
  }

  return (
    <div ref={overlayRef} onClick={handleOverlayClick} className="modal-overlay">
      <form
        className="new-session-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-session-title"
        onSubmit={submit}
      >
        <h2 id="new-session-title" className="new-session-title">New session</h2>

        <label className="field">
          <span className="field-label">Folder</span>
          <div className="field-row">
            <input
              ref={cwdRef}
              className="field-input"
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              placeholder="/path/to/repo"
              spellCheck={false}
            />
            <button type="button" className="field-btn" onClick={pickFolder}>
              Browse…
            </button>
          </div>
        </label>

        <label className="field">
          <span className="field-label">Runtime</span>
          <select
            className="field-input"
            value={cli}
            onChange={(e) => setCli(e.target.value as CliChoice)}
          >
            <option value="claude">Claude Code</option>
            <option value="codex">Codex CLI</option>
            <option value="gemini">Gemini CLI</option>
            <option value="shell">Plain shell</option>
          </select>
        </label>

        {cli !== 'shell' && (
          <label className="field">
            <span className="field-label">Model</span>
            <input
              className="field-input"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="leave blank for the default"
              spellCheck={false}
            />
          </label>
        )}

        {showClaudeOptions && (
          <>
            <label className="field">
              <span className="field-label">Agent</span>
              <select
                className="field-input"
                value={agent}
                onChange={(e) => setAgent(e.target.value)}
              >
                <option value="">(none)</option>
                {agents.map((a) => (
                  <option key={a.path} value={a.name}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field-label">Permission mode</span>
              <select
                className="field-input"
                value={permissionMode}
                onChange={(e) => setPermissionMode(e.target.value)}
              >
                <option value="">(default)</option>
                {PERMISSION_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        <label className="field">
          <span className="field-label">Name</span>
          <input
            className="field-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="defaults to the folder name"
          />
        </label>

        {cli !== 'shell' && (
          <label className="field">
            <span className="field-label">Initial prompt</span>
            <textarea
              className="field-input field-textarea"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="sent as the first message once the session boots"
              rows={3}
            />
          </label>
        )}

        <div className="new-session-actions">
          <button type="submit" className="field-btn field-btn-primary" disabled={!cwd.trim()}>
            Create
          </button>
          <button type="button" className="field-btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
