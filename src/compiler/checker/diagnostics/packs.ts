/**
 * The checker's diagnostics of packs, codes 5080–5099 (§3.5): type parameters standing for a
 * tuple of types, where they may stand, and what a call passes one. A part of the checker's one
 * catalog (index.ts).
 */

export const packTemplates = {
  restNotPack: {
    code: 5080,
    message: (type: string) =>
      `A function type's rest is a pack, '...A' (§3.5), and '${type}' is no pack: a function value takes an array's rest as one array.`,
  },
  packNotLast: {
    code: 5087,
    message: () =>
      "A function type's rest, its pack, is its last parameter, and its only rest (§3.5).",
  },
  packOutsideFunction: {
    code: 5081,
    message: (name: string) =>
      `'${name}' can't be a pack: only a function's type parameters stand for a tuple of types (§3.5).`,
  },
  packConstrained: {
    code: 5082,
    message: (name: string, form: string) =>
      `The pack '${name}' takes no ${form}: its types are only passed through (§3.5).`,
  },
  packNamed: {
    code: 5083,
    message: (name: string) =>
      `'${name}' is a pack, whose arguments have no names: give them by position (§3.5).`,
  },
  packArguments: {
    code: 5084,
    message: (pack: string) =>
      `A pack (${pack}) takes single values by position, or one spread of a value of that pack (§3.5).`,
  },
  packTypeArgument: {
    code: 5085,
    message: (name: string, type: string) =>
      `'${type}' can't fill the pack '${name}': a pack takes a tuple type, such as '(int, string)', '(int,)' or '()' (§3.5).`,
  },
  packMismatch: {
    code: 5086,
    message: (expected: string, found: string) =>
      `These arguments fill a pack of ${expected}, not ${found} (§3.5).`,
  },
} as const;
