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
 * - a cell is a `Shared` instantiation and a resource of an extern type
 * - every value held anywhere names types and functions the Definition has, and agrees with them,
 *   by the same check the Definition's own constants pass (definition/references.ts)
 */

import type { Definition } from '../../definition/definition.ts';
import { sharedTypeName } from '../../definition/functions.ts';
import { awaitedRegisters, waits } from '../../definition/instructions/flow.ts';
import type { Instruction } from '../../definition/instructions/instruction.ts';
import { valueProblems } from '../../definition/references.ts';
import { handleTarget } from '../../definition/values.ts';
import { Refusal } from '../refusal.ts';
import { type Frame, type HeapObject, isReference } from './objects.ts';
import { type Snapshot, valuesIn } from './snapshot.ts';

/** Throws a Refusal listing every way `snapshot` doesn't fit `definition`. */
export function checkSnapshot(definition: Definition, snapshot: Snapshot): void {
  const problems = [
    ...snapshot.objects.flatMap((object) => objectProblems(definition, object)),
    ...waitProblems(definition, snapshot),
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
      return isTypeNamed(definition, object.type, sharedTypeName)
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

function isTypeNamed(definition: Definition, type: number, name: string): boolean {
  const entry = definition.types[type];
  return entry?.kind === 'extern' && entry.name === name;
}
