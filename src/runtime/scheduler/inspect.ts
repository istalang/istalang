/**
 * Looking at an instance from outside (§9, §10): where it stands (`stateOf`), and where each of its
 * executions waits, read from its last commit alone, so a host and the `testing` module see what a
 * restarted runtime would. In a committed snapshot every execution stands at an `await` or a
 * `select` (docs/arch/definition.md, "Frames"), which names its waypoint when the program gave it
 * one (`@Waypoint`); a location is always given, for waits without one.
 */

import type { Definition } from '../../definition/definition.ts';
import { locationOf } from '../../definition/traces.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';
import type { Inspection, InstanceState, WaitingPoint } from '../instance-state.ts';
import type { Frame } from '../snapshot/objects.ts';
import type { Snapshot } from '../snapshot/snapshot.ts';

/** What `snapshot`, an instance of `definition`, says about where it stands and waits. */
export function inspection(definition: Definition, snapshot: Snapshot): Inspection {
  const waitingAt = snapshot.objects.flatMap((object) => {
    const frame = object.kind === 'execution' ? object.frames.at(-1) : undefined;
    return frame === undefined ? [] : [waitingPointOf(definition, frame)];
  });
  return { state: stateOf(snapshot), waitingAt };
}

/** Where `frame`, an execution's innermost, waits; a snapshot check makes it a wait. */
function waitingPointOf(definition: Definition, frame: Frame): WaitingPoint {
  const code = definition.functions[frame.function];
  const instruction = code?.kind === 'code' ? code.instructions[frame.pc] : undefined;
  if (code?.kind !== 'code' || (instruction?.kind !== 'await' && instruction?.kind !== 'select')) {
    unreachable(`Frame of function ${frame.function} doesn't stand at a wait.`);
  }
  return {
    waypoint: instruction.waypoint,
    location: locationOf(definition, code.module, instruction.span.start),
  };
}

/** What a committed snapshot says about its instance. */
export function stateOf(snapshot: Snapshot): InstanceState {
  const { status } = snapshot;
  switch (status.kind) {
    case 'unstarted':
      return { kind: 'ready' };
    case 'active':
      return snapshot.ready.length > 0
        ? { kind: 'ready' }
        : { kind: 'waiting', until: nextTimerOf(snapshot), watching: watchedOf(snapshot) };
    case 'finished':
      return status;
    case 'panicked':
      return { kind: 'panicked', message: status.message, trace: status.trace };
    case 'terminated':
      return status;
    default: {
      const unhandled: never = status;
      return unhandled;
    }
  }
}

/** The instances whose end `snapshot`'s instance waits for (§9), each once. */
function watchedOf(snapshot: Snapshot): readonly string[] {
  const watched = snapshot.objects.flatMap((object) =>
    object.kind === 'future' && object.state.kind === 'watch' && object.state.until.kind === 'ended'
      ? [object.state.instance]
      : [],
  );
  return [...new Set(watched)];
}

function nextTimerOf(snapshot: Snapshot): bigint | undefined {
  return snapshot.objects.reduce<bigint | undefined>(
    (earliest, object) =>
      object.kind === 'future' &&
      object.state.kind === 'timer' &&
      (earliest === undefined || object.state.at < earliest)
        ? object.state.at
        : earliest,
    undefined,
  );
}
