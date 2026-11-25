import Anthropic from '@anthropic-ai/sdk';
import { specExtractResult, SpecExtractResult } from '@rfq/shared';
import { SPEC_SYSTEM_PROMPT, SPEC_USER_PROMPT } from './prompt.js';
import { mockExtraction } from './mock.js';
import { readPdfText } from './textLayer.js';
import { extractFromText } from './textExtract.js';

const MODEL = process.env.SPEC_MODEL || 'claude-opus-5';

/** True when a usable Anthropic key is configured. */
export function aiConfigured(): boolean {
  const k = process.env.ANTHROPIC_API_KEY?.trim();
  return !!k && k.length > 10 && k.startsWith('sk-ant-');
}

/**
 * The canned sample extraction (the same shaft for every file) is only for demos and automated
 * tests, and must be switched on explicitly. Without this, a missing key used to return it silently —
 * every drawing then "analysed" to identical values, which looks like a bug in the extraction.
 */
export function mockAllowed(): boolean {
  return process.env.SPEC_ALLOW_MOCK === 'true';
}

/**
 * SPEC_EXTRACTOR=text reads only the PDF's own text (free, no AI call) even when a key is set — useful while the
 * Anthropic account has no credit. The default, "auto", uses the AI when a key is configured.
 */
export function textOnly(): boolean {
  return process.env.SPEC_EXTRACTOR?.trim().toLowerCase() === 'text';
}

/** What an analysis click will use right now — the Test Drawings page shows this before anyone clicks. */
export function extractionMode(): 'live' | 'text' | 'sample' {
  if (textOnly()) return 'text';
  if (aiConfigured()) return 'live';
  return mockAllowed() ? 'sample' : 'text';
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
  /** where the values came from: the AI reading, the PDF's own text layer (free), or the canned sample */
  source: 'ai' | 'text' | 'sample';
  /** model + token usage of the live call (absent for the stub) — lets the test page show cost */
  model?: string;
  usage?: { inputTokens: number; outputTokens: number };
}

/**
 * Send the drawing to Claude (vision/document) and return validated
 * `{ header, items, flags }`. Falls back to a deterministic stub when no API
 * key is configured so the rest of the flow stays exercisable in dev.
 */
export async function analyzeDrawing(
  buffer: Buffer,
  mime: string,
  hint?: { partNumber?: string; revision?: string },
  opts?: { textOnly?: boolean }
): Promise<AnalyzeResult> {
  const source = sourceFromUpload(buffer, mime);
  const mode = opts?.textOnly || textOnly() ? 'text' : aiConfigured() ? 'live' : mockAllowed() ? 'sample' : 'text';

  if (mode === 'sample') return { ...mockExtraction(hint), mock: true, source: 'sample' };

  if (mode === 'text') {
    const forced = opts?.textOnly || textOnly();
    if (source.kind !== 'pdf') {
      throw Object.assign(
        new Error(
          forced
            ? 'Text reading works on PDF files only — images need the AI reading'
            : 'AI drawing extraction is not configured — set a real ANTHROPIC_API_KEY (sk-ant-…) in apps/api/.env and restart the API (images cannot be read without it)'
        ),
        { status: forced ? 415 : 503, expose: true }
      );
    }
    try {
      return { ...extractFromText(await readPdfText(buffer), hint), mock: false, source: 'text' };
    } catch (e) {
      if (forced) throw e;
      // no key, and this PDF has no readable text either — nothing honest to return
      throw Object.assign(
        new Error(
          'AI drawing extraction is not configured — set a real ANTHROPIC_API_KEY (sk-ant-…) in apps/api/.env and restart the API. ' +
            `Reading the PDF's own text was tried instead: ${(e as Error).message}`
        ),
        { status: 503, expose: true }
      );
    }
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

  // Surface a declined or truncated response clearly instead of as a JSON-parse failure.
  if (message.stop_reason === 'refusal') {
    throw Object.assign(
      new Error('The model declined to analyze this file — check it is a genuine engineering drawing'),
      { status: 502, expose: true }
    );
  }
  if (message.stop_reason === 'max_tokens') {
    throw Object.assign(
      new Error('The drawing is too detailed for one extraction pass (model output was cut off) — try a cleaner or single-sheet file'),
      { status: 502, expose: true }
    );
  }

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');

  const parsed = specExtractResult.safeParse(extractJsonObject(text));
  if (!parsed.success) {
    throw Object.assign(new Error('Model output did not match the spec schema'), {
      status: 502,
      expose: true,
      details: parsed.error.issues,
    });
  }
  return {
    ...parsed.data,
    mock: false,
    source: 'ai',
    model: MODEL,
    usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
  };
}
