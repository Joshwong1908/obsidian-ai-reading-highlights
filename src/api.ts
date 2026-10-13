import { BlockHash, BlockKind } from "./blocks";
import { parseRole, Role } from "./roles";

export interface ApiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ClassifyItem {
  readonly hash: BlockHash;
  readonly kind: BlockKind;
  readonly text: string;
  readonly context: readonly string[];
}

export type ClassifyFailure = { reason: "http" | "parse" | "aborted"; detail?: string };

export type ClassifyResult =
  | { ok: true; items: readonly { hash: BlockHash; role: Role }[] }
  | { ok: false; failure: ClassifyFailure };

export interface HttpRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export type HttpTransport = (req: HttpRequest) => Promise<{ status: number; body: string }>;

const ITEM_CHAR_LIMIT = 4000;

const SYSTEM_PROMPT = [
  "You label note blocks with one semantic role to help a reader scan dense notes.",
  "Roles: claim = the conclusion or judgment the note argues for; evidence = sourced findings, experiments, numbers with provenance;",
  "caveat = boundary conditions, limitations, failure modes; question = an open question or thing to verify; definition = defines a term or mental model.",
  "Judge the DOMINANT role of each block. When no role fits, omit the block.",
  "Answer with a JSON array only, no prose: [{\"i\": <block number>, \"role\": \"claim|evidence|caveat|question|definition\"}]",
].join("\n");

export function buildClassifyBody(api: ApiConfig, items: readonly ClassifyItem[]): string {
  const parts = items.map((item, n) => {
    const text = item.text.length > ITEM_CHAR_LIMIT ? item.text.slice(0, ITEM_CHAR_LIMIT) + "…[truncated]" : item.text;
    const ctx = item.context.length > 0 ? ` (section: ${item.context.join(" > ")})` : "";
    return `[${n + 1}]${ctx}\n${text}`;
  });
  return JSON.stringify({
    model: api.model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Label each block. Blocks:\n\n${parts.join("\n\n")}\n\nAnswer: {"labels": [{"i": 1, "role": "..."}]}` },
    ],
  });
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
  const labels = extractLabels(parsed);
  if (labels === null) return { ok: false, failure: { reason: "parse", detail: "no labels array" } };
  const out: { hash: BlockHash; role: Role }[] = [];
  for (const label of labels) {
    if (typeof label !== "object" || label === null) continue;
    if (!("i" in label) || !("role" in label)) continue;
    const i = label.i;
    const role = parseRole(label.role);
    if (typeof i !== "number" || !Number.isInteger(i) || role === null) continue;
    const item = items[i - 1];
    if (item === undefined) continue;
    out.push({ hash: item.hash, role });
  }
  return { ok: true, items: out };
}

function extractContent(raw: unknown): string | null {
  if (typeof raw === "string") return raw;
  if (typeof raw !== "object" || raw === null || !("choices" in raw)) return null;
  if (!Array.isArray(raw.choices) || raw.choices.length === 0) return null;
  const first = raw.choices[0];
  if (typeof first !== "object" || first === null || !("message" in first)) return null;
  const message = first.message;
  if (typeof message !== "object" || message === null || !("content" in message)) return null;
  const content = message.content;
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

function extractLabels(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (typeof parsed === "object" && parsed !== null && "labels" in parsed && Array.isArray(parsed.labels)) {
    return parsed.labels;
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
