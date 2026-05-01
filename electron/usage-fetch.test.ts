import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import {
  encodeCwdForPath,
  resolveJsonlPath,
  MODEL_CONTEXT_LIMITS,
  getModelContextMax,
  parseAssistantLine,
  readJsonlIncremental,
  buildSummary,
  makeEmptyParseState,
} from './usage-fetch'

// ---------------------------------------------------------------------------
// Path resolver
// ---------------------------------------------------------------------------

describe('encodeCwdForPath', () => {
  it('encodes a Windows path with drive letter', () => {
    expect(encodeCwdForPath('E:\\Apps\\termhub')).toBe('E--Apps-termhub')
  })

  it('encodes a nested Windows path', () => {
    expect(encodeCwdForPath('C:\\Users\\alex')).toBe('C--Users-alex')
  })

  it('encodes a POSIX path', () => {
    expect(encodeCwdForPath('/home/user/repo')).toBe('-home-user-repo')
  })

  it('handles a root drive path', () => {
    expect(encodeCwdForPath('D:\\')).toBe('D--')
  })

  it('encodes dots in path segments (hidden directories like .claude)', () => {
    expect(
      encodeCwdForPath('E:\\Apps\\termhub\\.claude\\worktrees\\my-feature'),
    ).toBe('E--Apps-termhub--claude-worktrees-my-feature')
  })

  it('encodes dots in POSIX hidden directories', () => {
    expect(encodeCwdForPath('/home/user/.config')).toBe('-home-user--config')
  })
})

describe('resolveJsonlPath', () => {
  it('builds the correct path for a Windows cwd', () => {
    const result = resolveJsonlPath('E:\\Apps\\termhub', 'abc-123')
    const expected = path.join(os.homedir(), '.claude', 'projects', 'E--Apps-termhub', 'abc-123.jsonl')
    expect(result).toBe(expected)
  })

  it('builds the correct path for a POSIX cwd', () => {
    const result = resolveJsonlPath('/home/user/repo', 'def-456')
    const expected = path.join(os.homedir(), '.claude', 'projects', '-home-user-repo', 'def-456.jsonl')
    expect(result).toBe(expected)
  })
})

// ---------------------------------------------------------------------------
// Model context limits
// ---------------------------------------------------------------------------

describe('getModelContextMax', () => {
  it('returns the correct limit for a known model', () => {
    expect(getModelContextMax('claude-sonnet-4-6')).toBe(200_000)
    expect(getModelContextMax('claude-haiku-4-5-20251001')).toBe(200_000)
    expect(getModelContextMax('claude-opus-4-7')).toBe(1_000_000)
  })

  it('returns null for an unknown model', () => {
    expect(getModelContextMax('some-future-model-xyz')).toBeNull()
  })

  it('returns null when model is null', () => {
    expect(getModelContextMax(null)).toBeNull()
  })

  it('covers every model in MODEL_CONTEXT_LIMITS', () => {
    for (const [model, limit] of Object.entries(MODEL_CONTEXT_LIMITS)) {
      expect(getModelContextMax(model)).toBe(limit)
    }
  })
})

// ---------------------------------------------------------------------------
// parseAssistantLine
// ---------------------------------------------------------------------------

const ASSISTANT_LINE = JSON.stringify({
  type: 'assistant',
  message: {
    model: 'claude-sonnet-4-6',
    role: 'assistant',
    usage: {
      input_tokens: 10,
      cache_creation_input_tokens: 5000,
      cache_read_input_tokens: 100000,
      output_tokens: 800,
      server_tool_use: { web_search_requests: 1, web_fetch_requests: 2 },
    },
  },
})

describe('parseAssistantLine', () => {
  it('parses a valid assistant line', () => {
    const result = parseAssistantLine(ASSISTANT_LINE)
    expect(result).toEqual({
      inputTokens: 10,
      cacheCreateTokens: 5000,
      cacheReadTokens: 100000,
      outputTokens: 800,
      webSearches: 1,
      webFetches: 2,
      model: 'claude-sonnet-4-6',
    })
  })

  it('returns null for a non-assistant type', () => {
    const line = JSON.stringify({ type: 'user', message: { role: 'user' } })
    expect(parseAssistantLine(line)).toBeNull()
  })

  it('returns null for malformed JSON', () => {
    expect(parseAssistantLine('{ not valid json')).toBeNull()
  })

  it('returns null when usage is missing', () => {
    const line = JSON.stringify({ type: 'assistant', message: { model: 'x', role: 'assistant' } })
    expect(parseAssistantLine(line)).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(parseAssistantLine('')).toBeNull()
  })

  it('treats missing server_tool_use fields as zero', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 5, output_tokens: 10 },
      },
    })
    const result = parseAssistantLine(line)
    expect(result?.webSearches).toBe(0)
    expect(result?.webFetches).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Cache hit rate via buildSummary
// ---------------------------------------------------------------------------

