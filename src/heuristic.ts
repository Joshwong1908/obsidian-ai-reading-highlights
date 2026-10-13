import { BlockHash, BlockRef, isClassifiable } from "./blocks";
import { Span } from "./spans";

export interface BlockSpans {
  readonly hash: BlockHash;
  readonly spans: readonly Span[];
}

const BOLD_RE = /\*\*([^*]+)\*\*/g;
const QUOTED_RE = /[「“]([^」”]{1,40})[」”]/g;
const CODE_RE = /`([^`]{1,40})`/g;

function collect(text: string, re: RegExp, role: Span["role"], cap: number): Span[] {
  const spans: Span[] = [];
  for (const m of text.matchAll(re)) {
    const quote = m[1]?.trim() ?? "";
    if (quote === "") continue;
    spans.push({ quote, role });
    if (spans.length >= cap) break;
  }
  return spans;
}

export function heuristicSpans(blocks: readonly BlockRef[]): readonly BlockSpans[] {
  const out: BlockSpans[] = [];
  for (const b of blocks) {
    if (!isClassifiable(b.kind)) continue;
    const spans = [...collect(b.text, BOLD_RE, "kp", 2), ...collect(b.text, QUOTED_RE, "term", 3), ...collect(b.text, CODE_RE, "term", 2)];
    if (spans.length > 0) out.push({ hash: b.hash, spans });
  }
  return out;
}
