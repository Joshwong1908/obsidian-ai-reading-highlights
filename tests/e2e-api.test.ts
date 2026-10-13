import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyViaApi, probeApi, HttpTransport } from "../src/api";
import { splitBlocks, isClassifiable } from "../src/blocks";

const sample = readFileSync(join(import.meta.dir, "../docs/sample-note.md"), "utf8");

const seenAuth: string[] = [];

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    seenAuth.push(req.headers.get("authorization") ?? "none");
    if (req.method === "GET" && url.pathname.endsWith("/models")) {
      return Response.json({ data: [{ id: "mock-model" }] });
    }
    const body = (await req.json()) as { messages: { content: string }[] };
    const user = body.messages[1]!.content;
    const segments = user.split(/\n\n(?=\[\d+\])/).slice(1);
    const labels = segments.map((seg, n) => ({
      i: n + 1,
      role: /https?:\/\//.test(seg) ? "evidence" : "claim",
    }));
    return Response.json({
      choices: [{ message: { content: JSON.stringify({ labels }) } }],
    });
  },
});

afterAll(() => server.stop(true));

const transport: HttpTransport = async (req) => {
  const res = await fetch(req.url, { method: "POST", headers: req.headers, body: req.body });
  return { status: res.status, body: await res.text() };
};

const getTransport: HttpTransport = async (req) => {
  const res = await fetch(req.url, { method: "GET", headers: req.headers });
  return { status: res.status, body: await res.text() };
};

describe("classifyViaApi against a real local server", () => {
  const items = splitBlocks(sample)
    .blocks.filter((b) => isClassifiable(b.kind))
    .map((b) => ({ hash: b.hash, kind: b.kind, text: b.text, context: [] as string[] }));

  test("full chain returns api records for the sample note", async () => {
    const res = await classifyViaApi(
      { baseUrl: `http://localhost:${server.port}/v1`, apiKey: "sk-test", model: "mock-model" },
      items,
      null,
      transport,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.items.length).toBe(items.length);
    const linkBlock = items.findIndex((i) => /arxiv\.org/.test(i.text));
    const plainBlock = items.findIndex((i) => /唯一需要记住/.test(i.text));
    const byHash = new Map(res.items.map((r) => [r.hash, r.role]));
    expect(byHash.get(items[linkBlock]!.hash)).toBe("evidence");
    expect(byHash.get(items[plainBlock]!.hash)).toBe("claim");
    expect(seenAuth.at(-1)).toBe("Bearer sk-test");
  });

  test("probe reaches the models endpoint", async () => {
    const res = await probeApi({ baseUrl: `http://localhost:${server.port}/v1`, apiKey: "sk-test", model: "mock-model" }, getTransport);
    expect(res.ok).toBe(true);
  });

  test("server error surfaces as a value, not a throw", async () => {
    const broken: HttpTransport = async () => ({ status: 503, body: "unavailable" });
    const res = await classifyViaApi({ baseUrl: "http://localhost:1/v1", apiKey: "k", model: "m" }, items, null, broken);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.failure.reason).toBe("http");
    expect(res.failure.detail).toContain("503");
  });

  test("pre-aborted signal short-circuits without transport", async () => {
    const controller = new AbortController();
    controller.abort();
    let called = 0;
    const counting: HttpTransport = async (req) => {
      called++;
      return { status: 200, body: "{}" };
    };
    const res = await classifyViaApi({ baseUrl: "http://localhost:1/v1", apiKey: "k", model: "m" }, items, controller.signal, counting);
    expect(called).toBe(0);
    expect(!res.ok && res.failure.reason).toBe("aborted");
  });
});
