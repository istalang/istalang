/**
 * The keys std natives bind by (docs/arch/definition.md, "Externs"). Every key is built through
 * `externKey` alone, so a natives table and lowering can't disagree, with parameter types spelled
 * as the declaration writes them.
 */

import { externKey, type KeyType } from '../definition/extern-key.ts';

/** A primitive parameter type as a key spells it. */
export function primitiveKeyType(name: string): KeyType {
  return { kind: 'primitive', name };
}

/** A named parameter type as a key spells it: module-qualified, such as `time.Time`. */
export function namedKeyType(name: string): KeyType {
  return { kind: 'named', name, arguments: [] };
}

/** The key of extern `name` declared in std module `module`, taking `parameters` by value. */
export function nativeKey(module: string, name: string, ...parameters: readonly KeyType[]): string {
  return externKey({
    module,
    name,
    parameters: parameters.map((type) => ({ type, reference: false })),
  });
}
