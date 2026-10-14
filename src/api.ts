import { isRecord } from "./guard";
import { BlockHash, BlockKind } from "./blocks";
import { Span, parseSpanRole } from "./spans";

export interface ApiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  readonly disableThinking?: boolean;
}

export interface ClassifyItem {
  readonly hash: BlockHash;
  readonly kind: BlockKind;
  readonly text: string;
  readonly context: readonly string[];
}

export type ClassifyFailure = { reason: "http" | "parse" | "aborted"; detail?: string };

export type ClassifyResult =
  | { ok: true; items: readonly { hash: BlockHash; spans: readonly Span[] }[] }
  | { ok: false; failure: ClassifyFailure };

export interface HttpRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export type HttpTransport = (req: HttpRequest) => Promise<{ status: number; body: string }>;

const ITEM_CHAR_LIMIT = 4000;
const QUOTE_CHAR_LIMIT = 300;
const PER_BLOCK_CAP = 8;

const SYSTEM_PROMPT = [
  "You annotate note blocks so a reader can scan what matters.",
  "For each block, copy VERBATIM substrings of the block text and tag them:",
  "kp = the one or two sentences that carry the block's point (the claim, judgment, or takeaway);",
  "term = domain keywords worth remembering, short phrases only;",
  "concept = named concepts, models, methods, or laws.",
  "Rules: quotes must be copied exactly from the block, 300 chars max each, at most 8 spans per block,",
  "kp only when the block truly has one, terms and concepts only when central to the note's topic.",
  "Answer with JSON only: {\"blocks\": [{\"i\": <block number>, \"spans\": [{\"quote\": \"...\", \"role\": \"kp|term|concept\"}]}]}",
].join("\n");

export function buildClassifyBody(api: ApiConfig, items: readonly ClassifyItem[]): string {
  const parts = items.map((item, n) => {
    const text = item.text.length > ITEM_CHAR_LIMIT ? item.text.slice(0, ITEM_CHAR_LIMIT) + "…[truncated]" : item.text;
    const ctx = item.context.length > 0 ? ` (section: ${item.context.join(" > ")})` : "";
    return `[${n + 1}]${ctx}\n${text}`;
  });
  const body: Record<string, unknown> = {
    model: api.model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Annotate each block. Blocks:\n\n${parts.join("\n\n")}\n\nAnswer: {"blocks": [...]}` },
    ],
  };
  if (api.disableThinking === true) body.thinking = { type: "disabled" };
  return JSON.stringify(body);
}

export function parseClassifyResponse(raw: unknown, items: readonly ClassifyItem[]): ClassifyResult {
  const content = extractContent(raw);
  if (content === null) return { ok: false, failure: { reason: "parse", detail: "no message content" } };
  const jsonText = stripFences(content);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    return { ok: false, failure: { reason: "parse", detail: String(e) } };
  }
  const blocks = extractBlocks(parsed);
  if (blocks === null) return { ok: false, failure: { reason: "parse", detail: "no blocks array" } };
  const out: { hash: BlockHash; spans: Span[] }[] = [];
  for (const entry of blocks) {
    if (!isRecord(entry)) continue;
    const i = entry.i;
    if (typeof i !== "number" || !Number.isInteger(i)) continue;
    if (!Array.isArray(entry.spans)) continue;
    const item = items[i - 1];
    if (item === undefined) continue;
    const spans: Span[] = [];
    for (const s of entry.spans) {
      if (!isRecord(s)) continue;
      const quote = typeof s.quote === "string" ? s.quote.trim().slice(0, QUOTE_CHAR_LIMIT) : "";
      const role = parseSpanRole(s.role);
      if (quote === "" || role === null) continue;
      spans.push({ quote, role });
    }
    if (spans.length > PER_BLOCK_CAP) spans.length = PER_BLOCK_CAP;
    if (spans.length > 0) out.push({ hash: item.hash, spans });
  }
  return { ok: true, items: out };
}

function extractContent(raw: unknown): string | null {
  if (typeof raw === "string") return raw;
  if (!isRecord(raw) || !Array.isArray(raw.choices) || raw.choices.length === 0) return null;
  const first = raw.choices[0];
  if (!isRecord(first) || !isRecord(first.message)) return null;
  const content = first.message.content;
  return typeof content === "string" ? content : null;
}

function stripFences(text: string): string {
  const t = text.trim();
  if (t.startsWith("```")) {
    const firstNl = t.indexOf("\n");
    const lastFence = t.lastIndexOf("```");
    if (firstNl !== -1 && lastFence > firstNl) return t.slice(firstNl + 1, lastFence);
  }
  return t;
}

function extractBlocks(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (typeof parsed === "object" && parsed !== null && "blocks" in parsed && Array.isArray(parsed.blocks)) {
    return parsed.blocks;
  }
  return null;
}

export async function classifyViaApi(
  api: ApiConfig,
  items: readonly ClassifyItem[],
  signal: AbortSignal | null,
  transport: HttpTransport,
): Promise<ClassifyResult> {
  if (signal?.aborted) return { ok: false, failure: { reason: "aborted" } };
  const url = `${api.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  let res: { status: number; body: string };
  try {
    res = await transport({
      url,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${api.apiKey}` },
      body: buildClassifyBody(api, items),
    });
  } catch (e) {
    if (signal?.aborted) return { ok: false, failure: { reason: "aborted" } };
    return { ok: false, failure: { reason: "http", detail: String(e) } };
  }
  if (signal?.aborted) return { ok: false, failure: { reason: "aborted" } };
  if (res.status < 200 || res.status >= 300) {
    return { ok: false, failure: { reason: "http", detail: `status ${res.status}: ${res.body.slice(0, 200)}` } };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(res.body);
  } catch (e) {
    return { ok: false, failure: { reason: "parse", detail: String(e) } };
  }
  return parseClassifyResponse(raw, items);
}

export async function probeApi(api: ApiConfig, transport: HttpTransport): Promise<{ ok: true; model: string } | { ok: false; failure: ClassifyFailure }> {
  const url = `${api.baseUrl.replace(/\/+$/, "")}/models`;
  try {
    const res = await transport({ url, headers: { Authorization: `Bearer ${api.apiKey}` }, body: "" });
    if (res.status < 200 || res.status >= 300) {
      return { ok: false, failure: { reason: "http", detail: `status ${res.status}` } };
    }
    return { ok: true, model: api.model };
  } catch (e) {
    return { ok: false, failure: { reason: "http", detail: String(e) } };
  }
}
