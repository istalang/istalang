/**
 * The checker's diagnostics of concurrency, codes 5600–5699 (§3.14, §6, §8): `select`, sendable
 * function types, and deferred calls (5640–5649), which give a function making a call later, as
 * `spawn` and `defer` take one (§7, §9). A part of the checker's one catalog (index.ts).
 */

export const concurrencyTemplates = {
  caseNeedsFuture: {
    code: 5600,
    message: (found: string) => `A select case waits on a Future, not ${found}.`,
  },
  selectWithoutElse: {
    code: 5601,
    message: () =>
      "A 'select' without 'await' never waits, so it needs an 'else' for when no case is ready.",
  },
  awaitedSelectElse: {
    code: 5602,
    message: () => "An 'await select' waits for one of its cases, so it has no 'else'.",
  },
  deferredNeedsCall: {
    code: 5640,
    message: () =>
      "A deferred call gives its taker a call to make later: write 'g f(arguments)' (§3.14).",
  },
  takesNoCall: {
    code: 5641,
    message: (name: string) =>
      `'${name}' doesn't take a call to run later: none of its parameters left unfilled is a function taking nothing, 'fn() -> X' (§3.14).`,
  },
  missingComma: {
    code: 5642,
    message: (taker: string) =>
      `'${taker}' is no function, so it takes no call to run later: is a ',' missing after it (§3.14)?`,
  },
  deferredReference: {
    code: 5643,
    message: () =>
      "A deferred call computes what it passes now, and no reference can be captured, so it can't pass one by '&' (§3.14).",
  },
  unsendableCapture: {
    code: 5644,
    message: (found: string) =>
      `A sendable function is taken here, so what the deferred call computes now must be sendable, and ${found} isn't (§3.14).`,
  },
  notDeferrable: {
    code: 5645,
    message: (callee: string, reason: string) => `${callee} can't be deferred: ${reason}.`,
  },
} as const;
