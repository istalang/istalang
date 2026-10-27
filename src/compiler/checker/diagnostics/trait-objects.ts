/**
 * The checker's diagnostics of trait objects, codes 5150–5199 (§3.10): `any` types, the traits
 * they take, and values converted into them or matched out of them. A part of the checker's one
 * catalog (index.ts).
 */

export const traitObjectTemplates = {
  notObjectSafe: {
    code: 5150,
    message: (trait: string, reason: string) =>
      `'any' can't take ${trait}: its value's own type is known only when it runs, but ${reason}.`,
  },
  repeatedTrait: {
    code: 5151,
    message: (trait: string) => `${trait} is already among this 'any' type's traits.`,
  },
  anyFieldChanged: {
    code: 5152,
    message: (field: string) =>
      `'${field}' is read through an 'any' value, so it can't change: only the value's own type has the field.`,
  },
} as const;
