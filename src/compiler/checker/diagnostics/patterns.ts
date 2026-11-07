/**
 * The checker's diagnostics of patterns, optional operators and propagation, codes 5400–5499
 * (§3.11, §3.12, §4): a part of the checker's one catalog (index.ts).
 */

export const patternTemplates = {
  nonExhaustiveMatch: {
    code: 5400,
    message: (missing: string) =>
      `This 'match' doesn't handle ${missing}; add a case, or end with 'case _'.`,
  },
  unreachableCase: {
    code: 5401,
    severity: 'warning',
    message: () => 'No value reaches this case: the cases before it match everything it does.',
  },
  notPatternName: {
    code: 5402,
    message: (name: string) =>
      `'${name}' names no variant, type or constant, so a pattern can't compare with it.`,
  },
  propagateNeedsResult: {
    code: 5403,
    message: (found: string) =>
      `'?' takes a Result apart, but this is ${found}; use '??' or 'match' for an optional.`,
  },
  propagateOutsideResult: {
    code: 5404,
    message: (result: string) =>
      `'?' returns the Err from the function, so the function must return a Result, not ${result}.`,
  },
  propagateErrorType: {
    code: 5405,
    message: (returned: string, found: string) =>
      `'?' would return an Err of ${found} from a function whose Result holds ${returned}.`,
  },
  propagateOutsideFunction: {
    code: 5408,
    message: () => "'?' returns the Err from a function, but this value isn't in one.",
  },
  returnOutsideFunction: {
    code: 5410,
    message: () => "'return' leaves a function, but this value isn't in one.",
  },
  needsOptional: {
    code: 5406,
    message: (operator: string, found: string) =>
      `'${operator}' works on an optional, but this is ${found}.`,
  },
  forceUnwrap: {
    code: 5411,
    severity: 'warning',
    message: () =>
      "'!' panics when the optional is none; handle none with '??', 'is' or 'match' instead (§4).",
  },
  differentAlternatives: {
    code: 5412,
    message: () =>
      "Every alternative of '|' binds the same names, of the same types, so whichever matched, the body reads them (§3.11).",
  },
  notArrayPattern: {
    code: 5413,
    message: (found: string) => `An array pattern matches an Array, not ${found}.`,
  },
  notIntRangePattern: {
    code: 5414,
    message: (found: string) =>
      `A range pattern matches an Int between Int literals, not ${found} (§3.11).`,
  },
  emptyRangePattern: {
    code: 5415,
    message: () => 'This range pattern matches no Int: its end is not past its start.',
  },
  genericAliasPattern: {
    code: 5416,
    message: (name: string) =>
      `'${name}' is a generic alias, which stands for no one type without its type arguments, and a pattern gives none; name the type it stands for.`,
  },
  severalMembers: {
    code: 5418,
    message: (union: string, members: readonly string[], telling: string) =>
      `This pattern matches the members ${members.join(', ')} of ${union}; ${telling} (§3.11).`,
  },
  typeArgumentsOutsideUnion: {
    code: 5419,
    message: (name: string) =>
      `Only a pattern on a union gives type arguments, to tell apart its members instantiating '${name}'; here the value's type gives them (§3.11).`,
  },
  variantInBracesPattern: {
    code: 5433,
    message: (name: string) =>
      `A variant is taken apart by its call pattern, as in '${name}(…)', not by naming its fields in braces (§3.11).`,
  },
  decidedCondition: {
    code: 5421,
    severity: 'warning',
    message: (always: boolean) =>
      always
        ? "This is always true, by its operands' types: a branch it guards always runs (§4)."
        : "This is always false, by its operands' types: a branch it guards never runs (§4).",
  },
  heldNoValue: {
    code: 5422,
    severity: 'warning',
    message: () =>
      "No value reaches this case: its subject's type can't hold what the pattern matches, so it never runs (§3.11).",
  },
  patternTypeTwice: {
    code: 5423,
    message: (type: string) =>
      `This pattern names its type, ${type}, so the parameter takes no annotation, which would name it twice (§3.3).`,
  },
  patternWithoutBody: {
    code: 5424,
    message: (what: string) =>
      `A parameter's pattern binds names in a body of its function's own, which ${what} has none of: name the parameter (§3.3).`,
  },
  patternByReference: {
    code: 5425,
    message: () =>
      "A pattern takes a value apart, while '&' passes a place: a parameter taking a reference is a name (§3.3, §3.7).",
  },
  notVariantCalled: {
    code: 5426,
    message: (name: string) =>
      `'${name}' isn't a variant: only a variant is taken apart as a call is written; take a struct apart in braces (§3.11).`,
  },
  callPatternArity: {
    code: 5427,
    message: (variant: string, maximum: number, found: number) =>
      `'${variant}' has ${maximum} field${maximum === 1 ? '' : 's'} to match by position, found ${found} (§3.11).`,
  },
  callPatternMissing: {
    code: 5428,
    message: (variant: string, field: string) =>
      `This pattern gives no '${field}' of '${variant}': give it, or end the pattern with '...' to leave the fields it doesn't give (§3.11).`,
  },
  callPatternTwice: {
    code: 5429,
    message: (field: string) => `This pattern gives the field '${field}' twice (§3.11).`,
  },
  callPatternSpread: {
    code: 5430,
    message: (variant: string) =>
      `'${variant}' has no rest field for a spread to take; a lone '...' leaves the fields the pattern doesn't give (§3.11).`,
  },
  bareVariantPattern: {
    code: 5431,
    severity: 'warning',
    message: (name: string) =>
      `The variant '${name}' has fields: write '${name}(...)' to match it whatever they hold (§3.11).`,
  },
  defaultsCallPattern: {
    code: 5432,
    severity: 'warning',
    message: (name: string) =>
      `'${name}()' matches every '${name}', not only one built with its defaults: write '${name}(...)' (§3.11).`,
  },
  insideOptional: {
    code: 5409,
    message: (found: string, operator: string) =>
      `${found} is optional: reach inside it with '${operator}' (§4).`,
  },
} as const;
