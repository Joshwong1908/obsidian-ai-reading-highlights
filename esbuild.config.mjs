import esbuild from "esbuild";
import process from "node:process";

const prod = process.argv.includes("--production") || process.env.NODE_ENV === "production";

await esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  outfile: "main.js",
  external: ["obsidian", "electron", "@codemirror/autocomplete", "@codemirror/collab", "@codemirror/commands", "@codemirror/language", "@codemirror/lint", "@codemirror/search", "@codemirror/state", "@codemirror/view", "@lezer/common", "@lezer/highlight", "@lezer/lr"],
  format: "cjs",
  target: "es2022",
  sourcemap: prod ? false : "inline",
  minify: prod,
  logLevel: "info",
});
