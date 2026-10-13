import { MarkdownView, Notice, Plugin, TFile } from "obsidian";

import { createAnnotationStore, AnnotationStore, parseStoreFile } from "./store";
import { createPipeline, Pipeline, PipelineSettings } from "./pipeline";
import { createReadingViewDecorator } from "./reading-view";
import { buildLivePreviewExtension, repaintLivePreviews } from "./live-preview";
import { SemanticReadingSettingTab, Settings, apiConfigOf, applyHighlightStyle, parseSettings, serializeSettings } from "./settings";
import { obsidianTransport } from "./transport";
import { HttpTransport } from "./api";
import { watchThemeAdaptation } from "./theme";
import { Span, SpanRole } from "./spans";
import { renderStats } from "./stats";

const CACHE_FILE = "cache.json";
const CACHE_CAPACITY = 5000;
const CHAR_BUDGET = 16000;
const EDIT_DEBOUNCE_MS = 1500;
const NOTE_SPANS_CAPACITY = 16;

const scheduleViaTimeout = (fn: () => void, ms: number): (() => void) => {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
};

export default class SemanticReadingPlugin extends Plugin {
  cfg!: Settings;
  store!: AnnotationStore;
  pipeline!: Pipeline;
  transport: HttpTransport = obsidianTransport;
  private offStoreRepaint: (() => void) | null = null;
  private offThemeWatch: () => void = () => {};
  private readonly noteSpans = new Map<string, readonly Span[]>();

