/**
 * A std module (§19.2) as the toolchain ships it: its name, its `.ista` source, and the natives of
 * its externs. A module's natives are built from keys bound to its name, so the name is spelled
 * once, where the module is listed (std-modules.ts), and a natives table can't key an extern or a
 * type under another module's name, or spell a static function apart from `staticName`.
 */

import {
  type KeyType,
  type NativeKeys,
  namedKey,
  nativeKeysOf,
  type WrittenType,
} from '../definition/extern-key.ts';
import {
  type Persistence,
  qualifiedName,
  type WellKnownDeclaration,
  wellKnown,
} from '../foundation/language/well-known/index.ts';
import type { Natives } from '../runtime/natives.ts';

export interface StdModule {
  readonly name: string;
  readonly source: string;
  readonly natives: Natives;
}

/** The natives of a std module's externs, built from its keys. */
export type ModuleNatives = (keys: NativeKeys) => Natives;

/** Std module `name` with its `source`, and the natives `natives` builds from its keys. */
export function stdModule(name: string, source: string, natives?: ModuleNatives): StdModule {
  return { name, source, natives: natives?.(nativeKeysOf(name)) ?? {} };
}

/** A well-known type as a key spells it, with its type arguments: `prelude.Array<T>`. */
export function knownTypeKey(
  declaration: WellKnownDeclaration,
  ...typeArguments: readonly WrittenType[]
): KeyType {
  return namedKey(qualifiedName(declaration), ...typeArguments);
}

/** `Future<T, K>` as a key spells it: what a call of kind `kind` giving `value` gives. */
export function futureKey(value: WrittenType, kind: Persistence): KeyType {
  return knownTypeKey(wellKnown.future, value, { kind: 'literal', text: JSON.stringify(kind) });
}
