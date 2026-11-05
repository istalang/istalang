/**
 * The checker's diagnostics of type `match`es, codes 5170–5179 (§3.5, §3.17): a use no case
 * matches, reductions without end, and `infer` written outside a case's pattern. A part of the
 * checker's one catalog (index.ts).
 */

export const typeMatchTemplates = {
  noCaseMatches: {
    code: 5170,
    message: (use: string) =>
      `No case of ${use} matches its subject: a type match gives the type of its first case matching its subject, so it needs one that does, such as 'case _' (§3.17).`,
  },
  endlessTypeMatch: {
    code: 5171,
    message: (alias: string) =>
      `${alias} reduces to itself with a type built from its own type parameter, so its reductions never end (§3.5, §3.17).`,
  },
  inferOutsideCase: {
    code: 5172,
    message: () =>
      "'infer' binds a type variable only in a type match case's pattern, to the part of the subject standing there (§3.17).",
  },
};
