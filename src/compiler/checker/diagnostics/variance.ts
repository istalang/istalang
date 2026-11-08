/**
 * The checker's diagnostics of variance, codes 5260–5289 (§3.5): where `gives` and `takes` may be
 * written, and what a written one must agree with. A part of the checker's one catalog (index.ts).
 */

export const varianceTemplates = {
  varianceOnHandle: {
    code: 5260,
    message: (word: string, name: string) =>
      `'${word} ${name}': a handle is invariant, since a value put in through one copy is read through every other; only an extern value or a struct or enum takes '${word}' (§3.5).`,
  },
  varianceNotHere: {
    code: 5261,
    message: (word: string, name: string, why: string) =>
      `'${word} ${name}': ${why}; only an extern value or a struct or enum takes '${word}' (§3.5).`,
  },
  varianceContradicted: {
    code: 5262,
    message: (word: string, name: string, derived: string) =>
      `'${word} ${name}' contradicts what the type holds: '${name}' is ${derived} there (§3.5).`,
  },
} as const;
