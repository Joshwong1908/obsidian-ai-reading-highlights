export const ROLES = ["claim", "evidence", "caveat", "question", "definition"] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_CLASS: Readonly<Record<Role, string>> = {
  claim: "sr-claim",
  evidence: "sr-evidence",
  caveat: "sr-caveat",
  question: "sr-question",
  definition: "sr-definition",
};

export const ROLE_LABEL: Readonly<Record<Role, string>> = {
  claim: "结论 Claim",
  evidence: "证据 Evidence",
  caveat: "边界 Caveat",
  question: "疑问 Question",
  definition: "定义 Definition",
};

const ROLE_STRINGS: readonly string[] = ROLES;

export function parseRole(value: unknown): Role | null {
  return typeof value === "string" && ROLE_STRINGS.includes(value) ? (value as Role) : null;
}
