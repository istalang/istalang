/**
 * The runtime as a host uses it (§9): give it the seams, deploy a Definition, start what it may
 * start, and wake, inspect, retry and terminate the instances its code reaches.
 *
 * - A Definition arrives as its persisted text, the form the store keeps; deploying reads and
 *   validates it, emits its code once per hash, and writes it to the store once, as it was given. Each deploy holds
 *   the host's externs to the types the store recorded (§3.6, boundary/extern-signatures.ts).
 * - Instances are the world's (durable-world.ts): each committed to the store at every segment's
 *   end, so a runtime opened over the same store goes on where an earlier one committed (§5). One
 *   the world doesn't hold is read from the store with the Definition its snapshot names.
 * - What a host asks of one instance is instance-calls.ts's.
 */

import { memo } from '../../foundation/structures/memo.ts';
import { recordExternSignatures } from '../boundary/extern-signatures.ts';
import { type HostExterns, withHost } from '../boundary/host-natives.ts';
import type { Clock } from '../clock.ts';
import type { Natives } from '../natives.ts';
import { Refusal } from '../refusal.ts';
import type { InstanceStore } from '../store.ts';
import { DurableWorld } from './durable-world.ts';
import { type InstanceCalls, instanceCalls } from './instance-calls.ts';
import { type DeployedProgram, deployed, type HostReports, readDefinition } from './programs.ts';
import type { WorldProgram } from './resident.ts';

export interface RuntimeSeams {
  readonly natives: Natives;
  readonly store: InstanceStore;
  readonly clock: Clock;
  readonly seed: () => Uint8Array;
  readonly host?: HostExterns;
  readonly reports?: HostReports;
}

export interface Runtime extends InstanceCalls {
  readonly deploy: (text: string) => DeployedProgram;
}

export function createRuntime(seams: RuntimeSeams): Runtime {
  const byHash = new Map<string, WorldProgram>();
  const bound = (text: string): WorldProgram => {
    const program = readDefinition(text);
    return memo(byHash, program.hash, () => {
      seams.store.writeDefinition(program.hash, text);
      return program;
    });
  };
  const bind = (hash: string): WorldProgram => {
    const known = byHash.get(hash);
    if (known !== undefined) {
      return known;
    }
    const text = seams.store.readDefinition(hash);
    if (text === undefined) {
      throw new Refusal('unknownDefinition', `The store holds no Definition ${hash}.`);
    }
    return bound(text);
  };
  const world = new DurableWorld(
    { ...seams, natives: withHost(seams.natives, seams.host ?? {}) },
    bind,
  );
  const deploy = (text: string): DeployedProgram => {
    const program = bound(text);
    recordExternSignatures(seams.store, program.definition);
    return deployed(world, program);
  };
  return { deploy, ...instanceCalls(world) };
}
