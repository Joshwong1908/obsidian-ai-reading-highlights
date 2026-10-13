import { App, PluginSettingTab, Setting } from "obsidian";
import type SemanticReadingPlugin from "./main";
import { Role, ROLES, ROLE_LABEL } from "./roles";
import { ApiConfig, HttpTransport, probeApi } from "./api";

export type Preset = "cool" | "warm";
export type Intensity = "normal" | "subtle";
export type Grammar = "border-tint" | "tint" | "border";

export interface Settings {
  enabled: boolean;
  preset: Preset;
  intensity: Intensity;
  grammar: Grammar;
  roles: ReadonlySet<Role>;
  baseUrl: string;
  apiKey: string;
  model: string;
  disableThinking: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  preset: "cool",
  intensity: "normal",
  grammar: "border-tint",
  roles: new Set([...ROLES]),
  baseUrl: "",
  apiKey: "",
  model: "",
  disableThinking: true,
};

export function parseSettings(raw: unknown): Settings {
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT_SETTINGS, roles: new Set([...ROLES]) };
  const s = { ...DEFAULT_SETTINGS };
  if ("enabled" in raw && typeof raw.enabled === "boolean") s.enabled = raw.enabled;
  if ("preset" in raw && (raw.preset === "cool" || raw.preset === "warm")) s.preset = raw.preset;
  if ("intensity" in raw && (raw.intensity === "normal" || raw.intensity === "subtle")) s.intensity = raw.intensity;
  if ("grammar" in raw && (raw.grammar === "border-tint" || raw.grammar === "tint" || raw.grammar === "border")) s.grammar = raw.grammar;
  if ("roles" in raw && Array.isArray(raw.roles)) {
    const roles = new Set<Role>();
    for (const r of raw.roles) if (typeof r === "string" && (ROLES as readonly string[]).includes(r)) roles.add(r as Role);
    s.roles = roles;
  }
  if ("baseUrl" in raw && typeof raw.baseUrl === "string") s.baseUrl = raw.baseUrl;
  if ("apiKey" in raw && typeof raw.apiKey === "string") s.apiKey = raw.apiKey;
  if ("model" in raw && typeof raw.model === "string") s.model = raw.model;
  if ("disableThinking" in raw && typeof raw.disableThinking === "boolean") s.disableThinking = raw.disableThinking;
  return s;
}

export function serializeSettings(s: Settings): Record<string, unknown> {
  return { ...s, roles: [...s.roles] };
}

export function apiConfigOf(s: Settings): ApiConfig | null {
  if (s.baseUrl === "" || s.apiKey === "" || s.model === "") return null;
  return { baseUrl: s.baseUrl, apiKey: s.apiKey, model: s.model, disableThinking: s.disableThinking };
}

export function applyAppearance(s: Settings): void {
  document.body.dataset.srPreset = s.preset;
  document.body.dataset.srIntensity = s.intensity;
  document.body.dataset.srGrammar = s.grammar;
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

    new Setting(containerEl).setName("Enable semantic colors").addToggle((t) =>
      t.setValue(s.enabled).onChange(async (v) => {
        s.enabled = v;
        await this.plugin.saveSettings();
      }),
    );

    new Setting(containerEl).setName("Palette preset").addDropdown((d) =>
      d
        .addOptions({ cool: "Scholarly (cool)", warm: "Warm paper" })
        .setValue(s.preset)
        .onChange(async (v) => {
          s.preset = v as Preset;
          applyAppearance(s);
          await this.plugin.saveSettings();
        }),
    );

    new Setting(containerEl).setName("Intensity").addDropdown((d) =>
      d
        .addOptions({ normal: "Normal", subtle: "Subtle" })
        .setValue(s.intensity)
        .onChange(async (v) => {
          s.intensity = v as Intensity;
          applyAppearance(s);
          await this.plugin.saveSettings();
        }),
    );

    new Setting(containerEl).setName("Marker style").addDropdown((d) =>
      d
        .addOptions({ "border-tint": "Border + tint", tint: "Tint only", border: "Border only" })
        .setValue(s.grammar)
        .onChange(async (v) => {
          s.grammar = v as Grammar;
          applyAppearance(s);
          await this.plugin.saveSettings();
        }),
    );

    containerEl.createEl("h3", { text: "Roles" });
    for (const role of ROLES) {
      new Setting(containerEl).setName(ROLE_LABEL[role]).addToggle((t) =>
        t.setValue(s.roles.has(role)).onChange(async (on) => {
          const next = new Set(s.roles);
          if (on) next.add(role);
          else next.delete(role);
          s.roles = next;
          await this.plugin.saveSettings();
        }),
      );
    }

    containerEl.createEl("h3", { text: "Classification API (OpenAI-compatible)" });
    new Setting(containerEl).setName("Base URL").addText((t) =>
      t.setPlaceholder("https://api.openai.com/v1").setValue(s.baseUrl).onChange(async (v) => {
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
      t.setPlaceholder("gpt-4o-mini").setValue(s.model).onChange(async (v) => {
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
        this.setStatus(res.ok ? `Reachable. Colors will use ${api.model}.` : `Failed: ${res.failure.detail ?? res.failure.reason}`);
      }),
    );
    this.statusEl = containerEl.createEl("p", { cls: "sr-status" });

    containerEl.createEl("h3", { text: "Cache" });
    new Setting(containerEl)
      .setName("Clear cached colors")
      .setDesc("Removes all stored block classifications. They are re-created on next open.")
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
