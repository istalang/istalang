/**
 * Diagnostics of checking types, codes 5000–5999 (§2–§4): one catalog. The codes every feature
 * shares (5000–5099) are here; a feature slice with a block of its own keeps its templates in a
 * part beside this one, named for the feature.
 *
 * Messages name types the way source writes them (types/type-text.ts), so the caller passes text.
 * A diagnostic about a value points at the expression that has it; one about a declaration points
 * at its name.
 */

import { defineDiagnostics } from '../../../diagnostics/catalog.ts';
import { boundaryTemplates } from './boundary.ts';
import { closureTemplates } from './closures.ts';
import { collectionTemplates } from './collections.ts';
import { concurrencyTemplates } from './concurrency.ts';
import { genericTemplates } from './generics.ts';
import { keyTemplates } from './keys.ts';
import { lifetimeTemplates, weakSideTemplates } from './lifetimes.ts';
import { packTemplates } from './packs.ts';
import { patternTemplates } from './patterns.ts';
import { templateTemplates } from './templates.ts';
import { testingTemplates } from './testing.ts';
import { traitObjectTemplates } from './trait-objects.ts';
import { typeMatchTemplates } from './type-matches.ts';
import { valueTemplates } from './values.ts';

export const checkerDiagnostics = defineDiagnostics('checker', {
  typeMismatch: {
    code: 5001,
    message: (expected: string, found: string) => `Expected ${expected}, found ${found}.`,
  },
  noMatchingOverload: {
    code: 5002,
    message: (name: string, argumentTypes: string, givenUnion = false) =>
      givenUnion
        ? `No '${name}' takes (${argumentTypes}), and no trait visible here that the union meets requires it; take the union apart with 'match' to call its members' own (§3.10).`
        : `No '${name}' takes (${argumentTypes}).`,
  },
  ambiguousCall: {
    code: 5003,
    message: (name: string, argumentTypes: string) =>
      `Several '${name}' take (${argumentTypes}); give the types explicitly.`,
  },
  argumentCount: {
    code: 5004,
    message: (name: string, expected: number, found: number, atLeast: boolean) =>
      `'${name}' takes ${atLeast ? 'at least ' : ''}${expected} argument${expected === 1 ? '' : 's'}, found ${found}.`,
  },
  branchTypes: {
    code: 5005,
    message: (first: string, other: string) =>
      `Every branch must have the same type: this one is ${other}, an earlier one ${first}.`,
  },
  ifWithoutElse: {
    code: 5006,
    message: (found: string) => `An 'if' without 'else' must have type Unit, not ${found}.`,
  },
  recursiveReturnType: {
    code: 5007,
    message: (name: string) => `'${name}' is recursive, so it needs a declared return type.`,
  },
  constReassigned: {
    code: 5008,
    message: (name: string, immutable: string) =>
      `'${name}' is ${immutable} and can't be reassigned.`,
  },
  letNeverReassigned: {
    code: 5009,
    severity: 'warning',
    message: (name: string, othersChange: boolean) =>
      othersChange
        ? `'${name}' is never reassigned; declare it with 'const', apart from the names that change.`
        : `'${name}' is never reassigned; declare it with 'const'.`,
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
    message: (operator: string, operands: readonly string[]) =>
      `'${operator}' isn't defined for ${operands.join(' and ')}.`,
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
  awaitOutsideAsync: {
    code: 5022,
    message: () => "'await' is allowed only inside an async function.",
  },
  awaitNeedsFuture: {
    code: 5023,
    message: (found: string) => `'await' waits on a Future, not ${found}.`,
  },
  missingStdModule: {
    code: 5024,
    message: (name: string) =>
      `This needs the std module '${name}', which the program didn't load.`,
  },
  unusedValue: {
    code: 5025,
    message: (type: string, use: string | undefined) =>
      `A ${type} must be used: ${use === undefined ? '' : `${use}, `}keep it in a variable, or drop it.`,
  },
  notConstant: {
    code: 5026,
    message: () =>
      'A top-level const needs a value compile time computes: literals, lambdas, other constants, and structs, arrays and maps built from them.',
  },
  constantCycle: {
    code: 5027,
    message: (name: string) => `'${name}' is defined through itself.`,
  },
  endlessDefault: {
    code: 5028,
    message: () =>
      "This value's field defaults build a value needing those defaults again, so it would never be finished.",
  },
  ...genericTemplates,
  ...keyTemplates,
  ...packTemplates,
  ...traitObjectTemplates,
  ...typeMatchTemplates,
  ...valueTemplates,
  ...collectionTemplates,
  ...patternTemplates,
  ...closureTemplates,
  ...concurrencyTemplates,
  ...lifetimeTemplates,
  ...weakSideTemplates,
  ...boundaryTemplates,
  ...testingTemplates,
  ...templateTemplates,
});
