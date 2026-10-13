import { splitBlocks, isClassifiable } from "./blocks";
import { heuristicSpans } from "./heuristic";
import { createAnnotationStore, AnnotationRecord, StorableRecord } from "./store";
import { decorateElement } from "./reading-view";
import { sigMap, SpanRole, SPAN_ROLES } from "./spans";

export function seedStore(markdown: string, glRecords?: readonly StorableRecord[]): readonly AnnotationRecord[] {
  const heuristic = heuristicSpans(splitBlocks(markdown).blocks).map((g) => ({ hash: g.hash, spans: g.spans, meta: { source: "heuristic" as const } }));
  return [...heuristic, ...(glRecords ?? [])].map((r, i) => ({ ...r, at: i + 1 }));
}

export function decorateDocument(markdown: string, container: HTMLElement, glRecords?: readonly StorableRecord[]): Record<string, number | string> {
  const store = createAnnotationStore(
    { capacity: 5000, persist: async () => {}, schedule: () => () => {} },
    seedStore(markdown, glRecords),
  );
  const lines = markdown.split("\n");
  const groups: { kind: string; fromLine: number; toLine: number }[] = [];
  for (const b of splitBlocks(markdown).blocks) {
    const last = groups[groups.length - 1];
    const continuesList = last !== undefined && last.kind === "listItem" && b.kind === "listItem" && b.fromLine <= last.toLine + 2;
    if (continuesList) last.toLine = b.toLine;
    else groups.push({ kind: b.kind, fromLine: b.fromLine, toLine: b.toLine });
  }
  const children = [...container.children].filter((el) => el.tagName !== "HR");
  const enabled = new Set<SpanRole>([...SPAN_ROLES]);
  const childStreams = children.map((el) => sigMap(el.textContent).stream);
  const perGroup: number[] = [];
  for (const group of groups) {
    const text = lines.slice(group.fromLine, group.toLine + 1).join("\n");
    const sectionBlocks = splitBlocks(text)
      .blocks.filter((b) => isClassifiable(b.kind))
      .map((b) => ({ hash: b.hash, text: b.text }));
    const probe = sectionBlocks.length > 0 ? sigMap(sectionBlocks[0]!.text.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")).stream.slice(0, 24) : "";
    const idx = probe === "" ? -1 : childStreams.findIndex((s) => s.includes(probe));
    if (idx === -1) {
      perGroup.push(0);
      continue;
    }
    decorateElement(children[idx] as HTMLElement, sectionBlocks, store, enabled);
    perGroup.push((children[idx] as HTMLElement).querySelectorAll("mark.sr").length);
  }
  const counts: Record<string, number | string> = { groups: groups.length, children: children.length };
  counts.debugGroups = perGroup.join(",");
  for (const role of SPAN_ROLES) {
    counts[role] = container.querySelectorAll(role === "kp" ? "mark.sr-kp" : role === "term" ? "mark.sr-term" : "mark.sr-concept").length;
  }
  return counts;
}

export function debugExcerpt(markdown: string, container: HTMLElement, glRecords: readonly StorableRecord[], excerpt: string, childTag: string): Record<string, unknown> {
  const store = createAnnotationStore({ capacity: 5000, persist: async () => {}, schedule: () => () => {} }, seedStore(markdown, glRecords));
  const target = splitBlocks(markdown).blocks.find((b) => b.text.includes(excerpt));
  if (target === undefined) return { stage: "no-block" };
  const record = store.get(target.hash);
  const el = [...container.children].find((c) => c.tagName === childTag && (c.textContent ?? "").includes(excerpt.slice(0, 8))) as HTMLElement | undefined;
  if (el === undefined) return { stage: "no-element" };
  const sectionBlocks = [{ hash: target.hash, text: target.text }];
  const before = el.querySelectorAll("mark.sr").length;
  decorateElement(el, sectionBlocks, store, new Set<SpanRole>([...SPAN_ROLES]));
  return {
    stage: "done",
    recordFound: record !== null,
    spanCount: record?.spans.length ?? 0,
    elTextHead: (el.textContent ?? "").slice(0, 30),
    before,
    after: el.querySelectorAll("mark.sr").length,
  };
}
