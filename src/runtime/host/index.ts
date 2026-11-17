/**
 * The runtime as a host uses it (§9): give it the host binding (binding.ts), deploy a Definition, start what it may
 * start, and wake, inspect, retry and terminate the instances its code reaches.
 *
 * - A Definition arrives encoded, with the bytes the store keeps (definition/definition.ts);
 *   deploying emits its code once per hash and writes its bytes to the store once. One the store
 *   gives back is read and validated, coming from outside the toolchain. Each deploy holds the
 *   host's externs to the types the store recorded (§3.6, boundary/extern-signatures.ts).
 * - Instances are the world's (durable-world.ts): each committed to the store at every segment's
 *   end, so a runtime opened over the same store goes on where an earlier one committed (§5). One
 *   the world doesn't hold is read from the store with the Definition its snapshot names.
 * - What a host asks of one instance is instance-calls.ts's.
 */

import { type EncodedDefinition, readDefinition } from '../../definition/definition.ts';
import { memo } from '../../foundation/structures/memo.ts';
import { recordExternSignatures } from '../boundary/extern-signatures.ts';
import { Refusal } from '../refusal.ts';
import type { HostBinding } from './binding.ts';
import { DurableWorld } from './durable-world.ts';
import { type InstanceCalls, instanceCalls } from './instance-calls.ts';
import { type DeployedProgram, deployed, worldProgram } from './programs.ts';
import type { WorldProgram } from './resident.ts';

export interface Runtime extends InstanceCalls {
  readonly deploy: (encoded: EncodedDefinition) => DeployedProgram;
}

export function createRuntime(binding: HostBinding): Runtime {
  const byHash = new Map<string, WorldProgram>();
  const bound = (encoded: EncodedDefinition): WorldProgram =>
    memo(byHash, encoded.hash, () => {
      binding.store.writeDefinition(encoded.hash, encoded.bytes);
      return worldProgram(encoded);
    });
  const bind = (hash: string): WorldProgram => {
    const known = byHash.get(hash);
    if (known !== undefined) {
      return known;
    }
    const bytes = binding.store.readDefinition(hash);
    if (bytes === undefined) {
      throw new Refusal('unknownDefinition', `The store holds no Definition ${hash}.`);
    }
    return bound(readDefinition(bytes));
  };
  const world = new DurableWorld(binding, bind);
  const deploy = (encoded: EncodedDefinition): DeployedProgram => {
    const program = bound(encoded);
    recordExternSignatures(binding.store, program.definition);
    return deployed(world, program);
  };
  return { deploy, ...instanceCalls(world) };
}
