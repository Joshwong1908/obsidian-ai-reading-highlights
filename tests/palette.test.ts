import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dir, "../styles.css"), "utf8");

function presetColors(block: string): number[][] {
  const roles = ["claim", "evidence", "caveat", "question", "definition"];
  return roles.map((role) => {
    const re = new RegExp(`--sr-${role}:\\s*#([0-9a-f]{6})`);
    const m = re.exec(block);
    if (m === null) throw new Error(`missing --sr-${role} in block`);
    return [parseInt(m[1]!.slice(0, 2), 16), parseInt(m[1]!.slice(2, 4), 16), parseInt(m[1]!.slice(4, 6), 16)];
  });
}

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

describe("palette separation (styles.css)", () => {
  const bodyBlock = css.slice(css.indexOf("body {"), css.indexOf('body[data-sr-preset="warm"]'));
  const warmBlock = css.slice(css.indexOf('body[data-sr-preset="warm"]'), css.indexOf("body.theme-dark"));

  test("every preset defines five role colors", () => {
    expect(presetColors(bodyBlock).length).toBe(5);
    expect(presetColors(warmBlock).length).toBe(5);
  });

  test("role pairs stay perceptually distinct in both presets (OKLab dE >= 0.1)", () => {
    for (const [name, block] of [
      ["cool", bodyBlock],
      ["warm", warmBlock],
    ] as const) {
      const colors = presetColors(block).map(toOklab);
      for (let a = 0; a < colors.length; a++) {
        for (let b = a + 1; b < colors.length; b++) {
          const dE = Math.hypot(...colors[a]!.map((v, i) => v - colors[b]![i]!));
          expect(dE).toBeGreaterThanOrEqual(0.1);
        }
      }
    }
  });
});
