/**
 * The checker's diagnostics of the weak side of disposal, codes 5800–5899 (§7): an async call's
 * `disposing()`. Which name denotes the call, and where none does, is the binder's to report. A
 * part of the checker's one catalog (index.ts).
 */

export const weakSideTemplates = {
  awaitInCleanup: {
    code: 5802,
    severity: 'warning',
    message: () =>
      "The call is being disposed, so this 'await' stops it: cleanup in a 'disposing()' case can't wait.",
  },
} as const;
