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
  noMemberMatched: {
    code: 5417,
    message: (union: string) => `This pattern matches no member of ${union} (§3.11).`,
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
  variantRest: {
    code: 5420,
    message: (variant: string) =>
      `A rest takes a struct's other fields, as a struct of their own; the variant '${variant}' is no struct, so name the fields it reads (§3.11).`,
  },
  decidedCondition: {
    code: 5421,
    severity: 'warning',
    message: (always: boolean) =>
      always
        ? "This condition is always true, by its operands' types: what follows it never runs (§4)."
        : "This condition is always false, by its operands' types: its branch never runs (§4).",
  },
  heldNoValue: {
    code: 5422,
    severity: 'warning',
    message: () =>
      "No value reaches this case: its subject's type can't hold this literal, so it never runs (§4).",
  },
  insideOptional: {
    code: 5409,
    message: (found: string, operator: string) =>
      `${found} is optional: reach inside it with '${operator}' (§4).`,
  },
} as const;
