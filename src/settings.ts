import { App, PluginSettingTab, Setting } from "obsidian";
import type SemanticReadingPlugin from "./main";
import { SPAN_ROLES, SPAN_LABEL, SpanRole } from "./spans";
import { ApiConfig, HttpTransport, probeApi } from "./api";

export type HighlightStyle = "marker" | "pill";

export interface Settings {
  enabled: boolean;
  style: HighlightStyle;
  highlights: ReadonlySet<SpanRole>;
  baseUrl: string;
  apiKey: string;
  model: string;
  disableThinking: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  style: "marker",
  highlights: new Set([...SPAN_ROLES]),
  baseUrl: "",
  apiKey: "",
  model: "",
  disableThinking: true,
};

export function parseSettings(raw: unknown): Settings {
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT_SETTINGS, highlights: new Set([...SPAN_ROLES]) };
  const s = { ...DEFAULT_SETTINGS };
  if ("enabled" in raw && typeof raw.enabled === "boolean") s.enabled = raw.enabled;
  if ("highlights" in raw && Array.isArray(raw.highlights)) {
    const highlights = new Set<SpanRole>();
    for (const r of raw.highlights) if (typeof r === "string" && (SPAN_ROLES as readonly string[]).includes(r)) highlights.add(r as SpanRole);
    s.highlights = highlights;
  }
  if ("baseUrl" in raw && typeof raw.baseUrl === "string") s.baseUrl = raw.baseUrl;
  if ("apiKey" in raw && typeof raw.apiKey === "string") s.apiKey = raw.apiKey;
  if ("model" in raw && typeof raw.model === "string") s.model = raw.model;
  if ("disableThinking" in raw && typeof raw.disableThinking === "boolean") s.disableThinking = raw.disableThinking;
  if ("style" in raw && (raw.style === "marker" || raw.style === "pill")) s.style = raw.style;
  return s;
}

export function serializeSettings(s: Settings): Record<string, unknown> {
  return { ...s, highlights: [...s.highlights] };
}

export function applyHighlightStyle(s: Settings): void {
  document.body.dataset.srStyle = s.style;
}

export function apiConfigOf(s: Settings): ApiConfig | null {
  if (s.baseUrl === "" || s.apiKey === "" || s.model === "") return null;
  return { baseUrl: s.baseUrl, apiKey: s.apiKey, model: s.model, disableThinking: s.disableThinking };
}

export class SemanticReadingSettingTab extends PluginSettingTab {
  private readonly plugin: SemanticReadingPlugin;
  private statusEl: HTMLElement | null = null;

  constructor(app: App, plugin: SemanticReadingPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  public override display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.cfg;

    new Setting(containerEl).setName("Enable semantic highlights").addToggle((t) =>
      t.setValue(s.enabled).onChange(async (v) => {
        s.enabled = v;
        await this.plugin.saveSettings();
      }),
    );

    new Setting(containerEl).setName("Highlight style").addDropdown((d) =>
      d
        .addOptions({ marker: "Marker pen", pill: "Concept pill" })
        .setValue(s.style)
        .onChange(async (v) => {
          s.style = v as HighlightStyle;
          applyHighlightStyle(s);
          await this.plugin.saveSettings();
        }),
    );
    containerEl.createEl("h3", { text: "Highlights" });
    for (const role of SPAN_ROLES) {
      new Setting(containerEl).setName(SPAN_LABEL[role]).addToggle((t) =>
        t.setValue(s.highlights.has(role)).onChange(async (on) => {
          const next = new Set(s.highlights);
          if (on) next.add(role);
          else next.delete(role);
          s.highlights = next;
          await this.plugin.saveSettings();
        }),
      );
    }

    containerEl.createEl("h3", { text: "Classification API (OpenAI-compatible)" });
    new Setting(containerEl).setName("Base URL").addText((t) =>
      t.setPlaceholder("https://open.bigmodel.cn/api/coding/paas/v4").setValue(s.baseUrl).onChange(async (v) => {
        s.baseUrl = v.trim();
        await this.plugin.saveSettings();
      }),
    );
    new Setting(containerEl).setName("API key").addText((t) =>
      t.setValue(s.apiKey).onChange(async (v) => {
        s.apiKey = v.trim();
        await this.plugin.saveSettings();
      }),
    );
    new Setting(containerEl).setName("Model").addText((t) =>
      t.setPlaceholder("glm-5.3-flash").setValue(s.model).onChange(async (v) => {
        s.model = v.trim();
        await this.plugin.saveSettings();
      }),
    );
    new Setting(containerEl)
      .setName("Disable model thinking")
      .setDesc("Sends thinking: disabled. Keeps GLM labeling fast; turn off if your provider rejects the field.")
      .addToggle((t) =>
        t.setValue(s.disableThinking).onChange(async (v) => {
          s.disableThinking = v;
          await this.plugin.saveSettings();
        }),
      );
    new Setting(containerEl).setName("Test connection").addButton((b) =>
      b.setButtonText("Test").onClick(async () => {
        const api = apiConfigOf(s);
        if (api === null) {
          this.setStatus("Fill base URL, key, and model first.");
          return;
        }
        const res = await probeApi(api, this.plugin.transport);
        this.setStatus(res.ok ? `Reachable. Highlights will use ${api.model}.` : `Failed: ${res.failure.detail ?? res.failure.reason}`);
      }),
    );
    this.statusEl = containerEl.createEl("p", { cls: "sr-status" });

    containerEl.createEl("h3", { text: "Cache" });
    new Setting(containerEl)
      .setName("Clear cached highlights")
      .setDesc("Removes all stored span annotations. They are re-created on next open.")
      .addButton((b) =>
        b.setButtonText("Clear").onClick(async () => {
          this.plugin.store.clear();
          await this.plugin.saveSettings();
        }),
      );
  }

  private setStatus(text: string): void {
    if (this.statusEl !== null) this.statusEl.setText(text);
  }
}

export type { HttpTransport };
