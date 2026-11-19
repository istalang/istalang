/**
 * The checker's diagnostics of values, codes 5060–5079 and 5200–5299 (§4.2, §5.2, §6.2, §4.5): a
 * part of the checker's one catalog (index.ts), a block of codes per family below.
 */

export const valueTemplates = {
  // Templates, 5060–5079 (§3.1): what a template's values need.
  notStringable: {
    code: 5060,
    message: (type: string) =>
      `A template writes each value as text with its toString, and no 'toString' takes ${type} and gives a String (§3.1).`,
  },

  // Struct literals, indented values, tuples, destructuring, methods and references, 5200–5299
  // (§3.2, §5.2, §7.3, §4.5).
  notTuple: {
    code: 5200,
    message: (found: string) => `${found} is not a tuple.`,
  },
  noTupleElement: {
    code: 5201,
    message: (type: string, element: number) => `${type} has no element ${element}.`,
  },
  tupleArity: {
    code: 5202,
    message: (expected: number, found: string) =>
      `This takes apart ${expected} values, but the value is ${found}.`,
  },
  refutableTarget: {
    code: 5203,
    message: () =>
      "A declaration's or assignment's target must always match; a pattern that can fail belongs in 'match' or 'is'.",
  },
  positionalNeedsOneField: {
    code: 5204,
    message: (type: string, count: number) =>
      `Only a struct with exactly one field takes a value without its name; ${type} has ${count}.`,
  },
  misplacedSpread: {
    code: 5205,
    message: () => 'A spread comes first, and only once.',
  },
  bareStruct: {
    code: 5206,
    message: (type: string) => `${type} has no fields, so it is written bare: ${type}.`,
  },
  constantChanged: {
    code: 5207,
    message: (name: string, immutable: string) =>
      `'${name}' is ${immutable}, so no part of it can change.`,
  },
  receiverNotPlace: {
    code: 5210,
    message: (name: string) =>
      `'${name}' changes its receiver, which must be a place: a variable, a field or element of one, or the value behind a shared struct, never a value read through '?.' or '?->', which is a copy.`,
  },
  recursiveField: {
    code: 5211,
    message: (type: string, field: string) =>
      `'${field}' makes every ${type} hold another ${type}; make it optional or put it in a collection.`,
  },
  notStructValue: {
    code: 5212,
    message: (found: string) => `${found} is not a struct, so it can't be taken apart by field.`,
  },
  unnamedAnonymousField: {
    code: 5213,
    message: () => "A 'struct{…}' with no type to take names every field.",
  },
  severalConversions: {
    code: 5222,
    message: (found: string, expected: string) =>
      `${found} converts into more than one member of ${expected}; convert it explicitly into the one meant (§4.2).`,
  },
  noMember: {
    code: 5214,
    message: (type: string, name: string) => `${type} has no field or method '${name}'.`,
  },
  assignedTwice: {
    code: 5217,
    message: (place: string, earlier: string) =>
      place === earlier
        ? `'${place}' is assigned twice in one assignment.`
        : `'${place}' overlaps '${earlier}', which the same assignment assigns.`,
  },
  sharedNeedsNew: {
    code: 5218,
    message: (type: string) =>
      `${type} is a shared struct, so a new one is built with 'new': new ${type}{…} (§5.4).`,
  },
  newNotShared: {
    code: 5219,
    message: (type: string) =>
      `Only a shared struct is built with 'new', and ${type} isn't one: drop the 'new' (§5.4).`,
  },
  notShared: {
    code: 5220,
    message: (found: string) =>
      `'*' and '->' read the value behind a shared struct, and a ${found} isn't one (§10.2).`,
  },
  fieldBehindShared: {
    code: 5221,
    message: (type: string, name: string, operator: string) =>
      `'${name}' is a field of the value behind the shared struct ${type}, not of its handle: read it as x${operator}${name} (§10.2).`,
  },
  getterShape: {
    code: 5223,
    message: (name: string) =>
      `Getter '${name}' must take exactly one parameter, 'self', by value, and not be async: reading it as a field gives it nothing else (§5.2).`,
  },
  fieldOrGetter: {
    code: 5224,
    message: (type: string, name: string) =>
      `${type} has both a field and a getter named '${name}': a name on a type is a field, a getter or a method, never two (§5.2).`,
  },
  getterNotPlace: {
    code: 5225,
    message: (name: string) =>
      `'${name}' is a getter, computed on every read: it can't be assigned or passed by '&' (§5.2).`,
  },
  keyedNotPlace: {
    code: 5228,
    message: (name: string) =>
      `'${name}' is a key read through an index, not a field: it can't be assigned or passed by '&' (§10.2).`,
  },
  keyedOrMember: {
    code: 5226,
    message: (type: string, name: string, member: 'field' | 'getter' | 'method') =>
      `${type} has a ${member} named '${name}', and its index takes '${name}' as a key: a name on a type means one thing (§5.2); write x["${name}"] to read the key.`,
  },
  unknownKey: {
    code: 5227,
    message: (type: string, name: string, keys: readonly string[]) =>
      `${type} has no member '${name}', and its index takes no such key${keys.length === 0 ? '' : `: it takes ${keys.join(', ')}`}.`,
  },
  passing: {
    code: 5215,
    message: (name: string, position: number, reference: boolean) =>
      reference
        ? `'${name}' takes argument ${position} by reference: write '&' before it.`
        : `'${name}' takes argument ${position} by value: drop the '&'.`,
  },
} as const;
