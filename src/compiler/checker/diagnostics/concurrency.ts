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
  unmarkedCalls: {
    code: 5606,
    message: (caller: string, kind: string, callee: string) =>
      `${caller} calls ${kind} ${callee}; declare it '${kind} fn' (§3.3).`,
  },
  kindsMeet: {
    code: 5607,
    message: (callerKind: string, calleeKind: string, callee: string) =>
      `${callerKind} code calls nothing ${calleeKind}: ${callee} is ${calleeKind} (§3.3).`,
  },
  waitOfOtherKind: {
    code: 5608,
    message: (found: string, kind: string) =>
      `An 'await' waits in its function's kind, ${kind}, so it can't wait on ${found} (§5).`,
  },
  unmarkedWaits: {
    code: 5611,
    message: (waiter: string, kind: string, found: string, head: string) =>
      `${waiter} waits on ${found}, of kind ${kind}; declare it '${kind} ${head}' (§3.3).`,
  },
  unkindedFuture: {
    code: 5612,
    message: () =>
      `An unmarked 'async fn' type here has no kind for its future to take; write 'live async fn' or 'ista async fn' (§3.3).`,
  },
  oneKindOfEither: {
    code: 5613,
    message: (holder: string) =>
      `${holder} runs in one kind, which code that may run in either can't give it; declare the function calling it 'live' or 'ista' (§3.3).`,
  },
  unmarkedHolds: {
    code: 5609,
    message: (holder: string, kind: string, held: string) =>
      `${holder} holds ${held}, of kind ${kind}; declare it '${kind} fn' (§3.3).`,
  },
  kindsHeld: {
    code: 5610,
    message: (holder: string, kind: string, held: string) =>
      `${holder} is ${kind} code, so it can't hold ${held}, of the other kind (§3.3).`,
  },
} as const;
