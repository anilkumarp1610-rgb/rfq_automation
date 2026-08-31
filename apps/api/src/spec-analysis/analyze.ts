import Anthropic from '@anthropic-ai/sdk';
import { specExtractResult, SpecExtractResult } from '@rfq/shared';
import { SPEC_SYSTEM_PROMPT, SPEC_USER_PROMPT } from './prompt.js';
import { mockExtraction } from './mock.js';

const MODEL = process.env.SPEC_MODEL || 'claude-opus-5';

/** True when a usable Anthropic key is configured. */
export function aiConfigured(): boolean {
  const k = process.env.ANTHROPIC_API_KEY?.trim();
  return !!k && k.length > 10 && k.startsWith('sk-ant-');
}

type ImageMedia = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
type Source =
  | { kind: 'pdf'; base64: string }
  | { kind: 'image'; base64: string; mediaType: ImageMedia };

const IMAGE_TYPES: ImageMedia[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export function sourceFromUpload(buffer: Buffer, mime: string): Source {
  if (mime === 'application/pdf') return { kind: 'pdf', base64: buffer.toString('base64') };
  if (IMAGE_TYPES.includes(mime as ImageMedia)) {
    return { kind: 'image', base64: buffer.toString('base64'), mediaType: mime as ImageMedia };
  }
  throw Object.assign(new Error(`Unsupported file type "${mime}" — upload a PDF or image`), {
    status: 415,
  });
}

/** Pull the first balanced JSON object out of a model response. */
function extractJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  if (start === -1) throw new Error('Model returned no JSON object');
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      return JSON.parse(text.slice(start, i + 1));
    }
  }
  throw new Error('Model returned an unterminated JSON object');
}

export interface AnalyzeResult extends SpecExtractResult {
  /** true when the result is a local stub, not a model call */
  mock: boolean;
}

/**
 * Send the drawing to Claude (vision/document) and return validated
 * `{ header, items, flags }`. Falls back to a deterministic stub when no API
 * key is configured so the rest of the flow stays exercisable in dev.
 */
export async function analyzeDrawing(
  buffer: Buffer,
  mime: string,
  hint?: { partNumber?: string; revision?: string }
): Promise<AnalyzeResult> {
  const source = sourceFromUpload(buffer, mime);

  if (!aiConfigured()) {
    return { ...mockExtraction(hint), mock: true };
  }

  const client = new Anthropic();
  const docBlock: Anthropic.ContentBlockParam =
    source.kind === 'pdf'
      ? {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: source.base64 },
        }
      : {
          type: 'image',
          source: { type: 'base64', media_type: source.mediaType, data: source.base64 },
        };

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: SPEC_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: [docBlock, { type: 'text', text: SPEC_USER_PROMPT }] }],
  });

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');

  const parsed = specExtractResult.safeParse(extractJsonObject(text));
  if (!parsed.success) {
    throw Object.assign(new Error('Model output did not match the spec schema'), {
      status: 502,
      details: parsed.error.issues,
    });
  }
  return { ...parsed.data, mock: false };
}
