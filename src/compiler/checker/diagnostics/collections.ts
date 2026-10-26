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
  accessorToAsync: {
    code: 5307,
    message: (callee: string) =>
      `An element or a handle's value can't be passed by '&' to '${callee}', which is async: it is copied in and written back when its call returns (§3.7). Copy it into a 'let', pass that, and assign it back.`,
  },
  elementOverlap: {
    code: 5308,
    message: (variable: string, callee: string) =>
      `'${callee}' is passed two places of '${variable}' by '&', and one reaches through an element: an element is a copy for the call (§3.7), so the two couldn't change together. Pass them in separate calls.`,
  },
  handleOverlap: {
    code: 5309,
    message: (callee: string) =>
      `'${callee}' is passed two places by '&' that reach through handles: each is a copy for the call (§3.7), and two handles may be one, so the two couldn't change together. Pass them in separate calls.`,
  },
} as const;
