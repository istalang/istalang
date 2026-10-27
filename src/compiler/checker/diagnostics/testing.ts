/**
 * The checker's diagnostics of tests, codes 5950–5999 (§10): suite functions, and the testing
 * module's calls whose arguments its signatures can't constrain. A part of the checker's one
 * catalog (index.ts).
 */

export const testingTemplates = {
  suiteSignature: {
    code: 5950,
    message: () => "A suite is a plain 'fn' taking nothing and returning Array<Test>.",
  },
  suiteEffect: {
    code: 5951,
    message: () =>
      "A suite function only builds its list of tests: it can't call an extern or touch a shared struct or a slot, so every call builds the same list.",
  },
  mockTarget: {
    code: 5952,
    message: () =>
      "A mock's target must name a function: a lambda or a variable has no identity to replace.",
  },
  handleOfNonExtern: {
    code: 5953,
    message: (type: string) =>
      `testing.handle makes a value of a host type, and ${type} isn't one.`,
  },
} as const;
