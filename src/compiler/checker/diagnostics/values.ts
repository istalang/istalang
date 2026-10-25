/**
 * The checker's diagnostics of struct literals, tuples, destructuring, methods and references,
 * codes 5200–5299 (§3.1, §3.7, §3.15): a part of the checker's one catalog (index.ts).
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
  notPlace: {
    code: 5208,
    message: (use: 'assigned' | 'referenced') =>
      `Only a variable, or a field or element of one, can be ${use === 'assigned' ? 'assigned to' : 'passed by reference'}.`,
  },
  receiverNotPlace: {
    code: 5210,
    message: (name: string) =>
      `'${name}' changes its receiver, which must be a variable or a field of one.`,
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
  passing: {
    code: 5215,
    message: (name: string, position: number, reference: boolean) =>
      reference
        ? `'${name}' takes argument ${position} by reference: write '&' before it.`
        : `'${name}' takes argument ${position} by value: drop the '&'.`,
  },
} as const;
