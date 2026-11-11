/**
 * Checking a snapshot against the Definition it names, before anything restores it (§5), so a
 * snapshot from another Definition, or a damaged one, is refused when it loads rather than midway
 * through a resume. The snapshot's schema already checked its own ids and references
 * (../snapshot.ts); what is left needs the Definition:
 * - every frame names a code entry, its pc lies inside that code and its registers inside its
 *   frame
 * - a caller frame stands at a `call`, and an execution's innermost frame at an `await` or a
 *   `select`, the only places an execution stops (docs/arch/definition.md, "Frames")
 * - an execution that waits does so on a wait of its own, which is decided exactly when it is
 *   ready, and every wait is one an execution stands at (waits.ts); a run is always ready, and its
 *   call fits the function it calls, as a new instance's does
 * - an async call's execution names a pending call future, and the instance has at most one root:
 *   the execution that names none, or the `outcome` it awaits once that returned (§9)
 * - a new instance's call starts a function, code or an extern, given its captures and its
 *   arguments by value, with values the Definition agrees with
 * - its outcome's encoder, when it has one, is an entry that can encode one, and a finished
 *   instance's JSON of its outcome is a `Json` value (§9)
 * - a cell is of a shared struct's type entry or a `_Cell<T>`'s, and a resource of an extern type
 * - every value held anywhere names types and functions the Definition has, and agrees with them,
 *   by the same check the Definition's own constants pass (definition/validation/references.ts)
 */

import type { Definition } from '../../../definition/definition.ts';
import { waits } from '../../../definition/instructions/flow.ts';
import type { Instruction } from '../../../definition/instructions/instruction.ts';
import type { FunctionId } from '../../../definition/operands.ts';
import {
  capturesOf,
  encoderProblem,
  takesReference,
} from '../../../definition/tables/functions.ts';
import { isCellType } from '../../../definition/tables/types.ts';
import { valueProblems } from '../../../definition/validation/references.ts';
import { isJsonValue, jsonTypeIn } from '../../../definition/values/json-values.ts';
import { type Handlers, handlerOf } from '../../../foundation/structures/kind-table.ts';
import { Refusal } from '../../refusal.ts';
import { valuesIn } from '../holdings.ts';
import type { Frame, HeapObject } from '../objects.ts';
import type { InstanceCall, Snapshot } from '../snapshot.ts';
import { waitProblems } from './waits.ts';

/** Throws a Refusal listing every way `snapshot` doesn't fit `definition`. */
export function checkSnapshot(definition: Definition, snapshot: Snapshot): void {
  const problems = [
    ...snapshot.objects.flatMap((object) => objectProblems(definition, object)),
    ...waitProblems(definition, snapshot),
    ...callFutureProblems(snapshot),
    ...contextConstantProblems(snapshot),
    ...startingCallProblems(definition, snapshot.status),
    ...encoderProblems(definition, snapshot.encoder),
    ...outcomeProblems(definition, snapshot.status),
  ];
  if (problems.length > 0) {
    throw new Refusal(
      'snapshotMismatch',
      `Instance '${snapshot.instance}' doesn't fit its Definition: ${problems.join('; ')}.`,
    );
  }
}

function objectProblems(definition: Definition, object: HeapObject): readonly string[] {
  const inValues = valuesIn(object).flatMap((value) =>
    valueProblems(definition, value).map(({ message }) => `object ${object.id}: ${message}`),
  );
  return [...inValues, ...handlerOf(kindProblems, object)(definition, object)];
}

/** What is wrong with each kind of object against the Definition, besides its values. */
const kindProblems: Handlers<Definition, HeapObject, [], readonly string[]> = {
  execution: (definition, execution) =>
    execution.frames.flatMap((frame, index) =>
      frameProblems(definition, frame, index === execution.frames.length - 1 ? waits : isCall).map(
        (problem) => `execution ${execution.id}: ${problem}`,
      ),
    ),
  cell: (definition, cell) =>
    isCellType(definition.types, cell.type) ? [] : [`cell ${cell.id} is not of a cell type`],
  resource: (definition, resource) =>
    definition.types[resource.type]?.kind === 'extern'
      ? []
      : [`resource ${resource.id} is not of an extern type`],
  mock: (definition, mock) =>
    mock.target < definition.functions.length
      ? []
      : [`mock ${mock.id} replaces function ${mock.target}, which doesn't exist`],
  run: (definition, run) => callProblems(definition, run, `run ${run.id}`),
  contextConstant: () => [],
  answer: () => [],
  outcome: () => [],
  wait: () => [],
  resolver: () => [],
  slot: () => [],
  future: () => [],
  weakRef: () => [],
};

/** Each context constant has one value in an instance at most (spec §3.4). */
function contextConstantProblems(snapshot: Snapshot): readonly string[] {
  const keys = snapshot.objects.flatMap((object) =>
    object.kind === 'contextConstant' ? [object.key] : [],
  );
  return new Set(keys).size === keys.length ? [] : ['a context constant has two values'];
}

