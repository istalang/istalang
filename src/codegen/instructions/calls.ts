/**
 * Emitting calls (definition/instructions/calls.ts): a direct call is a JavaScript call to the
 * entry's function, `f<n>` for code and `x<n>` for an extern; a function value's call goes through
 * the program's function table by the closure's function. Every function takes the closure it runs
 * first, `null` for a direct call.
 */

import type { callInstructions } from '../../definition/instructions/calls.ts';
import type { Argument } from '../../definition/instructions/places.ts';
import type { EntryScope } from '../entry-scope.ts';
import type { Emitters } from './emitters.ts';

export const callEmitters: Emitters<typeof callInstructions> = {
  call: (scope, i) => {
    const passed = i.arguments.map((argument) => `, ${argumentOf(scope, argument)}`).join('');
    const call =
      i.callee.kind === 'function'
        ? `${scope.functionName(i.callee.function)}(null${passed})`
        : `(t = ${scope.read(i.callee.register)}, F[t.function](t${passed}))`;
    return i.dst === undefined ? `${call};` : scope.write(i.dst, call);
  },
  currentCall: (scope, i) => scope.write(i.dst, 'run.currentCall()'),
};

function argumentOf(scope: EntryScope, argument: Argument): string {
  switch (argument.kind) {
    case 'value':
      return scope.read(argument.register);
    case 'reference':
      return scope.place(argument.place);
    case 'omitted':
      return 'undefined';
    default: {
      const unhandled: never = argument;
      return unhandled;
    }
  }
}
