import { lintSource } from '@secretlint/core'
import { creator as awsCreator } from '@secretlint/secretlint-rule-aws'
import { creator as githubCreator } from '@secretlint/secretlint-rule-github'
import { creator as openaiCreator } from '@secretlint/secretlint-rule-openai'
import { creator as anthropicCreator } from '@secretlint/secretlint-rule-anthropic'
import { creator as patternCreator } from '@secretlint/secretlint-rule-pattern'
import type { SecretFinding } from '../src/types'

// Loaded once at module init — the creator objects are stateless.
// Rules: aws, github, openai, anthropic (all native rule packs), plus a
// pattern rule for high-entropy base64-like tokens not covered by the above.
const RULES = [
  // enableIDScanRule catches bare AKIA* access key IDs (off by default
  // upstream to reduce false positives, but appropriate for clipboard scanning).
  { id: '@secretlint/secretlint-rule-aws', rule: awsCreator, options: { enableIDScanRule: true } },
  { id: '@secretlint/secretlint-rule-github', rule: githubCreator },
  { id: '@secretlint/secretlint-rule-openai', rule: openaiCreator },
  { id: '@secretlint/secretlint-rule-anthropic', rule: anthropicCreator },
  {
    id: '@secretlint/secretlint-rule-pattern',
    rule: patternCreator,
    options: {
      patterns: [
        {
          name: 'HighEntropyToken',
          // 48+ contiguous base64 chars — catches generic API tokens that
          // don't match a known-prefix rule. 48 chars avoids UUIDs (32 hex)
          // and short base64 blobs while still catching most bearer tokens.
          patterns: ['/[A-Za-z0-9+/]{48,}={0,2}/'],
        },
      ],
    },
  },
]

export async function scanForSecrets(text: string): Promise<SecretFinding[]> {
  console.info(`[termhub:paste-filter] scanning ${text.length} chars for secrets`)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await lintSource({
    source: {
      content: text,
      filePath: 'clipboard.txt',
      ext: '.txt',
      contentType: 'text',
    },
    options: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      config: { rules: RULES as any },
      locale: 'en',
      maskSecrets: false,
    },
  })

  const findings: SecretFinding[] = result.messages.map((msg) => ({
    ruleId: msg.ruleId,
    message: msg.message,
    // Extract matched text from range so the dialog can show a truncated snippet.
    // Never log this value — it may be a real secret.
    matchedText: text.slice(msg.range[0], msg.range[1]),
  }))

  console.info(`[termhub:paste-filter] scan complete — ${findings.length} finding(s)`)
  if (findings.length > 0) {
    const ruleIds = [...new Set(findings.map((f) => f.ruleId))].join(', ')
    console.warn(`[termhub:paste-filter] secrets detected — rules triggered: ${ruleIds}`)
  }

  return findings
}
