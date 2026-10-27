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
  notTrait: {
    code: 5102,
    message: (keyword: string) => `Only a trait can follow '${keyword}'.`,
  },
  noFunctionNamed: {
    code: 5103,
    message: (name: string) => `No function '${name}' is visible here.`,
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
    message: (name: string) => `The alias '${name}' refers to itself; use a struct or an enum.`,
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
} as const;
