/**
 * The checker's diagnostics of collections, indexing and iteration, codes 5300–5399 (§2, §3.9,
 * §3.10): a part of the checker's one catalog (index.ts).
 */

export const collectionTemplates = {
  emptyCollection: {
    code: 5300,
    message: (literal: string) =>
      `An empty '${literal}' needs an expected type; annotate it, as in 'let xs: Array<int> = []'.`,
  },
  itemTypes: {
    code: 5301,
    message: (part: 'element' | 'key' | 'value', expected: string, found: string) =>
      `Every ${part} of a collection literal must have one type: expected ${expected}, found ${found}.`,
  },
  notIterable: {
    code: 5302,
    message: (type: string) =>
      `${type} isn't iterable: no 'iterate' takes it and returns an array (§3.10).`,
  },
  notIndexAssignable: {
    code: 5303,
    message: (container: string, key: string) =>
      `Elements of ${container} can't be written: no 'setIndex' takes ${container} with ${key} keys.`,
  },
  mapLiteralType: {
    code: 5304,
    message: (type: string) =>
      `A map literal of type ${type} needs a static '${type}.default()' and a 'setIndex' that takes its entries.`,
  },
  mapSpreadItems: {
    code: 5305,
    message: (item: string) =>
      `A spread in a map literal needs (key, value) items, but iterating gives ${item}.`,
  },
  asyncCollectionFunction: {
    code: 5306,
    message: (name: string) =>
      `'${name}' is async, but a collection runs its '${name}' at once, so it must be a plain function (§3.9).`,
  },
} as const;
