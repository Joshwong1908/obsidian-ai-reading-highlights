import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { StateEffect, StateEffectType, Extension, RangeSetBuilder } from "@codemirror/state";
import { isClassifiable, splitBlocks } from "./blocks";
import { Role, ROLE_CLASS } from "./roles";
import { AnnotationStore } from "./store";

export interface LivePreviewDeps {
  readonly store: AnnotationStore;
  readonly enabledRoles: () => ReadonlySet<Role>;
  readonly onDocChanged: () => void;
}

const repaintEffect: StateEffectType<void> = StateEffect.define<void>();
const liveViews = new Set<EditorView>();

export function repaintLivePreviews(): void {
  for (const view of liveViews) view.dispatch({ effects: repaintEffect.of() });
}

function buildDecorations(view: EditorView, store: AnnotationStore, enabled: ReadonlySet<Role>): DecorationSet {
  const doc = view.state.doc;
  const builder = new RangeSetBuilder<Decoration>();
  const blocks = splitBlocks(doc.sliceString(0)).blocks;
  for (const block of blocks) {
    if (!isClassifiable(block.kind)) continue;
    const record = store.get(block.hash);
    if (record === null || !enabled.has(record.role)) continue;
    const classes = ["sr", ROLE_CLASS[record.role]];
    if (record.meta.source === "heuristic") classes.push("sr-heur");
    const deco = Decoration.line({ class: classes.join(" ") });
    for (let line = block.fromLine; line <= Math.min(block.toLine, doc.lines - 1); line++) {
      builder.add(line, line, deco);
    }
  }
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
        this.decorations = buildDecorations(view, deps.store, deps.enabledRoles());
      }
      update(u: ViewUpdate) {
        if (u.docChanged) deps.onDocChanged();
        const repainted = u.transactions.some((tr) => tr.effects.some((e) => e.is(repaintEffect)));
        if (u.docChanged || u.viewportChanged || repainted) {
          this.decorations = buildDecorations(u.view, deps.store, deps.enabledRoles());
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
