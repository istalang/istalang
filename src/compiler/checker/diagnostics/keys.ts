/**
 * The checker's diagnostics of struct keys, codes 5160–5169 (§3.1, §3.7, §3.9): `keyof`, `S[K]`,
 * mapped struct types, and reading or writing a field through a key. A part of the checker's one
 * catalog (index.ts).
 */

export const keyTemplates = {
  noStructKeys: {
    code: 5160,
    message: (type: string) =>
      `Only a struct type has keys, its fields' names, and ${type} is none: a struct declaration's, not shared or extern, a shape, or a type parameter with a struct constraint (§3.1).`,
  },
  notKeyOf: {
    code: 5161,
    message: (key: string, type: string) =>
      `${key} is no key of ${type}: a key is a String literal naming one of its fields, or a union of such (§3.1).`,
  },
  mappedKeysNotNames: {
    code: 5162,
    message: (keys: string) =>
      `A mapped entry gives a field to each String literal of its union, which ${keys} isn't a union of (§3.1).`,
  },
  mappedFieldName: {
    code: 5163,
    message: (name: string) =>
      `A mapped entry's key "${name}" can't name a field: a field's name is a camelCase name (§3.1).`,
  },
  severalMappedEntries: {
    code: 5164,
    message: () => 'An anonymous struct type has one mapped entry at most (§3.1).',
  },
  severalKeysReferenced: {
    code: 5165,
    message: (key: string) =>
      `A field passed by '&' is one place, but a key of ${key} may name several fields, each of its own type; narrow the key to one first (§3.7).`,
  },
};
