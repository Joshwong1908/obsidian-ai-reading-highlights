import { splitBlocks, isClassifiable } from "../src/blocks";
import { classifyViaApi } from "../src/api";
import { readFileSync, writeFileSync } from "node:fs";

const vault = JSON.parse(readFileSync("/mnt/e/01Markdown/.obsidian/plugins/ai-reading-highlights/data.json", "utf8")) as {
  baseUrl: string;
  apiKey: string;
  model: string;
  disableThinking: boolean;
};
const md = readFileSync("/home/josh/Papers/obsidian-ai-reading-highlights/docs/sample-note.md", "utf8");
const items = splitBlocks(md)
  .blocks.filter((b) => isClassifiable(b.kind))
  .map((b) => ({ hash: b.hash, kind: b.kind, text: b.text, context: [] as string[] }));

const t0 = Date.now();
const r = await classifyViaApi({ ...vault }, items, null, async (req) => {
  const res = await fetch(req.url, { method: "POST", headers: req.headers, body: req.body });
  return { status: res.status, body: await res.text() };
});
if (!r.ok) {
  console.error("FAIL", JSON.stringify(r.failure));
  process.exit(1);
}
const records = r.items.map((i) => ({ hash: i.hash, spans: i.spans, meta: { source: "api" as const, model: vault.model } }));
writeFileSync("/tmp/sr-verify/gl-spans.json", JSON.stringify(records));
const byRole: Record<string, number> = {};
for (const rec of records) for (const s of rec.spans) byRole[s.role] = (byRole[s.role] ?? 0) + 1;
console.log(`latency_ms=${Date.now() - t0} blocks=${records.length}/${items.length} spans=${JSON.stringify(byRole)}`);
const sample = records.flatMap((rec) => rec.spans.map((s) => `${s.role}: ${s.quote.slice(0, 40)}`)).slice(0, 8);
for (const s of sample) console.log(" ", s);
