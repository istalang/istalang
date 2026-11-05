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
  genericDowncast: {
    code: 5154,
    message: (name: string) =>
      `'${name}' is generic, and a pattern gives no type arguments, so an 'any' value can't be matched against it.`,
  },
  notDowncast: {
    code: 5155,
    message: () =>
      "An 'any' value is matched by a pattern naming its value's own type: a type, a variant qualified by its enum, or '_'.",
  },
  requiredFieldChanged: {
    code: 5152,
    message: (field: string) =>
      `'${field}' is a field a trait requires, read through an 'any' value or a type parameter, so it can't change: only the value's own type has the field.`,
  },
} as const;
