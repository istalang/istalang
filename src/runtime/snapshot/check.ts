/**
 * Checking a snapshot against the Definition it names, before anything restores it (§5), so a
 * snapshot from another Definition, or a damaged one, is refused when it loads rather than midway
 * through a resume. The snapshot's schema already checked its own ids and references
 * (snapshot.ts); what is left needs the Definition:
 * - every frame names a code entry, its pc lies inside that code and its registers inside its
 *   frame
 * - a caller frame stands at a `call`, and an execution's innermost frame at an `await` or a
 *   `select`, the only places an execution stops (docs/arch/definition.md, "Frames")
 * - an execution that waits does so on futures, and is ready exactly when one has resolved
 * - an async call's execution names a pending call future, and at most one execution, the root,
 *   names none
 * - a new instance's call starts a function with code, given its captures and its arguments by
 *   value, with values the Definition agrees with
 * - a cell is a `Shared` instantiation and a resource of an extern type
 * - every value held anywhere names types and functions the Definition has, and agrees with them,
 *   by the same check the Definition's own constants pass (definition/references.ts)
 */

import type { Definition } from '../../definition/definition.ts';
import { takesReference } from '../../definition/functions.ts';
import { awaitedRegisters, waits } from '../../definition/instructions/flow.ts';
import type { Instruction } from '../../definition/instructions/instruction.ts';
import { valueProblems } from '../../definition/references.ts';
import { isSharedCellType, sharedTypeName } from '../../definition/types.ts';
import { handleTarget } from '../../definition/values.ts';
import { Refusal } from '../refusal.ts';
import { type Frame, type HeapObject, isReference } from './objects.ts';
import { type InstanceCall, type Snapshot, valuesIn } from './snapshot.ts';

/** Throws a Refusal listing every way `snapshot` doesn't fit `definition`. */
export function checkSnapshot(definition: Definition, snapshot: Snapshot): void {
  const problems = [
    ...snapshot.objects.flatMap((object) => objectProblems(definition, object)),
    ...waitProblems(definition, snapshot),
    ...callFutureProblems(snapshot),
    ...startingCallProblems(definition, snapshot.status),
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
  return [...inValues, ...kindProblems(definition, object)];
}

function kindProblems(definition: Definition, object: HeapObject): readonly string[] {
  switch (object.kind) {
    case 'execution':
      return object.frames.flatMap((frame, index) =>
        frameProblems(definition, frame, index === object.frames.length - 1 ? waits : isCall).map(
          (problem) => `execution ${object.id}: ${problem}`,
        ),
      );
    case 'cell':
      return isSharedCellType(definition.types, object.type)
        ? []
        : [`cell ${object.id} is not a ${sharedTypeName}`];
    case 'resource':
      return definition.types[object.type]?.kind === 'extern'
        ? []
        : [`resource ${object.id} is not of an extern type`];
    case 'mock':
      return object.target < definition.functions.length
        ? []
        : [`mock ${object.id} replaces function ${object.target}, which doesn't exist`];
    default:
      return [];
  }
}

/**
 * An execution stands at an instruction that waits on the futures its registers name, and is ready
 * exactly when one of them has resolved; nothing is ready twice, and nothing ready stands anywhere
 * else.
 */
function waitProblems(definition: Definition, snapshot: Snapshot): readonly string[] {
  const objects = new Map(snapshot.objects.map((object) => [object.id, object]));
  const ready = new Set(snapshot.ready);
  const problems = ready.size === snapshot.ready.length ? [] : ['an execution is ready twice'];
  for (const object of snapshot.objects) {
    if (object.kind === 'execution') {
      problems.push(...executionWaitProblems(definition, objects, object, ready.has(object.id)));
    }
  }
  return problems;
}

function executionWaitProblems(
  definition: Definition,
  objects: ReadonlyMap<number, HeapObject>,
  execution: Extract<HeapObject, { kind: 'execution' }>,
  isReady: boolean,
): readonly string[] {
  const top = execution.frames.at(-1);
  const instruction = top === undefined ? undefined : instructionAt(definition, top);
  const awaited = instruction === undefined ? [] : awaitedRegisters(instruction);
  if (top === undefined || awaited.length === 0) {
    return isReady ? [`ready execution ${execution.id} is not waiting`] : [];
  }
  const futures = awaited.map((register) => {
    const held = top.registers.find(([slot]) => slot === register)?.[1];
    const id = held === undefined || isReference(held) ? undefined : handleTarget(held);
    const target = id === undefined ? undefined : objects.get(id);
    return target?.kind === 'future' ? target : undefined;
  });
  if (futures.includes(undefined)) {
    return [`execution ${execution.id} waits on something that is not a future`];
  }
  const resolved = futures.some((future) => future?.state.kind === 'resolved');
  if (resolved === isReady) {
    return [];
  }
  return [
    resolved
      ? `execution ${execution.id} waits on a resolved future but is not ready`
      : `ready execution ${execution.id} waits on unresolved futures`,
  ];
}

/** Every async call's execution resolves a pending call future of its own; only the root none. */
function callFutureProblems(snapshot: Snapshot): readonly string[] {
  const objects = new Map(snapshot.objects.map((object) => [object.id, object]));
  const executions = snapshot.objects.filter((object) => object.kind === 'execution');
  const roots = executions.filter((execution) => execution.resolves === undefined);
  const problems = roots.length > 1 ? [`${roots.length} executions resolve no call future`] : [];
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
  if (status.kind === 'unstarted') {
    return callProblems(definition, status.call);
  }
  return status.kind === 'panicked' && status.replay?.kind === 'call'
    ? callProblems(definition, status.replay.call)
    : [];
}

/** What is wrong with the call a new instance starts with, if anything. */
function callProblems(definition: Definition, call: InstanceCall): readonly string[] {
  const entry = definition.functions[call.function];
  if (entry?.kind !== 'code') {
    return [`the instance starts function ${call.function}, which is not code`];
  }
  const values = [...call.captures, ...call.arguments].flatMap((value) =>
    valueProblems(definition, value).map(({ message }) => `the instance's call: ${message}`),
  );
  if (call.captures.length !== entry.captures) {
    values.push(`${entry.name} carries ${entry.captures} captures, not ${call.captures.length}`);
  }
  if (call.arguments.length !== entry.parameters.length) {
    values.push(
      `${entry.name} takes ${entry.parameters.length} arguments, not ${call.arguments.length}`,
    );
  }
  if (entry.parameters.some((_, index) => takesReference(entry, index))) {
    values.push(`${entry.name} takes a reference, which an instance's call can't pass`);
  }
  return values;
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

function instructionAt(definition: Definition, frame: Frame) {
  const code = definition.functions[frame.function];
  return code?.kind === 'code' ? code.instructions[frame.pc] : undefined;
}
