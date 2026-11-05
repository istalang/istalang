/**
 * The checker's diagnostics of generics and calls, codes 5100–5199 (§3.5, §3.7, §3.9–§3.11, §3.17):
 * a part of the checker's one catalog (index.ts).
 */

export const genericTemplates = {
  cannotInfer: {
    code: 5100,
    message: (name: string, parameter: string) =>
      `Can't infer '${parameter}' for '${name}'; give the type arguments explicitly.`,
  },
  notConforming: {
    code: 5101,
    message: (type: string, trait: string, missing: string) =>
      `${type} doesn't satisfy ${trait}: it needs ${missing}.`,
  },
  unmetStructConstraint: {
    code: 5134,
    message: (reason: string, type: string, constraint: string) =>
      `${reason[0]?.toUpperCase() ?? ''}${reason.slice(1)}, so ${type} doesn't meet ${constraint} (§3.5).`,
  },
  notTrait: {
    code: 5102,
    message: (keyword: string) => `Only a trait can follow '${keyword}'.`,
  },
  noFunctionNamed: {
    code: 5103,
    message: (name: string) => `No function '${name}' is visible here.`,
  },
  lowercaseConversion: {
    code: 5126,
    message: (name: string, primitive: string) =>
      `No function '${name}' is visible here; type names are PascalCase, so did you mean '${primitive}'?`,
  },
  noStaticFunction: {
    code: 5104,
    message: (type: string, name: string) => `${type} has no static function '${name}'.`,
  },
  overloadClash: {
    code: 5105,
    message: (name: string) =>
      `This '${name}' takes the same parameter types as another; overloads must differ.`,
  },
  aliasCycle: {
    code: 5106,
    message: (name: string) =>
      `The alias '${name}' refers to itself where it would have to be known first: a recursive alias names itself only inside a type built from others (a type argument, a field, a tuple element, a function's parameter or result) (§3.17).`,
  },
  irregularAlias: {
    code: 5128,
    message: (name: string, named: string) =>
      `The recursive alias '${name}' must pass its own type parameters, in order, where it names '${named}': other type arguments would need endlessly many types (§3.17).`,
  },
  bareVariant: {
    code: 5107,
    message: (name: string) =>
      `'${name}' is a variant, and no enum type is expected here; qualify it, as in 'Type.${name}'.`,
  },
  noneNeedsType: {
    code: 5108,
    message: () => "'none' needs an optional type to be expected here; annotate it.",
  },
  variantFields: {
    code: 5109,
    message: (name: string) =>
      `The variant '${name}' has fields; write it with braces, as in '${name}{…}'.`,
  },
  disposeCall: {
    code: 5110,
    message: () =>
      "'dispose' is called by the runtime once nothing holds a value; release it with 'drop'.",
  },
  expandingInstantiation: {
    code: 5111,
    message: (name: string) =>
      `'${name}' would need endlessly many instantiations: it calls itself, directly or not, with a type argument built from its own.`,
  },
  expandingType: {
    code: 5125,
    message: (type: string, field: string) =>
      `'${type}' would need endlessly many instantiations: its field '${field}' names it again, directly or not, with a type argument built from its own.`,
  },
  defaultCycle: {
    code: 5112,
    message: (name: string) => `A default value of '${name}' depends on '${name}' itself.`,
  },
  defaultMissing: {
    code: 5113,
    message: (name: string) =>
      `'${name}' comes after a parameter with a default, so it needs a default too.`,
  },
  endlessConformance: {
    code: 5114,
    message: (type: string, trait: string) =>
      `Finding how ${type} satisfies ${trait} doesn't end: what meets it needs ${trait} again, of a type as large or larger.`,
  },
  restNotLast: {
    code: 5115,
    message: (name: string) => `The rest parameter '${name}' must be the last parameter.`,
  },
  restNotArray: {
    code: 5116,
    message: (name: string, found: string) =>
      `The rest parameter '${name}' collects arguments into an array or a pack, so its type is an Array<T> or a pack (§3.5), not ${found}.`,
  },
  restDefault: {
    code: 5117,
    message: (name: string) =>
      `The rest parameter '${name}' can't have a default: it is empty when no argument fills it.`,
  },
  noParameterNamed: {
    code: 5118,
    message: (name: string, parameter: string) =>
      `'${name}' has no parameter named '${parameter}' to name in a call.`,
  },
  givenTwice: {
    code: 5119,
    message: (parameter: string) => `The parameter '${parameter}' is given twice.`,
  },
  missingArgument: {
    code: 5120,
    message: (name: string, parameter: string) =>
      `The call gives no '${parameter}', and '${name}' has no default for it.`,
  },
  spreadWithoutRest: {
    code: 5121,
    message: (name: string) => `'${name}' has no rest parameter for a spread to fill.`,
  },
  mockMadeAsync: {
    code: 5123,
    message: () =>
      "An async replacement can't mock a plain function: the target would be made async, which is another function.",
  },
  requiredDefault: {
    code: 5124,
    message: (name: string) =>
      `A trait's required function has no defaults, so '${name}' can't have one: each type meeting the trait could give another.`,
  },
  valueCallArgument: {
    code: 5122,
    message: (form: string) =>
      `A function value takes its arguments by position, so it takes no ${form}.`,
  },
  severalTraits: {
    code: 5127,
    message: (name: string, union: string, traits: readonly string[]) =>
      `'${name}' on ${union} could be what any of ${traits.join(', ')} requires, each a trait it meets; convert the value into the 'any' type of the one meant, then call it (§3.10).`,
  },
  noAssociatedType: {
    code: 5132,
    message: (type: string, name: string) => `${type} has no associated type '${name}' (§3.1).`,
  },
  severalOtherFields: {
    code: 5133,
    message: () =>
      "A struct constraint has one '[_]' entry at most: it constrains every field the others don't name (§3.5).",
  },
  notMemberArgument: {
    code: 5131,
    message: (parameter: string, union: string, found: string) =>
      `'${parameter}' stands for one member of ${union}, which ${found} isn't (§3.5).`,
  },
  severalMembersArgument: {
    code: 5130,
    message: (parameter: string, union: string, found: string) =>
      `'${parameter}' stands for one member of ${union}, and a value of ${found} may be several; narrow it first, with a literal or a pattern (§3.5).`,
  },
} as const;
