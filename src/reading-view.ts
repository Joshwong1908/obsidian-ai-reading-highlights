import type { MarkdownPostProcessor, MarkdownPostProcessorContext } from "obsidian";
import { BlockHash, isClassifiable, splitBlocks } from "./blocks";
import { Role, ROLE_CLASS } from "./roles";
import { AnnotationStore } from "./store";

export interface ReadingViewDeps {
  readonly store: AnnotationStore;
  readonly enabledRoles: () => ReadonlySet<Role>;
  readonly onStoreChange: (listener: () => void) => () => void;
}

interface Registered {
  readonly el: HTMLElement;
  readonly hashes: readonly BlockHash[];
}

const SR_CLASSES = ["sr", "sr-heur", ...Object.values(ROLE_CLASS)];

function roleClasses(role: Role, heuristic: boolean): string[] {
  const classes = ["sr", ROLE_CLASS[role]];
  if (heuristic) classes.push("sr-heur");
  return classes;
}

export function decorateList(el: HTMLElement, hashes: readonly BlockHash[], store: AnnotationStore, enabled: ReadonlySet<Role>): void {
  const items = [...el.querySelectorAll("li")];
  if (items.length !== hashes.length) return;
  items.forEach((li, n) => {
    const record = store.get(hashes[n]!);
    if (record === null || !enabled.has(record.role)) return;
    li.classList.add(...roleClasses(record.role, record.meta.source === "heuristic"));
  });
}

export function decorateSingle(el: HTMLElement, hash: BlockHash | undefined, store: AnnotationStore, enabled: ReadonlySet<Role>): void {
  if (hash === undefined) return;
  const record = store.get(hash);
  if (record === null || !enabled.has(record.role)) return;
  el.classList.add(...roleClasses(record.role, record.meta.source === "heuristic"));
}

export function createReadingViewDecorator(deps: ReadingViewDeps): MarkdownPostProcessor {
  const registry: Registered[] = [];

  const strip = (el: HTMLElement) => {
    for (const c of SR_CLASSES) el.classList.remove(c);
    for (const li of el.querySelectorAll("li")) for (const c of SR_CLASSES) li.classList.remove(c);
  };

  const apply = (el: HTMLElement, hashes: readonly BlockHash[]) => {
    strip(el);
    if (el.tagName === "UL" || el.tagName === "OL") decorateList(el, hashes, deps.store, deps.enabledRoles());
    else decorateSingle(el, hashes[0], deps.store, deps.enabledRoles());
  };

  deps.onStoreChange(() => {
    for (let n = registry.length - 1; n >= 0; n--) {
      const entry = registry[n]!;
      if (!entry.el.isConnected) {
        registry.splice(n, 1);
        continue;
      }
      apply(entry.el, entry.hashes);
    }
  });

  return (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    const info = ctx.getSectionInfo(el);
    if (info === null) return;
    const classifiable = splitBlocks(info.text).blocks.filter((b) => isClassifiable(b.kind));
    const hashes = classifiable.map((b) => b.hash);
    if (hashes.length === 0) return;
    apply(el, hashes);
    registry.push({ el, hashes });
  };
}
