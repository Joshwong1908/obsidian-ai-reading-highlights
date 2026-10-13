export const SPAN_ROLES = ["kp", "term", "concept"] as const;

export type SpanRole = (typeof SPAN_ROLES)[number];

export const SPAN_CLASS: Readonly<Record<SpanRole, string>> = {
  kp: "sr-kp",
  term: "sr-term",
  concept: "sr-concept",
};

export const SPAN_LABEL: Readonly<Record<SpanRole, string>> = {
  kp: "重点句 Keypoint",
  term: "关键词 Term",
  concept: "概念 Concept",
};

const ROLE_STRINGS: readonly string[] = SPAN_ROLES;

export function parseSpanRole(value: unknown): SpanRole | null {
  return typeof value === "string" && ROLE_STRINGS.includes(value) ? (value as SpanRole) : null;
}

export interface Span {
  readonly quote: string;
  readonly role: SpanRole;
}

export interface Loc {
  readonly from: number;
  readonly to: number;
  readonly role: SpanRole;
}

interface SigMap {
  readonly stream: string;
  readonly starts: number[];
  readonly ends: number[];
}

const NOISE = new Set(["*", "_", "`", "~", "[", "]", "(", ")", "#", ">", "|", "\u200b", "\ufeff", "\u00ad"]);

function foldChar(ch: string): string {
  return ch.normalize("NFKC").toLowerCase();
}

export function sigMap(text: string): SigMap {
  let stream = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let i = 0;
  for (const ch of text) {
    const length = ch.length;
    if (!/\s/.test(ch) && !NOISE.has(ch)) {
      for (const folded of foldChar(ch)) {
        stream += folded;
        starts.push(i);
        ends.push(i + length);
      }
    }
    i += length;
  }
  return { stream, starts, ends };
}

export function locate(text: string, quote: string, role: SpanRole): Loc | null {
  const hay = sigMap(text);
  const needle = sigMap(quote);
  if (needle.stream.length === 0 || needle.stream.length > hay.stream.length) return null;
  const at = hay.stream.indexOf(needle.stream);
  if (at === -1) return null;
  return { from: hay.starts[at]!, to: hay.ends[at + needle.stream.length - 1]!, role };
}

const PRIORITY: Readonly<Record<SpanRole, number>> = { kp: 0, term: 1, concept: 2 };

export function locateSpans(text: string, spans: readonly Span[]): Loc[] {
  const locs: Loc[] = [];
  for (const span of spans) {
    const loc = locate(text, span.quote, span.role);
    if (loc !== null) locs.push(loc);
  }
  return dedupe(locs);
}

export function dedupe(locs: readonly Loc[]): Loc[] {
  const ordered = [...locs].sort((a, b) => PRIORITY[a.role] - PRIORITY[b.role] || b.to - b.from - (a.to - a.from));
  const taken: Loc[] = [];
  for (const loc of ordered) {
    const clashes = taken.some((t) => loc.from < t.to && t.from < loc.to);
    if (!clashes) taken.push(loc);
  }
  return taken.sort((a, b) => a.from - b.from);
}