/**
 * Every async call's execution resolves a pending call future of its own; only the root none, or
 * no execution, once the root returned the future the instance awaits as its `outcome`.
 */
function callFutureProblems(snapshot: Snapshot): readonly string[] {
  const objects = new Map(snapshot.objects.map((object) => [object.id, object]));
  const executions = snapshot.objects.filter((object) => object.kind === 'execution');
  const roots = [
    ...executions.filter((execution) => execution.resolves === undefined),
    ...snapshot.objects.filter((object) => object.kind === 'outcome'),
  ];
  const problems =
    roots.length > 1
      ? [`${roots.length} roots, executions resolving no call future or outcomes, not one`]
      : [];
  const resolved = executions.flatMap(({ resolves }) => (resolves === undefined ? [] : [resolves]));
  if (new Set(resolved).size < resolved.length) {
    problems.push('two executions resolve one future');
  }
  for (const execution of executions) {
    const future = execution.resolves === undefined ? undefined : objects.get(execution.resolves);
    if (
      execution.resolves !== undefined &&
      (future?.kind !== 'future' || future.state.kind !== 'call')
    ) {
      problems.push(`execution ${execution.id} resolves no pending call future`);
    }
  }
  return problems;
}

/** What is wrong with the call an instance starts with, or a retry starts it with again. */
function startingCallProblems(
  definition: Definition,
  status: Snapshot['status'],
): readonly string[] {
  const call = startingCallOf(status);
  if (call === undefined) {
    return [];
  }
  const values = [...call.captures, ...call.arguments].flatMap((value) =>
    valueProblems(definition, value).map(({ message }) => `the instance's call: ${message}`),
  );
  return [...values, ...callProblems(definition, call, "the instance's call")];
}

/** The call an instance starts with, or a retry starts it with again; none once it started. */
function startingCallOf(status: Snapshot['status']): InstanceCall | undefined {
  if (status.kind === 'unstarted') {
    return status.call;
  }
  return status.kind === 'panicked' && status.replay?.kind === 'call'
    ? status.replay.call
    : undefined;
}

/** What is wrong with the entry encoding the instance's outcome, if it has one. */
function encoderProblems(
  definition: Definition,
  encoder: FunctionId | undefined,
): readonly string[] {
  if (encoder === undefined) {
    return [];
  }
  const entry = definition.functions[encoder];
  const problem =
    entry === undefined ? `the outcome's encoder ${encoder} is no function` : encoderProblem(entry);
  return problem === undefined ? [] : [problem];
}

/** What is wrong with a finished instance's outcome and its JSON, if anything. */
function outcomeProblems(definition: Definition, status: Snapshot['status']): readonly string[] {
  if (status.kind !== 'finished') {
    return [];
  }
  const { outcome, encoded } = status;
  const problems = [outcome, ...(encoded === undefined ? [] : [encoded])].flatMap((value) =>
    valueProblems(definition, value).map(({ message }) => `the outcome: ${message}`),
  );
  const shape = jsonTypeIn(definition.types);
  if (encoded !== undefined && (shape === undefined || !isJsonValue(encoded, shape))) {
    problems.push("the outcome's JSON is no Json value");
  }
  return problems;
}

/**
 * What is wrong with `call` against the function it calls, values aside: a call made from outside
 * any frame, an instance's or a run's, which `described` names.
 */
function callProblems(
  definition: Definition,
  call: InstanceCall,
  described: string,
): readonly string[] {
  const entry = definition.functions[call.function];
  if (entry === undefined) {
    return [`${described} calls function ${call.function}, which doesn't exist`];
  }
  const problems: string[] = [];
  const captures = capturesOf(entry);
  if (call.captures.length !== captures) {
    problems.push(`${entry.name} carries ${captures} captures, not ${call.captures.length}`);
  }
  if (call.arguments.length !== entry.parameters.length) {
    problems.push(
      `${entry.name} takes ${entry.parameters.length} arguments, not ${call.arguments.length}`,
    );
  }
  if (entry.parameters.some((_, index) => takesReference(entry, index))) {
    problems.push(`${entry.name} takes a reference, which ${described} can't pass`);
  }
  return problems;
}

const isCall = (instruction: Instruction): boolean => instruction.kind === 'call';

/** A frame's problems; `standsAt` says which instructions it may stand at. */
function frameProblems(
  definition: Definition,
  frame: Frame,
  standsAt: (instruction: Instruction) => boolean,
): readonly string[] {
  const code = definition.functions[frame.function];
  if (code?.kind !== 'code') {
    return [`frame function ${frame.function} is not code`];
  }
  const problems = frame.registers
    .filter(([register]) => register >= code.registers)
    .map(([register]) => `register ${register} is outside ${code.name}'s ${code.registers}`);
  const instruction = code.instructions[frame.pc];
  if (instruction === undefined) {
    problems.push(`pc ${frame.pc} is outside ${code.name}`);
  } else if (!standsAt(instruction)) {
    problems.push(`${code.name} stands at a '${instruction.kind}' at pc ${frame.pc}`);
  }
  return problems;
}
