import type { MarkdownPostProcessor, MarkdownPostProcessorContext } from "obsidian";
import { BlockHash, isClassifiable, splitBlocks } from "./blocks";
import { sigMap, dedupe, Loc, SPAN_CLASS, Span, SpanRole } from "./spans";
import { AnnotationStore } from "./store";

export interface ReadingViewDeps {
  readonly store: AnnotationStore;
  readonly enabledSpans: () => ReadonlySet<SpanRole>;
  readonly onStoreChange: (listener: () => void) => () => void;
}

interface Registered {
  readonly el: HTMLElement;
  readonly blocks: readonly { hash: BlockHash; text: string }[];
}

interface Segment {
  readonly node: Text;
  readonly base: number;
  readonly starts: readonly number[];
  readonly ends: readonly number[];
}

interface Piece {
  readonly node: Text;
  readonly from: number;
  readonly to: number;
  readonly role: SpanRole;
}

function collectSegments(root: HTMLElement): { stream: string; segments: Segment[] } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const segments: Segment[] = [];
  let stream = "";
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    const node = n as Text;
    if (node.parentElement?.closest("mark.sr") !== null) continue;
    const m = sigMap(node.data);
    if (m.stream.length === 0) continue;
    segments.push({ node, base: stream.length, starts: m.starts, ends: m.ends });
    stream += m.stream;
  }
  return { stream, segments };
}

function locateInStream(stream: string, spans: readonly Span[]): Loc[] {
  const locs: Loc[] = [];
  for (const span of spans) {
    const needle = sigMap(span.quote);
    if (needle.stream.length === 0) continue;
    const at = stream.indexOf(needle.stream);
    if (at === -1) continue;
    locs.push({ from: at, to: at + needle.stream.length, role: span.role });
  }
  return dedupe(locs);
}

function piecesFromRanges(segments: readonly Segment[], ranges: readonly Loc[]): Piece[] {
  const pieces: Piece[] = [];
  for (const range of ranges) {
    const sigTo = range.to - 1;
    let startSeg: Segment | null = null;
    let endSeg: Segment | null = null;
    for (const seg of segments) {
      const segEnd = seg.base + seg.starts.length - 1;
      if (startSeg === null && range.from <= segEnd) startSeg = seg;
      if (sigTo <= segEnd) {
        endSeg = seg;
        break;
      }
    }
    if (startSeg === null || endSeg === null) continue;
    const localFrom = startSeg.starts[range.from - startSeg.base];
    const localTo = endSeg.ends[sigTo - endSeg.base];
    if (localFrom === undefined || localTo === undefined) continue;
    if (startSeg === endSeg) {
      pieces.push({ node: startSeg.node, from: localFrom, to: localTo, role: range.role });
      continue;
    }
    pieces.push({ node: startSeg.node, from: localFrom, to: startSeg.node.data.length, role: range.role });
    for (let i = segments.indexOf(startSeg) + 1; i < segments.indexOf(endSeg); i++) {
      const mid = segments[i]!;
      pieces.push({ node: mid.node, from: 0, to: mid.node.data.length, role: range.role });
    }
    pieces.push({ node: endSeg.node, from: 0, to: localTo, role: range.role });
  }
  return pieces;
}

function wrapPiece(piece: Piece): void {
  const node = piece.node;
  if (piece.to < node.data.length) node.splitText(piece.to);
  const target = piece.from > 0 ? node.splitText(piece.from) : node;
  const mark = document.createElement("mark");
  mark.className = `sr ${SPAN_CLASS[piece.role]}`;
  const parent = target.parentNode;
  if (parent === null) return;
  parent.insertBefore(mark, target);
  mark.appendChild(target);
}

export function decorateElement(el: HTMLElement, blocks: readonly { hash: BlockHash; text: string }[], store: AnnotationStore, enabled: ReadonlySet<SpanRole>): void {
  for (const mark of [...el.querySelectorAll("mark.sr")]) {
    const parent = mark.parentNode;
    if (parent === null) continue;
    while (mark.firstChild !== null) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
  }
  el.normalize();
  const spans: Span[] = [];
  for (const b of blocks) {
    const record = store.get(b.hash);
    if (record === null) continue;
    for (const s of record.spans) if (enabled.has(s.role)) spans.push(s);
  }
  if (spans.length === 0) return;
  const { stream, segments } = collectSegments(el);
  const ranges = locateInStream(stream, spans);
  const pieces = piecesFromRanges(segments, ranges);
  const order = new Map<Text, number>();
  segments.forEach((s, i) => order.set(s.node, i));
  pieces
    .sort((a, b) => (order.get(b.node) ?? -1) - (order.get(a.node) ?? -1) || b.from - a.from)
    .forEach(wrapPiece);
}

export function createReadingViewDecorator(deps: ReadingViewDeps): MarkdownPostProcessor {
  const registry: Registered[] = [];

  deps.onStoreChange(() => {
    for (let n = registry.length - 1; n >= 0; n--) {
      const entry = registry[n]!;
      if (!entry.el.isConnected) {
        registry.splice(n, 1);
        continue;
      }
      decorateElement(entry.el, entry.blocks, deps.store, deps.enabledSpans());
    }
  });

  return (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    const info = ctx.getSectionInfo(el);
    if (info === null) return;
    const blocks = splitBlocks(info.text)
      .blocks.filter((b) => isClassifiable(b.kind))
      .map((b) => ({ hash: b.hash, text: b.text }));
    if (blocks.length === 0) return;
    decorateElement(el, blocks, deps.store, deps.enabledSpans());
    registry.push({ el, blocks });
  };
}
