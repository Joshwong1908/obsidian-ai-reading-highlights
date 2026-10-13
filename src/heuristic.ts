import { BlockHash, BlockRef, isClassifiable } from "./blocks";
import { Role } from "./roles";

export interface RoleGuess {
  readonly hash: BlockHash;
  readonly role: Role;
}

const ZONES: readonly [RegExp, Role][] = [
  [/结论|要点|判断/, "claim"],
  [/边界|局限|风险|失效/, "caveat"],
  [/sources|来源|参考/i, "evidence"],
];

const CUES: Readonly<Record<Role, readonly RegExp[]>> = {
  claim: [
    /因此/,
    /所以[^。]{0,12}是/,
    /结论是/,
    /关键判断/,
    /唯一需要记住/,
    /核心是/,
    /本质[是上]/,
    /总之/,
    /由此得到/,
    /最[常直接]/,
    /this means/i,
    /therefore/i,
    /in short/i,
  ],
  evidence: [
    /等人/,
    /et al\.?/i,
    /20\d\d/,
    /\d+(?:\.\d+)?%/,
    /benchmark/i,
    /实测/,
    /来源/,
    /实验/,
    /发现/,
    /报告/,
    /研究/,
    /arxiv/i,
    /https?:\/\//,
  ],
  caveat: [
    /局限/,
    /失效/,
    /推翻/,
    /不完全成立/,
    /不提升/,
    /常见失误/,
    /风险/,
    /边界/,
    /不应/,
    /caveat/i,
    /limitation/i,
  ],
  question: [/吗[?？。]/, /[?？]\s*$/, /待验证/, /还不清楚/, /该不该/],
  definition: [/是指/, /叫做/, /指的是/, /定义为/, /不变量/, /mental model/i],
};

function score(text: string, zone: Role | null): { best: Role | null; score: number } {
  const scores = new Map<Role, number>();
  for (const role of Object.keys(CUES) as Role[]) {
    let hits = 0;
    for (const re of CUES[role]) if (re.test(text)) hits++;
    if (hits > 0) scores.set(role, hits);
  }
  if (zone) scores.set(zone, (scores.get(zone) ?? 0) + 2);
  let best: Role | null = null;
  let bestScore = 0;
  for (const [role, s] of scores) {
    if (s > bestScore || (s === bestScore && zone !== null && role === zone)) {
      best = role;
      bestScore = s;
    }
  }
  return { best, score: bestScore };
}

export function heuristicClassify(blocks: readonly BlockRef[]): readonly RoleGuess[] {
  const guesses: RoleGuess[] = [];
  let zone: Role | null = null;
  for (const b of blocks) {
    if (b.kind === "heading") {
      zone = null;
      for (const [re, role] of ZONES) {
        if (re.test(b.text)) {
          zone = role;
          break;
        }
      }
      continue;
    }
    if (!isClassifiable(b.kind)) continue;
    const { best, score: s } = score(b.text, zone);
    if (best !== null && s >= 1) guesses.push({ hash: b.hash, role: best });
  }
  return guesses;
}
