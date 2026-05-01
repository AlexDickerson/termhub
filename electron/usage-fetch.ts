// Pure helpers for reading and parsing Claude Code JSONL usage data.
// No Electron or IPC dependencies — importable in tests without mocking.

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import type { SessionUsage } from '../src/types'

export const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  'claude-opus-4-7': 1_000_000,
  'claude-sonnet-4-6': 200_000,
  'claude-haiku-4-5-20251001': 200_000,
  'claude-opus-4-5': 200_000,
  'claude-sonnet-4-5': 200_000,
  'claude-haiku-4-5': 200_000,
}

/** Map a model id to its max context window in tokens, or null if unknown. */
export function getModelContextMax(model: string | null): number | null {
  if (!model) return null
  return MODEL_CONTEXT_LIMITS[model] ?? null
}

/**
 * Encode a cwd path into the sanitized directory name Claude Code uses under
 * ~/.claude/projects/. Replaces \, /, :, and . each with -.
 *
 * E.g. "E:\Apps\termhub" → "E--Apps-termhub"
 *      "E:\Apps\termhub\.claude\worktrees\x" → "E--Apps-termhub--claude-worktrees-x"
 *      "/home/user/repo" → "-home-user-repo"
 */
export function encodeCwdForPath(cwd: string): string {
  return cwd.replace(/[\\/:.]/g, '-')
}

/**
 * Resolve the absolute path to the JSONL transcript for a session.
 * The file may not exist yet for new sessions.
 */
export function resolveJsonlPath(cwd: string, sessionId: string): string {
  const encoded = encodeCwdForPath(cwd)
  return path.join(os.homedir(), '.claude', 'projects', encoded, `${sessionId}.jsonl`)
}

// ---------------------------------------------------------------------------
// Internal parsing types
// ---------------------------------------------------------------------------

type RawServerToolUse = {
  web_search_requests?: unknown
  web_fetch_requests?: unknown
}

type RawUsage = {
  input_tokens?: unknown
  cache_creation_input_tokens?: unknown
  cache_read_input_tokens?: unknown
  output_tokens?: unknown
  server_tool_use?: RawServerToolUse
}

type AssistantTurnData = {
  inputTokens: number
  cacheCreateTokens: number
  cacheReadTokens: number
  outputTokens: number
  webSearches: number
  webFetches: number
  model: string | null
}

function toNum(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? Math.max(0, v) : 0
}

/**
 * Parse a single JSONL line. Returns data if it's an assistant turn with usage,
 * null otherwise (including malformed lines and non-assistant types).
 */
export function parseAssistantLine(line: string): AssistantTurnData | null {
  let obj: unknown
  try {
    obj = JSON.parse(line)
  } catch {
    return null
  }
  if (!obj || typeof obj !== 'object') return null
  const rec = obj as Record<string, unknown>
  if (rec['type'] !== 'assistant') return null

  const message = rec['message']
  if (!message || typeof message !== 'object') return null
  const msg = message as Record<string, unknown>

  const usage = msg['usage'] as RawUsage | undefined
  if (!usage || typeof usage !== 'object') return null

  const model = typeof msg['model'] === 'string' ? msg['model'] : null
  const stu = usage.server_tool_use as RawServerToolUse | undefined

  return {
    inputTokens: toNum(usage.input_tokens),
    cacheCreateTokens: toNum(usage.cache_creation_input_tokens),
    cacheReadTokens: toNum(usage.cache_read_input_tokens),
    outputTokens: toNum(usage.output_tokens),
    webSearches: toNum(stu?.web_search_requests),
    webFetches: toNum(stu?.web_fetch_requests),
    model,
  }
}

// ---------------------------------------------------------------------------
// Incremental parse state
// ---------------------------------------------------------------------------

export type UsageParseState = {
  /** Byte offset into the JSONL file — next read starts here. */
  fileOffset: number
  turns: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreateTokens: number
  webFetches: number
  webSearches: number
  lastModel: string | null
  /** Total input tokens for the last assistant turn (context window proxy). */
  lastContextUsed: number
}

export function makeEmptyParseState(): UsageParseState {
  return {
    fileOffset: 0,
    turns: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    webFetches: 0,
    webSearches: 0,
    lastModel: null,
    lastContextUsed: 0,
  }
}

/**
 * Accumulate assistant-turn data from `text` (one or more complete newline-
 * separated JSONL lines) into `state`. Mutates state in place.
 */
export function accumulate(text: string, state: UsageParseState): void {
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const data = parseAssistantLine(trimmed)
    if (!data) continue
    state.turns++
    state.inputTokens += data.inputTokens
    state.outputTokens += data.outputTokens
    state.cacheReadTokens += data.cacheReadTokens
    state.cacheCreateTokens += data.cacheCreateTokens
    state.webFetches += data.webFetches
    state.webSearches += data.webSearches
    if (data.model) state.lastModel = data.model
    // Context window = all input tokens consumed in this turn
    state.lastContextUsed = data.cacheReadTokens + data.cacheCreateTokens + data.inputTokens
  }
}

/**
 * Read the JSONL file from `state.fileOffset` onward, parse any new complete
 * lines, and return an updated state.
 *
 * Returns null if the file doesn't exist.
 * Returns the same state object (reference-equal) if there is nothing new.
 */
export function readJsonlIncremental(
  jsonlPath: string,
  state: UsageParseState,
): UsageParseState | null {
  let fd: number
  try {
    fd = fs.openSync(jsonlPath, 'r')
  } catch {
    return null
  }

  try {
    const stat = fs.fstatSync(fd)
    const fileSize = stat.size

    if (fileSize <= state.fileOffset) return state

    const toRead = fileSize - state.fileOffset
    const buf = Buffer.allocUnsafe(toRead)
    const bytesRead = fs.readSync(fd, buf, 0, toRead, state.fileOffset)
    const text = buf.subarray(0, bytesRead).toString('utf8')

    // Only process up to the last complete line so we don't parse a line that
    // is still being written.
    const lastNl = text.lastIndexOf('\n')
    if (lastNl === -1) return state

    const completeText = text.slice(0, lastNl)
    const processedBytes = Buffer.byteLength(text.slice(0, lastNl + 1), 'utf8')

    const newState: UsageParseState = { ...state, fileOffset: state.fileOffset + processedBytes }
    accumulate(completeText, newState)
    return newState
  } finally {
    fs.closeSync(fd)
  }
}

/** Build a `SessionUsage` snapshot from the current parse state. */
export function buildSummary(state: UsageParseState, jsonlPath: string): SessionUsage {
  const model = state.lastModel
  const maxCtx = getModelContextMax(model)
  const used = state.lastContextUsed
  const percent = maxCtx && maxCtx > 0 ? used / maxCtx : 0

  const cacheTotal = state.cacheReadTokens + state.cacheCreateTokens
  const cacheHitRate = cacheTotal > 0 ? state.cacheReadTokens / cacheTotal : 0

  return {
    contextWindow: {
      used,
      max: maxCtx ?? 0,
      percent,
    },
    cumulative: {
      inputTokens: state.inputTokens,
      outputTokens: state.outputTokens,
      cacheReadTokens: state.cacheReadTokens,
      cacheCreateTokens: state.cacheCreateTokens,
    },
    cacheHitRate,
    webFetches: state.webFetches,
    webSearches: state.webSearches,
    turns: state.turns,
    model,
    jsonlPath,
  }
}
