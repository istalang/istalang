/**
 * What a snapshot's calls made from outside any frame must fit (index.ts): an instance's starting
 * call, a run's, a resolver's callback's. One rule for all, since a pending callback becomes a run
 * as its resolver settles (../../scheduler/instance/ready.ts): its function carries as many
 * captures as given, takes the arguments passed, leaving out only what its code computes, and none
 * by reference. What is called back gives its value at once, as a run returns within its drive
 * (proposal 8, Rule 5).
 */

import type { Definition } from '../../../definition/definition.ts';
import type { FunctionId } from '../../../definition/operands.ts';
import {
  capturesOf,
  returnsAtOnce,
  takesArguments,
  takesReference,
} from '../../../definition/tables/functions.ts';

/** A call's shape: the function it calls, and how many captures and arguments it passes. */
interface CallShape {
  readonly function: FunctionId;
  readonly captures: number;
  readonly arguments: number;
}

/** What is wrong with `call` against the function it calls, which `described` names. */
export function callProblems(
  definition: Definition,
  call: CallShape,
  described: string,
): readonly string[] {
  const entry = definition.functions[call.function];
  if (entry === undefined) {
    return [`${described} calls function ${call.function}, which doesn't exist`];
  }
  const problems: string[] = [];
  const captures = capturesOf(entry);
  if (call.captures !== captures) {
    problems.push(`${entry.name} carries ${captures} captures, not ${call.captures}`);
  }
  if (!takesArguments(entry, call.arguments)) {
    problems.push(
      `${entry.name} takes ${entry.parameters.length} arguments, not ${call.arguments}`,
    );
  }
  if (entry.parameters.some((_, index) => takesReference(entry, index))) {
    problems.push(`${entry.name} takes a reference, which ${described} can't pass`);
  }
  return problems;
}

/** `callProblems` of a call made back, a run's or a callback's, whose function must not wait. */
export function calledBackProblems(
  definition: Definition,
  call: CallShape,
  described: string,
): readonly string[] {
  const entry = definition.functions[call.function];
  const waits =
    entry === undefined || returnsAtOnce(entry)
      ? []
      : [`${described} calls back ${entry.name}, which waits`];
  return [...callProblems(definition, call, described), ...waits];
}

/** The shape of a call passing `captures` and `arguments`, as a snapshot records one. */
export function shapeOf(call: {
  readonly function: FunctionId;
  readonly captures: readonly unknown[];
  readonly arguments: readonly unknown[];
}): CallShape {
  return {
    function: call.function,
    captures: call.captures.length,
    arguments: call.arguments.length,
  };
}
