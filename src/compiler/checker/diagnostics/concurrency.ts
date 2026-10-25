/**
 * The checker's diagnostics of concurrency, codes 5600–5699 (§3.14, §6, §8, §9): `select`,
 * `spawn` and sendable function types. A part of the checker's one catalog (index.ts).
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
  spawnNeedsCall: {
    code: 5603,
    message: () => "'spawn' starts a call as a new instance: write 'spawn f(arguments)'.",
  },
  notSpawnable: {
    code: 5604,
    message: (callee: string, reason: string) => `${callee} can't be spawned: ${reason}.`,
  },
  unsendableArgument: {
    code: 5605,
    message: (found: string) =>
      `A spawn argument is copied into the new instance, so it must be sendable, and ${found} isn't.`,
  },
} as const;
