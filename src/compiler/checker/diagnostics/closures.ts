/**
 * The checker's diagnostics of closures and function values, codes 5500–5599 (§3.8, §3.14): a part
 * of the checker's one catalog (index.ts).
 */

import { spelledParameter } from './generics.ts';

export const closureTemplates = {
  nestedFunctionForm: {
    code: 5500,
    message: (form: string) =>
      `A lambda or local function can't have ${form}: it is a single value (§3.14).`,
  },
  parameterTypeUnknown: {
    code: 5501,
    message: (name: string | undefined, expectedParameters: number | undefined) =>
      expectedParameters === undefined
        ? `The type of ${spelledParameter(name)} can't be inferred: write it, or pass the lambda where a function type is expected.`
        : `The type of ${spelledParameter(name)} can't be inferred: the function type expected here takes only ${expectedParameters} parameter(s).`,
  },
  capturedReference: {
    code: 5502,
    message: (name: string) => `'${name}' is a reference, which a closure can't capture.`,
  },
  functionValueUnchosen: {
    code: 5503,
    message: (name: string) =>
      `'${name}' names several functions, or a generic one: use it where a function type is expected.`,
  },
  methodValue: {
    code: 5504,
    message: (name: string) => `'${name}' is a method: call it, or wrap the call in a lambda.`,
  },
  fieldOrMethod: {
    code: 5505,
    message: (type: string, name: string, valued: 'field' | 'getter') =>
      `${type} has both a ${valued} and a method named '${name}': write (x.${name})(…) to call ${valued === 'field' ? 'the field' : 'what the getter gives'}.`,
  },
  notFunction: {
    code: 5506,
    message: (found: string) => `A ${found} can't be called: it isn't a function.`,
  },
  functionValueMisfit: {
    code: 5507,
    message: (name: string, expected: string) =>
      `'${name}' fits no ${expected}: none of the functions it names takes those parameters as they are.`,
  },
  typeArgumentsOnValue: {
    code: 5508,
    message: (name: string) =>
      `Only a function named as a value takes type arguments, and '${name}' names none (§3.5).`,
  },
} as const;
