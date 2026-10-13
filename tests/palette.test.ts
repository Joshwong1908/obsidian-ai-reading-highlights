import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dir, "../styles.css"), "utf8");

const srgbToLinear = (c: number): number => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};

const toOklab = ([r, g, b]: number[]): number[] => {
  const [lr, lg, lb] = [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ];
};

function colorOf(block: string, varName: string): number[] {
  const m = new RegExp(`--sr-${varName}:\\s*#([0-9a-f]{6})`).exec(block);
  if (m === null) throw new Error(`missing --sr-${varName}`);
  return [0, 2, 4].map((i) => parseInt(m[1]!.slice(i, i + 2), 16));
}

const lightBlock = css.slice(css.indexOf("body {"), css.indexOf('body[data-sr-bg="dark"]'));
const darkBlock = css.slice(css.indexOf('body[data-sr-bg="dark"]'), css.indexOf("mark.sr {"));

describe("highlight palette separation (styles.css)", () => {
  for (const [name, block] of [
    ["light", lightBlock],
    ["dark", darkBlock],
  ] as const) {
    test(`${name} palette: three highlight colors stay perceptually distinct (dE >= 0.1)`, () => {
      const colors = ["kp", "term", "concept"].map((v) => colorOf(block, v)).map(toOklab);
      for (let a = 0; a < colors.length; a++) {
        for (let b = a + 1; b < colors.length; b++) {
          const dE = Math.hypot(...colors[a]!.map((v, i) => v - colors[b]![i]!));
          expect(dE).toBeGreaterThanOrEqual(0.1);
        }
      }
    });

    test(`${name} palette: keypoint wash keeps text readable (blend contrast >= 7:1 on white / >= 4.5:1 on near-black)`, () => {
      const kp = colorOf(block, "kp");
      const alphaMatch = new RegExp(`--sr-kp-alpha:\\s*([\\d.]+)%`).exec(block);
      if (alphaMatch === null) throw new Error("missing --sr-kp-alpha");
      const alpha = parseInt(alphaMatch[1], 10) / 100;
      const lum = (rgb: number[]) => 0.2126 * srgbToLinear(rgb[0]!) + 0.7152 * srgbToLinear(rgb[1]!) + 0.0722 * srgbToLinear(rgb[2]!);
      const bg = name === "light" ? [255, 255, 255] : [27, 27, 31];
      const text = name === "light" ? [31, 35, 40] : [214, 215, 219];
      const eff = kp.map((c, i) => c * alpha + bg[i]! * (1 - alpha));
      const contrast = (Math.max(lum(text), lum(eff)) + 0.05) / (Math.min(lum(text), lum(eff)) + 0.05);
      expect(contrast).toBeGreaterThanOrEqual(name === "light" ? 7 : 4.5);
    });
  }
});
