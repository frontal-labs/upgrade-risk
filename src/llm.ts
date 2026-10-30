import { createHash } from 'node:crypto'
import type { Cache } from './cache'
import type { NoteSection, ProseBreaking } from './extract'

export const DEFAULT_LLM_MODEL = 'claude-sonnet-5-5'

/** Sends one prompt to a model and returns its text reply. Injected so tests never call the API. */
export type Complete = (args: { model: string; prompt: string }) => Promise<string>

export interface LlmOptions {
  complete: Complete
  model: string
  cache: Cache
}

const PROMPT = `You extract breaking changes from software release notes.
Return only JSON of the form {"items":[{"summary":"...","quote":"...","symbols":["..."]}]}.
Rules:
- Include only changes that can break a user's code or build: removed or renamed APIs, changed signatures, dropped runtime or Node versions, changed required config.
- "quote" must be a line copied character for character from the notes below. Do not paraphrase.
- "symbols" lists API names the change touches (e.g. "parse", "defineConfig"). Use [] when none.
- If nothing is breaking, return {"items":[]}.

Notes:
`

/** Parses the model reply, tolerating prose around the JSON object. */
export function parseItems(
  reply: string,
): Array<{ summary: string; quote: string; symbols: string[] }> {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start === -1 || end <= start) return []
  try {
    const parsed = JSON.parse(reply.slice(start, end + 1)) as { items?: unknown }
    if (!Array.isArray(parsed.items)) return []
    return parsed.items.flatMap((item) => {
      if (typeof item !== 'object' || item === null) return []
      const { summary, quote, symbols } = item as Record<string, unknown>
      if (typeof summary !== 'string' || typeof quote !== 'string') return []
      const list = Array.isArray(symbols)
        ? symbols.filter((s): s is string => typeof s === 'string')
        : []
      return [{ summary, quote, symbols: list }]
    })
  } catch {
    return []
  }
}

/**
 * Keeps only items whose quote appears word for word in the notes. An item that fails this
 * check is dropped, so the model can never invent evidence.
 */
export function verifyItems(
  items: Array<{ summary: string; quote: string; symbols: string[] }>,
  section: NoteSection,
): ProseBreaking[] {
  const lines = new Set(section.text.split(/\r?\n/).map((line) => line.trim()))
  return items
    .map((item) => ({ ...item, quote: item.quote.trim() }))
    .filter((item) => item.quote !== '' && lines.has(item.quote))
    .map((item) => ({
      summary: item.summary.slice(0, 200),
      source: 'llm' as const,
      evidence: section.evidence,
      quote: item.quote,
      // Symbols are only kept when the quoted line itself mentions them.
      symbols: item.symbols.filter((symbol) => item.quote.includes(symbol)),
    }))
}

/** LLM extraction over release notes. Output is verified against the notes before use. */
export async function extractWithLlm(
  sections: NoteSection[],
  options: LlmOptions,
): Promise<ProseBreaking[]> {
  const found: ProseBreaking[] = []
  for (const section of sections) {
    const digest = createHash('sha256').update(section.text).digest('hex')
    const key = `llm:${options.model}:${digest}`
    const reply = await options.cache.memo(key, () =>
      options.complete({ model: options.model, prompt: `${PROMPT}${section.text}` }),
    )
    found.push(...verifyItems(parseItems(reply), section))
  }
  return found
}

/** Calls the Anthropic Messages API. Needs ANTHROPIC_API_KEY. */
export function anthropicComplete(apiKey: string): Complete {
  return async ({ model, prompt }) => {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (!response.ok) throw new Error(`Anthropic API ${response.status}`)
    const body = (await response.json()) as { content?: Array<{ type: string; text?: string }> }
    return body.content?.find((block) => block.type === 'text')?.text ?? ''
  }
}
