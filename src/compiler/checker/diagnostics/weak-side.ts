/**
 * The checker's diagnostics of the weak side of disposal, codes 5800–5899 (§7): an async call's
 * own handle, which its function's name is before a `.`, and its `disposing()`. A part of the
 * checker's one catalog (index.ts).
 */

export const weakSideTemplates = {
  notOwnCall: {
    code: 5800,
    message: (name: string) =>
      `Before a '.', '${name}' is the call of an enclosing async fn named '${name}', and there is none.`,
  },
  mainNeverDisposed: {
    code: 5801,
    message: () => "Nothing holds the call of 'main', so 'main.disposing()' would never resolve.",
  },
  awaitInCleanup: {
    code: 5802,
    severity: 'warning',
    message: () =>
      "The call is being disposed, so this 'await' stops it: cleanup in a 'disposing()' case can't wait.",
  },
} as const;
