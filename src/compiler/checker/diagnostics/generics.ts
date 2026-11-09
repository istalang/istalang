/**
 * The checker's diagnostics of generics, codes 5080–5199 and 5380–5389 (§3.1, §3.5, §3.7,
 * §3.9–§3.11, §3.17): a part of the checker's one catalog (index.ts), a block of codes per family
 * below. How messages
 * spell a parameter is here too: messages of several parts name parameters, so the spelling is one.
 */

export const genericTemplates = {
  // Packs, 5080–5099 (§3.5): type parameters standing for a tuple of types, where they may
  // stand, and what a call passes one.
  restNotPack: {
    code: 5080,
    message: (type: string) =>
      `A function type's rest is a pack, '...A' (§3.5), and '${type}' is no pack: a function value takes an array's rest as one array.`,
  },
  packNotLast: {
    code: 5087,
    message: () =>
      "A function type's rest, its pack, is its last parameter, and its only rest (§3.5).",
  },
  packOutsideFunction: {
    code: 5081,
    message: (name: string) =>
      `'${name}' can't be a pack: only a function's type parameters stand for a tuple of types (§3.5).`,
  },
  packConstrained: {
    code: 5082,
    message: (name: string, form: string) =>
      `The pack '${name}' takes no ${form}: its types are only passed through (§3.5).`,
  },
  packNamed: {
    code: 5083,
    message: (name: string) =>
      `'${name}' is a pack, whose arguments have no names: give them by position (§3.5).`,
  },
  packArguments: {
    code: 5084,
    message: (pack: string) =>
      `A pack (${pack}) takes single values by position, or one spread of a value of that pack (§3.5).`,
  },
  packTypeArgument: {
    code: 5085,
    message: (name: string, type: string) =>
      `'${type}' can't fill the pack '${name}': a pack takes a tuple type, such as '(Int, String)', '(Int,)' or '()' (§3.5).`,
  },
  packMismatch: {
    code: 5086,
    message: (expected: string, found: string) =>
      `These arguments fill a pack of ${expected}, not ${found} (§3.5).`,
  },

  // Generics and calls, 5100–5149 (§3.5, §3.7, §3.9–§3.11, §3.17).
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
      `The alias '${name}' refers to itself where it would have to be known first: a recursive alias names itself only inside a type built from others (a nominal type's argument, or an alias's its body guards, a trait's argument in an 'any' type, a field, a tuple element, a function's parameter or result) (§3.17).`,
  },
  irregularAlias: {
    code: 5128,
    message: (name: string, named: string) =>
      `The recursive alias '${name}' must pass its own type parameters, in order, where it names '${named}': other type arguments would need endlessly many types (§3.17).`,
  },
  bareVariant: {
    code: 5107,
    message: (name: string, qualified: readonly string[]) =>
      qualified.length === 0
        ? `'${name}' is a variant, and no enum type is expected here; qualify it with its enum.`
        : `'${name}' is a variant, and no enum type is expected here; qualify it, as in ${qualified.map((each) => `'${each}'`).join(' or ')}.`,
  },
  noneNeedsType: {
    code: 5108,
    message: () => "'none' needs an optional type to be expected here; annotate it.",
  },
  variantFields: {
    code: 5109,
    message: (name: string, written: string) =>
      `The variant '${name}' has fields; give them, as in '${written}'.`,
  },
  variantInBraces: {
    code: 5139,
    message: (name: string) =>
      `A variant is built by calling it, as in '${name}(…)', not by naming its fields in braces or a block (§3.11).`,
  },
  fieldlessCalled: {
    code: 5138,
    severity: 'warning',
    message: (name: string) =>
      `The variant '${name}' has no fields, so it is a value: write '${name}', without '()' (§3.11).`,
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
    message: (name: string | undefined) =>
      `${spelledParameter(name, true)} comes after a parameter with a default, so it needs a default too.`,
  },
  parameterTypeMissing: {
    code: 5129,
    message: (name: string | undefined) =>
      `${spelledParameter(name, true)} has no type: write one, or give it a default to take it from (§3.3).`,
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
    message: (name: string | undefined) =>
      `A trait's required function has no defaults, so ${spelledParameter(name)} can't have one: each type meeting the trait could give another.`,
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
  associatedItself: {
    code: 5136,
    message: (use: string) =>
      `'${use}' refers to itself: an associated type may name itself only when its body is a type 'match', whose recursive uses close into a recursive type (§3.1, §3.17).`,
  },
  memberOfMemberParameter: {
    code: 5135,
    message: (parameter: string) =>
      `'${parameter}' stands for one member of a union, and a member parameter is one type already, with no members to choose from: write the union itself after 'in' (§3.5).`,
  },
  severalMembersArgument: {
    code: 5130,
    message: (parameter: string, union: string, found: string) =>
      `'${parameter}' stands for one member of ${union}, and a value of ${found} may be several; narrow it first, with a literal or a pattern (§3.5).`,
  },

  // Choosing in a constraint scope, 5380–5389 (§3.5): a call chosen only once what it is given
  // settled, which what the scope settled read as no call.
  undecidedCall: {
    code: 5380,
    message: (name: string) =>
      `Which '${name}' this calls can't be chosen while what it is given is still inferred; write the types it is given (§3.5).`,
  },

  // Trait objects, 5150–5159 (§3.10): `any` types, the traits they take, and values converted
  // into them or matched out of them.
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

  // Struct keys, 5160–5169 (§3.1, §3.7, §3.9, §4): `keyof`, `S[K]`, mapped struct types, a
  // field read or written through a key, what a field loop runs over, and the fields a struct
  // comprehension gives.
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
  comprehendedFieldsUnknown: {
    code: 5167,
    message: (type: string) =>
      `A struct comprehension over ${type}, whose fields aren't all known, builds only a type expected of it whose fields are its named fields and those (§3.1): give the literal one, such as a mapped struct type over its keys.`,
  },
  comprehendedFields: {
    code: 5168,
    message: (type: string) =>
      `This literal gives its named fields and those its struct comprehension runs over, which aren't exactly ${type}'s (§3.1).`,
  },
  fieldLoopSubject: {
    code: 5166,
    message: (type: string) =>
      `A field loop runs over the fields of a struct, and ${type} is none: a struct declaration's, not shared or extern, a shape, or a type parameter with a struct constraint; '...*x' runs over the value behind a shared struct (§4).`,
  },

  // Type `match`es, 5170–5179 (§3.5, §3.17): a use no case matches, reductions without end,
  // and `infer` written outside a case's pattern.
  noCaseMatches: {
    code: 5170,
    message: (use: string) =>
      `No case of ${use} matches its subject: a type match gives the type of its first case matching its subject, so it needs one that does, such as 'case _' (§3.17).`,
  },
  endlessTypeMatch: {
    code: 5171,
    message: (alias: string) =>
      `${alias} reduces to itself with a type built from its own type parameter, so its reductions never end (§3.5, §3.17).`,
  },
  inferOutsideCase: {
    code: 5172,
    message: () =>
      "'infer' binds a type variable only in a type match case's pattern, to the part of the subject standing there (§3.17).",
  },
} as const;

/**
 * `'name'`, or "this pattern" for a parameter that is a pattern alone, capitalized to start a
 * sentence.
 */
export function spelledParameter(name: string | undefined, starts = false): string {
  if (name !== undefined) {
    return `'${name}'`;
  }
  return starts ? 'This pattern' : 'this pattern';
}
