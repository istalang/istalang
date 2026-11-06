/**
 * The checker's diagnostics of lifetimes (§3.4, §4, §7), a part of the checker's one catalog
 * (index.ts):
 *
 * - holders and disposal, codes 5700–5799, the labels `hold`, `break` and `continue` name included;
 * - the weak side of disposal, codes 5800–5899: an async call's `disposing()`. Which name denotes
 *   the call, and where none does, is the binder's to report.
 */

export const lifetimeTemplates = {
  disposeType: {
    code: 5700,
    message: (type: string) =>
      `'dispose' can't be declared for ${type}: only a shared struct (§3.18) or an extern type a host provides has a single identity to dispose (§7).`,
  },
  disposeSignature: {
    code: 5701,
    message: () =>
      "'dispose' takes its value as its one parameter, returns Unit and can't be async (§7).",
  },
  disposeSelfEscapes: {
    code: 5702,
    message: (name: string) =>
      `In 'dispose', '${name}' can only be used as '*${name}', '${name}->field' or passed to an extern function, so the value can't outlive its disposal.`,
  },
  disposeNotFound: {
    code: 5703,
    message: (type: string) =>
      `This 'dispose' is never found for ${type}: declare one, beside the type it disposes, in that type's module.`,
  },
  droppedVariableUsed: {
    code: 5704,
    message: (name: string) => `'${name}' was dropped, so it can't be used here.`,
  },
  notDroppable: {
    code: 5705,
    message: (name: string, reason: string) => `'${name}' can't be dropped: ${reason}.`,
  },
  unknownLoopLabel: {
    code: 5706,
    message: (keyword: string, name: string) =>
      `No loop around this '${keyword}' is labelled '${name}'.`,
  },
  blockLabel: {
    code: 5707,
    message: (keyword: string, name: string) =>
      `'${name}' labels a block, which only 'hold' names; '${keyword}' names a loop.`,
  },
  unknownHoldScope: {
    code: 5708,
    message: (name: string) =>
      `No loop or block around this 'hold' is labelled '${name}', and it isn't this function's name.`,
  },
  repeatedLabel: {
    code: 5709,
    message: (name: string) => `'${name}' already labels a loop or block around this one.`,
  },
  ownNameLabel: {
    code: 5710,
    message: (name: string) =>
      `'${name}' is this function's own name, which 'hold(${name})' names, so it can't label a loop or block.`,
  },
  unusedLabel: {
    code: 5711,
    severity: 'warning',
    message: (name: string) => `Nothing names the label '${name}'; remove it.`,
  },
} as const;

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
