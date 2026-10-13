import type { MarkdownPostProcessorContext } from "obsidian";
import { splitBlocks } from "./blocks";
import { heuristicClassify } from "./heuristic";
import { createAnnotationStore } from "./store";
import { createReadingViewDecorator } from "./reading-view";
import { Role, ROLES } from "./roles";

interface Section {
  readonly text: string;
}

export function decorateDocument(markdown: string, container: HTMLElement): { groups: number; decorated: Record<string, number> } {
  const store = createAnnotationStore(
    { capacity: 1000, persist: async () => {}, schedule: () => () => {} },
    [],
  );
  const blocks = splitBlocks(markdown).blocks;
  store.put(
    heuristicClassify(blocks).map((g) => ({ hash: g.hash, role: g.role, meta: { source: "heuristic" as const } })),
  );

  const lines = markdown.split("\n");
  const groups: { kind: string; fromLine: number; toLine: number }[] = [];
  for (const b of blocks) {
    const last = groups[groups.length - 1];
    const continuesList = last !== undefined && last.kind === "listItem" && b.kind === "listItem" && b.fromLine <= last.toLine + 2;
    if (continuesList) last.toLine = b.toLine;
    else groups.push({ kind: b.kind, fromLine: b.fromLine, toLine: b.toLine });
  }

  const enabled = new Set<Role>([...ROLES]);
  const decorator = createReadingViewDecorator({
    store,
    enabledRoles: () => enabled,
    onStoreChange: () => () => {},
  });

  const children = [...container.children].filter((el) => el.tagName !== "HR");
  let paired = 0;
  for (const group of groups) {
    const el = children[paired];
    if (el === undefined) break;
    const text = lines.slice(group.fromLine, group.toLine + 1).join("\n");
    decorator(el as HTMLElement, { getSectionInfo: () => ({ text, lineStart: group.fromLine, lineEnd: group.toLine }) } as unknown as MarkdownPostProcessorContext);
    paired++;
  }

  const decorated: Record<string, number> = {};
  for (const role of ROLES) {
    decorated[role] = container.querySelectorAll(`.sr-${role}`).length;
  }
  return { groups: groups.length, decorated };
}

export function diagnose(markdown: string): { seeded: number; sections: { text: string; hashes: number; hits: number }[] } {
  const store = createAnnotationStore({ capacity: 1000, persist: async () => {}, schedule: () => () => {} }, []);
  const blocks = splitBlocks(markdown).blocks;
  const guesses = heuristicClassify(blocks);
  store.put(guesses.map((g) => ({ hash: g.hash, role: g.role, meta: { source: "heuristic" as const } })));
  const lines = markdown.split("\n");
  const sections = blocks.slice(0, 8).map((b) => {
    const text = lines.slice(b.fromLine, b.toLine + 1).join("\n");
    const re = splitBlocks(text).blocks;
    return { text: text.slice(0, 30), hashes: re.length, hits: re.filter((x) => store.get(x.hash) !== null).length };
  });
  return { seeded: guesses.length, sections };
}
