/**
 * Diagnostics of checking types, codes 5000–5999 (§2–§4).
 *
 * Messages name types the way source writes them (types/type-text.ts), so the caller passes text.
 * A diagnostic about a value points at the expression that has it; one about a declaration points
 * at its name.
 *
 * `notSupportedYet` is the one diagnostic for every construct the checker doesn't handle yet. Each
 * feature slice that adds a construct removes its use, so the code disappears with the last one.
 */

import { defineDiagnostics } from '../../diagnostics/catalog.ts';

export const checkerDiagnostics = defineDiagnostics('checker', {
  notSupportedYet: {
    code: 5000,
    message: (construct: string) => `${construct} is not supported yet.`,
  },
  typeMismatch: {
    code: 5001,
    message: (expected: string, found: string) => `Expected ${expected}, found ${found}.`,
  },
  noMatchingOverload: {
    code: 5002,
    message: (name: string, argumentTypes: string) => `No '${name}' takes (${argumentTypes}).`,
  },
  ambiguousCall: {
    code: 5003,
    message: (name: string, argumentTypes: string) =>
      `Several '${name}' take (${argumentTypes}); give the types explicitly.`,
  },
  argumentCount: {
    code: 5004,
    message: (name: string, expected: number, found: number) =>
      `'${name}' takes ${expected} argument${expected === 1 ? '' : 's'}, found ${found}.`,
  },
  branchTypes: {
    code: 5005,
    message: (first: string, other: string) =>
      `Every branch must have the same type: this one is ${other}, an earlier one ${first}.`,
  },
  ifWithoutElse: {
    code: 5006,
    message: (found: string) => `An 'if' without 'else' must have type unit, not ${found}.`,
  },
  recursiveReturnType: {
    code: 5007,
    message: (name: string) => `'${name}' is recursive, so it needs a declared return type.`,
  },
  constReassigned: {
    code: 5008,
    message: (name: string) => `'${name}' is a const and can't be reassigned.`,
  },
  letNeverReassigned: {
    code: 5009,
    severity: 'warning',
    message: (name: string) => `'${name}' is never reassigned; declare it with 'const'.`,
  },
  notCallable: {
    code: 5010,
    message: (name: string) => `'${name}' can't be called.`,
  },
  notValue: {
    code: 5011,
    message: (name: string) => `'${name}' is not a value.`,
  },
  notStruct: {
    code: 5012,
    message: (name: string) => `'${name}' is not a struct.`,
  },
  unknownField: {
    code: 5013,
    message: (type: string, field: string) => `${type} has no field '${field}'.`,
  },
  missingField: {
    code: 5014,
    message: (type: string, field: string) => `${type} needs a value for '${field}'.`,
  },
  repeatedField: {
    code: 5015,
    message: (field: string) => `'${field}' is given twice.`,
  },
  operatorTypes: {
    code: 5016,
    message: (operator: string, operands: string) => `'${operator}' isn't defined for ${operands}.`,
  },
  outsideLoop: {
    code: 5017,
    message: (keyword: string) => `'${keyword}' is only allowed inside a loop.`,
  },
  notAssignable: {
    code: 5018,
    message: () => 'Only a variable can be assigned here.',
  },
  notType: {
    code: 5019,
    message: (name: string) => `'${name}' is not a type.`,
  },
  typeArgumentCount: {
    code: 5020,
    message: (name: string, expected: number, found: number) =>
      `'${name}' takes ${expected} type argument${expected === 1 ? '' : 's'}, found ${found}.`,
  },
  asyncResult: {
    code: 5021,
    message: (found: string) => `An async function returns a Future, not ${found}.`,
  },
});
