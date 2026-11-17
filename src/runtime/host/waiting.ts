/**
 * Where an instance waits (§10): each parked execution's function, the waypoint the program named
 * there, if any, and the source of its await. A host inspecting an instance reads its last commit;
 * a commit that fails names the await it would have committed at.
 */

import { parkAt } from '../../codegen/instructions.ts';
import type { Definition } from '../../definition/definition.ts';
import { locationOf } from '../../definition/traces.ts';
import type { WaitingPoint } from '../instance-state.ts';
import type { Resident } from './resident.ts';

/** Where a frame parked at `pc` waits; undefined when it isn't parked at a `park`. */
export function parkedAt(
  definition: Definition,
  { function: index, pc }: { readonly function: number; readonly pc: number },
):
  | { readonly function: string; readonly waypoint: string | undefined; readonly location: string }
  | undefined {
  const entry = definition.functions[index];
  if (entry?.kind !== 'code') {
    return undefined;
  }
  const park = parkAt(entry, pc);
  return park === undefined
    ? undefined
    : {
        function: entry.name,
        waypoint: park.waypoint,
        location: locationOf(definition, entry.module, park.span.start),
      };
}

/** Where each of `resident`'s parked executions waits, as it last committed. */
export function waitingAt(resident: Resident): readonly WaitingPoint[] {
  if (resident.committed === undefined) {
    return [];
  }
  const { definition } = resident.program;
  const { objects, live } = resident.committed;
  const executions = new Map(
    objects.flatMap((object) => (object.kind === 'execution' ? [[object.id, object]] : [])),
  );
  return live.flatMap((id) => {
    const execution = executions.get(id);
    const at = execution?.parked === true ? parkedAt(definition, execution) : undefined;
    return at === undefined ? [] : [{ waypoint: at.waypoint, location: at.location }];
  });
}
