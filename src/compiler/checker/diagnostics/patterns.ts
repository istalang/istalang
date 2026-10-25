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
      `'${name}' is neither a variant nor a constant, so a pattern can't compare with it.`,
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
  needsOptional: {
    code: 5406,
    message: (operator: string, found: string) =>
      `'${operator}' works on an optional, but this is ${found}.`,
  },
  chainNotPlace: {
    code: 5407,
    message: () => "A value read through '?.' is a copy, so it can't be assigned to or changed.",
  },
} as const;
