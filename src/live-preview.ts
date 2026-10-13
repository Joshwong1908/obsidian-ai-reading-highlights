import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { stats } from "./stats";
import { StateEffect, StateEffectType, Extension, RangeSetBuilder } from "@codemirror/state";
import { BlockRef, isClassifiable, splitBlocks } from "./blocks";
import { locateSpans, SPAN_CLASS, SPAN_LABEL, SpanRole } from "./spans";
import { AnnotationStore } from "./store";

export interface LivePreviewDeps {
  readonly store: AnnotationStore;
  readonly enabledSpans: () => ReadonlySet<SpanRole>;
  readonly onDocChanged: () => void;
}

const repaintEffect: StateEffectType<void> = StateEffect.define<void>();
const liveViews = new Set<EditorView>();

export function repaintLivePreviews(): void {
  for (const view of liveViews) view.dispatch({ effects: repaintEffect.of() });
}

function rawSliceOf(view: EditorView, block: BlockRef): string {
  const lines: string[] = [];
  for (let l = block.fromLine; l <= Math.min(block.toLine, view.state.doc.lines - 1); l++) {
    lines.push(view.state.doc.line(l + 1).text);
  }
  return lines.join("\n");
}

function buildDecorations(view: EditorView, store: AnnotationStore, enabled: ReadonlySet<SpanRole>): DecorationSet {
  const doc = view.state.doc;
  const builder = new RangeSetBuilder<Decoration>();
  const marks: { from: number; to: number; deco: Decoration }[] = [];
  for (const block of splitBlocks(doc.sliceString(0)).blocks) {
    if (!isClassifiable(block.kind)) continue;
    const record = store.get(block.hash);
    if (record === null) continue;
    const spans = record.spans.filter((s) => enabled.has(s.role));
    if (spans.length === 0) continue;
    const raw = rawSliceOf(view, block);
    const base = doc.line(Math.min(block.fromLine, doc.lines - 1) + 1).from;
    for (const loc of locateSpans(raw, spans)) {
      const from = Math.min(base + loc.from, doc.length);
      const to = Math.min(base + loc.to, doc.length);
      if (to <= from) continue;
      marks.push({ from, to, deco: Decoration.mark({ class: `sr ${SPAN_CLASS[loc.role]}`, attributes: { "data-sr-label": SPAN_LABEL[loc.role] } }) });
    }
  }
  marks.sort((a, b) => a.from - b.from || a.to - b.to);
  for (const m of marks) builder.add(m.from, m.to, m.deco);
  return builder.finish();
}

export function buildLivePreviewExtension(deps: LivePreviewDeps): Extension[] {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      readonly view: EditorView;
      constructor(view: EditorView) {
        this.view = view;
        liveViews.add(view);
        stats.liveViews = liveViews.size;
        this.decorations = buildDecorations(view, deps.store, deps.enabledSpans());
      }
      update(u: ViewUpdate) {
        if (u.docChanged) deps.onDocChanged();
        const repainted = u.transactions.some((tr) => tr.effects.some((e) => e.is(repaintEffect)));
        if (u.docChanged || u.viewportChanged || repainted) {
          this.decorations = buildDecorations(u.view, deps.store, deps.enabledSpans());
        }
      }
      destroy() {
        liveViews.delete(this.view);
      }
    },
    { decorations: (v) => v.decorations },
  );
  return [plugin];
}
