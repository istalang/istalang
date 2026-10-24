/**
 * Checking a snapshot against the Definition it names, before anything restores it (§5), so a
 * snapshot from another Definition, or a damaged one, is refused when it loads rather than midway
 * through a resume. The snapshot's schema already checked its own ids and references
 * (snapshot.ts); what is left needs the Definition:
 * - every frame names a code entry, its pc lies inside that code and its registers inside its
 *   frame
 * - a caller frame stands at a `call`, and an execution's innermost frame at an `await` or a
 *   `select`, the only places an execution stops (docs/arch/definition.md, "Frames")
 * - an execution at an `await` waits on a future, and is ready exactly when it has resolved
 * - a cell is a `Shared` instantiation and a resource of an extern type
 * - every value held anywhere names types and functions the Definition has, and agrees with them,
 *   by the same check the Definition's own constants pass (definition/references.ts)
 * - a pinned extern read names an extern constant
 */

import type { Definition } from '../../definition/definition.ts';
import { sharedTypeName } from '../../definition/functions.ts';
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
    ...snapshot.externReads.flatMap(({ function: index, value }) => {
      const entry = definition.functions[index];
      const constant =
        entry?.kind === 'extern' && entry.constant
          ? []
          : [`extern read ${index} is not an extern constant`];
      const values = valueProblems(definition, value).map(
        ({ message }) => `extern read ${index}: ${message}`,
      );
      return [...constant, ...values];
    }),
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
        frameProblems(definition, frame, index === object.frames.length - 1 ? stops : calls).map(
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
 * An execution at an `await` waits on the future its register names, and is ready exactly when
 * that future has resolved; nothing is ready twice, and nothing ready stands anywhere else.
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
  if (top === undefined || instruction?.kind !== 'await') {
    return isReady ? [`ready execution ${execution.id} is not at an await`] : [];
  }
  const awaited = top.registers.find(([register]) => register === instruction.future)?.[1];
  const id = awaited === undefined || isReference(awaited) ? undefined : handleTarget(awaited);
  const target = id === undefined ? undefined : objects.get(id);
  if (target?.kind !== 'future') {
    return [`execution ${execution.id} awaits something that is not a future`];
  }
  const resolved = target.state.kind === 'resolved';
  if (resolved === isReady) {
    return [];
  }
  return [
    resolved
      ? `execution ${execution.id} waits on a resolved future but is not ready`
      : `ready execution ${execution.id} waits on an unresolved future`,
  ];
}

const stops: ReadonlySet<string> = new Set(['await', 'select']);
const calls: ReadonlySet<string> = new Set(['call']);

function frameProblems(
  definition: Definition,
  frame: Frame,
  allowed: ReadonlySet<string>,
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
  } else if (!allowed.has(instruction.kind)) {
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