describe('cache hit rate', () => {
  it('computes correct cache hit rate', () => {
    const state = makeEmptyParseState()
    state.cacheReadTokens = 900
    state.cacheCreateTokens = 100
    const summary = buildSummary(state, '/path/to/file.jsonl')
    expect(summary.cacheHitRate).toBeCloseTo(0.9)
  })

  it('returns 0 when no cache activity (denominator zero)', () => {
    const state = makeEmptyParseState()
    state.cacheReadTokens = 0
    state.cacheCreateTokens = 0
    const summary = buildSummary(state, '/path')
    expect(summary.cacheHitRate).toBe(0)
    expect(isNaN(summary.cacheHitRate)).toBe(false)
  })

  it('returns 0 cache hit rate when only creates (no reads)', () => {
    const state = makeEmptyParseState()
    state.cacheCreateTokens = 5000
    const summary = buildSummary(state, '/path')
    expect(summary.cacheHitRate).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Context window percent
// ---------------------------------------------------------------------------

describe('context window percent threshold colors (via buildSummary)', () => {
  it('returns percent < 0.60 for low usage', () => {
    const state = makeEmptyParseState()
    state.lastModel = 'claude-sonnet-4-6'
    state.lastContextUsed = 100_000  // 50% of 200K
    const summary = buildSummary(state, '/path')
    expect(summary.contextWindow.percent).toBeCloseTo(0.5)
  })

  it('returns percent >= 0.60 for medium usage', () => {
    const state = makeEmptyParseState()
    state.lastModel = 'claude-sonnet-4-6'
    state.lastContextUsed = 140_000  // 70% of 200K
    const summary = buildSummary(state, '/path')
    expect(summary.contextWindow.percent).toBeCloseTo(0.7)
  })

  it('returns percent >= 0.80 for high usage', () => {
    const state = makeEmptyParseState()
    state.lastModel = 'claude-sonnet-4-6'
    state.lastContextUsed = 170_000  // 85% of 200K
    const summary = buildSummary(state, '/path')
    expect(summary.contextWindow.percent).toBeCloseTo(0.85)
  })

  it('returns max=0 and percent=0 for unknown model', () => {
    const state = makeEmptyParseState()
    state.lastModel = 'unknown-model'
    state.lastContextUsed = 50_000
    const summary = buildSummary(state, '/path')
    expect(summary.contextWindow.max).toBe(0)
    expect(summary.contextWindow.percent).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// JSONL file parsing (incremental reads with temp files)
// ---------------------------------------------------------------------------

const tmpFiles: string[] = []

function writeTmpJsonl(lines: unknown[]): string {
  const filePath = path.join(os.tmpdir(), `usage-test-${Math.random().toString(36).slice(2)}.jsonl`)
  fs.writeFileSync(filePath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8')
  tmpFiles.push(filePath)
  return filePath
}

afterEach(() => {
  for (const f of tmpFiles) {
    try { fs.unlinkSync(f) } catch { /* ignore */ }
  }
  tmpFiles.length = 0
})

function makeAssistantEntry(overrides: Partial<{
  inputTokens: number
  cacheCreate: number
  cacheRead: number
  outputTokens: number
  webSearch: number
  webFetch: number
  model: string
}> = {}) {
  return {
    type: 'assistant',
    message: {
      model: overrides.model ?? 'claude-sonnet-4-6',
      role: 'assistant',
      usage: {
        input_tokens: overrides.inputTokens ?? 10,
        cache_creation_input_tokens: overrides.cacheCreate ?? 1000,
        cache_read_input_tokens: overrides.cacheRead ?? 50000,
        output_tokens: overrides.outputTokens ?? 500,
        server_tool_use: {
          web_search_requests: overrides.webSearch ?? 0,
          web_fetch_requests: overrides.webFetch ?? 0,
        },
      },
    },
  }
}

describe('readJsonlIncremental', () => {
  it('returns null when the file does not exist', () => {
    const state = makeEmptyParseState()
    const result = readJsonlIncremental('/nonexistent/path/abc.jsonl', state)
    expect(result).toBeNull()
  })

  it('parses zero assistant turns and returns zeros', () => {
    const filePath = writeTmpJsonl([
      { type: 'user', message: { role: 'user', content: 'hi' } },
      { type: 'agent-setting', agentSetting: 'termhub' },
    ])
    const state = makeEmptyParseState()
    const result = readJsonlIncremental(filePath, state)
    expect(result).not.toBeNull()
    expect(result!.turns).toBe(0)
    expect(result!.outputTokens).toBe(0)
  })

  it('parses N assistant turns and returns correct sums', () => {
    const filePath = writeTmpJsonl([
      { type: 'user', message: { content: 'prompt' } },
      makeAssistantEntry({ outputTokens: 300, cacheCreate: 2000, cacheRead: 10000 }),
      { type: 'user', message: { content: 'follow-up' } },
      makeAssistantEntry({ outputTokens: 500, cacheCreate: 0, cacheRead: 12000 }),
    ])
    const state = makeEmptyParseState()
    const result = readJsonlIncremental(filePath, state)!
    expect(result.turns).toBe(2)
    expect(result.outputTokens).toBe(800)
    expect(result.cacheCreateTokens).toBe(2000)
    expect(result.cacheReadTokens).toBe(22000)
  })

  it('skips malformed lines without crashing', () => {
    const filePath = path.join(
      os.tmpdir(),
      `usage-test-malformed-${Math.random().toString(36).slice(2)}.jsonl`,
    )
    const validLine = JSON.stringify(makeAssistantEntry({ outputTokens: 100 }))
    // Write one valid, one malformed, one valid
    fs.writeFileSync(filePath, `${validLine}\n{ broken json\n${validLine}\n`, 'utf8')
    tmpFiles.push(filePath)

    const state = makeEmptyParseState()
    const result = readJsonlIncremental(filePath, state)!
    expect(result.turns).toBe(2)
    expect(result.outputTokens).toBe(200)
  })

  it('skips assistant lines missing usage', () => {
    const noUsageLine = { type: 'assistant', message: { model: 'x', role: 'assistant' } }
    const filePath = writeTmpJsonl([noUsageLine, makeAssistantEntry({ outputTokens: 200 })])
    const state = makeEmptyParseState()
    const result = readJsonlIncremental(filePath, state)!
    expect(result.turns).toBe(1)
    expect(result.outputTokens).toBe(200)
  })

  it('returns unchanged state when file has not grown', () => {
    const filePath = writeTmpJsonl([makeAssistantEntry()])
    const state = makeEmptyParseState()
    const first = readJsonlIncremental(filePath, state)!

    // Second call with updated offset — file unchanged
    const second = readJsonlIncremental(filePath, first)
    expect(second).toBe(first)  // same reference — no re-parse
  })

  it('reads only new lines on incremental calls', () => {
    const filePath = path.join(
      os.tmpdir(),
      `usage-test-incremental-${Math.random().toString(36).slice(2)}.jsonl`,
    )
    tmpFiles.push(filePath)

    const line1 = JSON.stringify(makeAssistantEntry({ outputTokens: 100 }))
    fs.writeFileSync(filePath, `${line1}\n`, 'utf8')

    const state = makeEmptyParseState()
    const afterFirst = readJsonlIncremental(filePath, state)!
    expect(afterFirst.turns).toBe(1)
    expect(afterFirst.outputTokens).toBe(100)

    // Append a second line
    const line2 = JSON.stringify(makeAssistantEntry({ outputTokens: 200 }))
    fs.appendFileSync(filePath, `${line2}\n`, 'utf8')

    const afterSecond = readJsonlIncremental(filePath, afterFirst)!
    expect(afterSecond.turns).toBe(2)
    expect(afterSecond.outputTokens).toBe(300)
  })

  it('tracks the last model seen', () => {
    const filePath = writeTmpJsonl([
      makeAssistantEntry({ model: 'claude-opus-4-7' }),
      makeAssistantEntry({ model: 'claude-sonnet-4-6' }),
    ])
    const state = makeEmptyParseState()
    const result = readJsonlIncremental(filePath, state)!
    expect(result.lastModel).toBe('claude-sonnet-4-6')
  })

  it('accumulates web search and fetch counts', () => {
    const filePath = writeTmpJsonl([
      makeAssistantEntry({ webSearch: 2, webFetch: 1 }),
      makeAssistantEntry({ webSearch: 0, webFetch: 3 }),
    ])
    const state = makeEmptyParseState()
    const result = readJsonlIncremental(filePath, state)!
    expect(result.webSearches).toBe(2)
    expect(result.webFetches).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// buildSummary
// ---------------------------------------------------------------------------

describe('buildSummary', () => {
  it('includes the jsonlPath verbatim', () => {
    const state = makeEmptyParseState()
    const summary = buildSummary(state, '/some/path/session.jsonl')
    expect(summary.jsonlPath).toBe('/some/path/session.jsonl')
  })

  it('computes contextWindow.used as lastContextUsed', () => {
    const state = makeEmptyParseState()
    state.lastModel = 'claude-sonnet-4-6'
    state.lastContextUsed = 80_000
    const summary = buildSummary(state, '/p')
    expect(summary.contextWindow.used).toBe(80_000)
    expect(summary.contextWindow.max).toBe(200_000)
    expect(summary.contextWindow.percent).toBeCloseTo(0.4)
  })

  it('sets max=0 and percent=0 when model is null', () => {
    const state = makeEmptyParseState()
    state.lastContextUsed = 50_000
    const summary = buildSummary(state, '/p')
    expect(summary.contextWindow.max).toBe(0)
    expect(summary.contextWindow.percent).toBe(0)
  })
})
