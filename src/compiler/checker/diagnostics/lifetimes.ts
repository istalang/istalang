/**
 * The checker's diagnostics of holders and disposal, codes 5700–5799 (§3.4, §7): a part of the
 * checker's one catalog (index.ts).
 */

export const lifetimeTemplates = {
  disposeType: {
    code: 5700,
    message: (type: string) =>
      `'dispose' can't be declared for ${type}: only a 'Shared' instantiation or an extern type a host provides has a single identity to dispose (§7).`,
  },
  disposeSignature: {
    code: 5701,
    message: () =>
      "'dispose' takes its value as its one parameter, returns unit and can't be async (§7).",
  },
  disposeSelfEscapes: {
    code: 5702,
    message: (name: string) =>
      `In 'dispose', '${name}' can only be used as '${name}$' or passed to an extern function, so the value can't outlive its disposal.`,
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
} as const;