  public override async onload(): Promise<void> {
    await this.loadPluginState();

    this.pipeline = createPipeline({
      store: this.store,
      read: (path) => this.readNote(path),
      settings: () => this.pipelineSettings(),
      transport: this.transport,
      notify: (msg) => {
        new Notice(msg, 6000);
      },
      schedule: scheduleViaTimeout,
      onNoteSpans: (path, spans) => this.rememberSpans(path, spans),
    });

    const enabledSpans = (): ReadonlySet<SpanRole> => (this.cfg.enabled ? this.cfg.highlights : new Set<SpanRole>());

    this.registerMarkdownPostProcessor(
      createReadingViewDecorator({
        store: this.store,
        enabledSpans,
        spansFor: (path) => this.noteSpans.get(path) ?? [],
        onStoreChange: (listener) => this.store.onUpdate(() => listener()),
      }),
    );
    this.registerEditorExtension(
      buildLivePreviewExtension({
        store: this.store,
        enabledSpans,
        onDocChanged: () => {
          const file = this.activeNoteFile();
          if (file !== null) this.pipeline.fileEdited(file.path);
        },
      }),
    );
    this.offStoreRepaint = this.store.onUpdate(() => {
      repaintLivePreviews();
    });

    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (file instanceof TFile && file.extension === "md") this.pipeline.fileOpened(file.path);
      }),
    );

    this.app.workspace.onLayoutReady(() => {
      const file = this.activeNoteFile();
      if (file !== null) this.pipeline.fileOpened(file.path);
    });
    this.addCommand({
      id: "reclassify-note",
      name: "Reclassify current note now",
      callback: () => {
        const file = this.activeNoteFile();
        if (file !== null) this.pipeline.reclassifyNow(file.path);
      },
    });

    this.addCommand({
      id: "diagnose",
      name: "Diagnose rendering (writes diagnosis.txt)",
      callback: () => {
        void this.diagnose();
      },
    });

    this.addSettingTab(new SemanticReadingSettingTab(this.app, this));
    applyHighlightStyle(this.cfg);
    this.register(() => this.offThemeWatch());
    this.offThemeWatch = watchThemeAdaptation();
  }

  public override onunload(): void {
    this.offStoreRepaint?.();
    this.offStoreRepaint = null;
    void this.pipeline.dispose();
  }

  public async saveSettings(): Promise<void> {
    await this.saveData(serializeSettings(this.cfg));
  }

  private rememberSpans(path: string, spans: readonly Span[]): void {
    this.noteSpans.delete(path);
    this.noteSpans.set(path, spans);
    while (this.noteSpans.size > NOTE_SPANS_CAPACITY) {
      const oldest = this.noteSpans.keys().next();
      if (oldest.done) break;
      this.noteSpans.delete(oldest.value);
    }
  }

  private async diagnose(): Promise<void> {
    const s = renderStats();
    const ua = navigator.userAgent;
    const obsidianVersion = /obsidian\/([\d.]+)/i.exec(ua)?.[1] ?? "unknown";
    const feature = {
      colorMix: CSS.supports("color", "color-mix(in srgb, red 50%, transparent)"),
      treeWalker: typeof document.createTreeWalker === "function",
      splitText: typeof Text.prototype.splitText === "function",
      dataset: "dataset" in document.createElement("mark"),
    };
    const styleTag = document.querySelector("style") ?? document.body;
    const lines = [
      `obsidian: ${obsidianVersion}`,
      `ua: ${ua}`,
      `features: ${JSON.stringify(feature)}`,
      `settings: enabled=${this.cfg.enabled} highlights=[${[...this.cfg.highlights].join(",")}] style=${this.cfg.style} api=${this.cfg.baseUrl !== "" && this.cfg.apiKey !== "" && this.cfg.model !== "" ? "configured" : "missing"}`,
      `store: ${this.store.size()} records`,
      `noteSpans cached paths: ${[...this.noteSpans.keys()].join(", ") || "none"}`,
      `render stats: ${JSON.stringify(s)}`,
      `live dom: cm-content marks ${document.querySelectorAll(".cm-content .sr-kp, .cm-content .sr-term, .cm-content .sr-concept").length}, all document marks ${document.querySelectorAll("mark.sr, .sr-kp, .sr-term, .sr-concept").length}`,
      `active file: ${this.activeNoteFile()?.path ?? "none"}`,
      `version: ${this.manifest.version}`,
    ];
    const report = lines.join("\n");
    console.info("[Semantic Reading] diagnosis\n" + report);
    try {
      const dir = this.manifest.dir ?? "";
      const path = dir === "" ? "diagnosis.txt" : `${dir.replace(/\/+$/, "")}/diagnosis.txt`;
      await this.app.vault.adapter.write(path, report + "\n");
      new Notice(`SR diagnosis: liveBuilt=${s.liveMarksBuilt} liveHits=${s.liveStoreHits} cmMarks=${document.querySelectorAll(".cm-content .sr-kp, .cm-content .sr-term, .cm-content .sr-concept").length} readingMarks=${s.marksApplied} store=${this.store.size()}. Full: ${path}`, 12000);
    } catch (e) {
      new Notice(`SR diagnosis (write failed): liveBuilt=${s.liveMarksBuilt} liveHits=${s.liveStoreHits} readingMarks=${s.marksApplied} store=${this.store.size()}.`, 12000);
    }
  }

  private async loadPluginState(): Promise<void> {
    this.cfg = parseSettings(await this.loadData());
    const dir = this.manifest.dir ?? "";
    const cachePath = dir === "" ? CACHE_FILE : `${dir.replace(/\/+$/, "")}/${CACHE_FILE}`;
    let cacheJson: unknown = null;
    try {
      cacheJson = JSON.parse(await this.app.vault.adapter.read(cachePath));
    } catch {
      cacheJson = null;
    }
    this.store = createAnnotationStore(
      {
        capacity: CACHE_CAPACITY,
        persist: async (records) => {
          await this.app.vault.adapter.write(cachePath, JSON.stringify({ version: 2, entries: records }));
        },
        schedule: scheduleViaTimeout,
      },
      parseStoreFile(cacheJson),
    );
  }

  private pipelineSettings(): PipelineSettings {
    return { api: apiConfigOf(this.cfg), charBudget: CHAR_BUDGET, debounceMs: EDIT_DEBOUNCE_MS };
  }

  private async readNote(path: string): Promise<string> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`not a file: ${path}`);
    return this.app.vault.cachedRead(file);
  }

  private activeNoteFile(): TFile | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    return view?.file ?? null;
  }
}
