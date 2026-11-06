/**
 * A filling entry (instances.ts): code taking a call's arguments as the call passes them, which
 * runs the function's own entry with every parameter, those the call leaves out computed by their
 * defaults' entries (../calls/emit-call.ts), the same as a call written in code fills them. It is
 * what an entry called later gets: a function named as a value of a shorter function type (§3.14),
 * a spawned call (§9), so the new instance computes the defaults, and a call the runtime makes.
 *
 * Its parameters are the arguments in the order passed, each taken as its parameter takes it; a
 * reference is passed on as the reference it was given (§3.7). For an async function it is async
 * too, and awaits the function's future, so a spawned instance it starts ends with the function's
 * value, as one the function starts itself does (§3.3).
 */

import type { CodeFunction } from '../../../definition/functions.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import { type Binding, parameterOfArgument } from '../../checker/surface/resolved-call.ts';
import { callOfFilling } from '../calls/closed-calls.ts';
import type { CodeContext } from '../context.ts';
import { SynthesizedCode } from '../synthesized/index.ts';
import type { FunctionInstance } from './instances.ts';

/** The code of `instance`, a filling entry filling its function's parameters as `binding` says. */
export function fillingEntry(
  context: Pick<CodeContext, 'checker' | 'tables'>,
  instance: FunctionInstance,
  binding: Binding,
): CodeFunction {
  const { declaration } = instance;
  const parameters = context.checker.parametersOf(declaration);
  const passed = [...parameterOfArgument(binding)]
    .sort(([first], [second]) => first - second)
    .map(([argument, parameter]) => {
      const passedTo = parameters[parameter];
      if (passedTo === undefined) {
        unreachable(`Argument ${argument} is bound to no parameter.`);
      }
      return passedTo.reference;
    });
  const code = new SynthesizedCode(context, declaration.name.span, passed.length);
  const result = code.call(
    callOfFilling(instance, binding),
    code.parameters.map((_, index) => code.passedOn(index, passed)),
  );
  const { isAsync } = declaration;
  code.return(isAsync ? code.await(result) : result);
  return code.entry(context.tables.entryHeader(instance), isAsync, passed);
}
