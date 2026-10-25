/**
 * Looking at an instance from outside (§9, §10): where it stands, and where each of its
 * executions waits, read from its last commit alone, so a host and the `testing` module see what a
 * restarted runtime would. In a committed snapshot every execution stands at an `await` or a
 * `select` (docs/arch/definition.md, "Frames"), which names its waypoint when the program gave it
 * one (`@Waypoint`); a location is always given, for waits without one.
 */

import type { Definition } from '../../definition/definition.ts';
import type { InstanceState } from '../instance-state.ts';
import { locationOf } from '../interpreter/trace.ts';
import type { Frame } from '../snapshot/objects.ts';
import type { Snapshot } from '../snapshot/snapshot.ts';
import { stateOf } from './wake.ts';

/** Where one execution waits: its waypoint, if the program named it, and its source location. */
export interface WaitingPoint {
  readonly waypoint: string | undefined;
  /** `module:line:column`, as a trace names it. */
  readonly location: string;
}

export interface Inspection {
  readonly state: InstanceState;
  /** Every execution's wait, in the order the executions were created. */
  readonly waitingAt: readonly WaitingPoint[];
}

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
    throw new Error(`Frame of function ${frame.function} doesn't stand at a wait.`);
  }
  return {
    waypoint: instruction.waypoint,
    location: locationOf(definition, code.module, instruction.span.start),
  };
}
