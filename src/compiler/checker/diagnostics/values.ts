/**
 * The checker's diagnostics of struct literals, indented values, tuples, destructuring, methods and
 * references, codes 5200–5299 (§2, §3.1, §3.7, §3.15): a part of the checker's one catalog
 * (index.ts).
 */

export const valueTemplates = {
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
      `${found} converts into more than one member of ${expected}; convert it explicitly into the one meant (§2).`,
  },
  noMember: {
    code: 5214,
    message: (type: string, name: string) => `${type} has no field or method '${name}'.`,
  },
  variantSpread: {
    code: 5216,
    message: () =>
      "A variant isn't built by spreading a value: which variant the value holds isn't known when compiling.",
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
      `${type} is a shared struct, so a new one is built with 'new': new ${type}{…} (§3.18).`,
  },
  newNotShared: {
    code: 5219,
    message: (type: string) =>
      `Only a shared struct is built with 'new', and ${type} isn't one: drop the 'new' (§3.18).`,
  },
  notShared: {
    code: 5220,
    message: (found: string) =>
      `'*' and '->' read the value behind a shared struct, and a ${found} isn't one (§3.9).`,
  },
  fieldBehindShared: {
    code: 5221,
    message: (type: string, name: string, operator: string) =>
      `'${name}' is a field of the value behind the shared struct ${type}, not of its handle: read it as x${operator}${name} (§3.9).`,
  },
  itemsInKeyedValue: {
    code: 5223,
    message: (built: 'struct' | 'map') =>
      `An item ('- value') stands where a ${built} is built: its entries are 'key: value' lines (§2).`,
  },
  keysInArray: {
    code: 5224,
    message: () => "A key stands where an array is built: its entries are '- item' lines (§2).",
  },
  itemsAndKeys: {
    code: 5225,
    message: () =>
      "An indented value holds items ('- value') or keys ('key: value'), never both: which would it build? (§2)",
  },
  quotedKeyInStruct: {
    code: 5226,
    message: () =>
      'A quoted key stands where a struct is built, whose keys are its field names: write the name bare (§2).',
  },
  keysNotStrings: {
    code: 5227,
    message: (map: string) =>
      `An indented value's keys are Strings, which ${map}'s keys can't be: write it as a bracket literal, '[k: v]' (§2).`,
  },
  comprehensionInMap: {
    code: 5228,
    message: () =>
      "A struct comprehension gives a struct's fields, but a map is built here: build it with a comprehension in brackets (§2, §4).",
  },
  passing: {
    code: 5215,
    message: (name: string, position: number, reference: boolean) =>
      reference
        ? `'${name}' takes argument ${position} by reference: write '&' before it.`
        : `'${name}' takes argument ${position} by value: drop the '&'.`,
  },
} as const;
