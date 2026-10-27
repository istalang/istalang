/**
 * A std module (§3.8) as the toolchain ships it: its name, its `.ista` source, and the natives of
 * its externs. A module's natives are built from keys bound to its name, so the name is spelled
 * once, where the module is listed (std-modules.ts), and a natives table can't key an extern or a
 * type under another module's name, or spell a static function apart from `staticName`.
 */

import {
  type KeyType,
  type NativeParameter,
  namedKey,
  nativeKey,
  type WrittenType,
} from '../definition/extern-key.ts';
import { staticName } from '../language/static-names.ts';
import { qualifiedName, type WellKnownDeclaration } from '../language/well-known.ts';
import type { Natives } from '../runtime/natives.ts';

export interface StdModule {
  readonly name: string;
  readonly source: string;
  readonly natives: Natives;
}

/** The keys of one std module's natives (definition/extern-key.ts). */
export interface NativeKeys {
  /** Type `name` the module declares, with its type arguments: `decimal.Decimal`. */
  readonly type: (name: string, ...typeArguments: readonly WrittenType[]) => KeyType;
  /** Function `name` taking `parameters`: `time.at(time.Time)`. */
  readonly of: (name: string, ...parameters: readonly NativeParameter[]) => string;
  /** Static function `name` of type `owner` taking `parameters`: `time.Time.parse(string)`. */
  readonly ofStatic: (
    owner: string,
    name: string,
    ...parameters: readonly NativeParameter[]
  ) => string;
}

/** Std module `name` with its `source`, and the natives `nativesOf` builds from its keys. */
export function stdModule(
  name: string,
  source: string,
  nativesOf?: (keys: NativeKeys) => Natives,
): StdModule {
  return { name, source, natives: nativesOf?.(nativeKeysOf(name)) ?? {} };
}

/** The keys of std module `module`'s natives. */
export function nativeKeysOf(module: string): NativeKeys {
  return {
    type: (name, ...typeArguments) => namedKey(qualifiedName({ module, name }), ...typeArguments),
    of: (name, ...parameters) => nativeKey(module, name, ...parameters),
    ofStatic: (owner, name, ...parameters) =>
      nativeKey(module, staticName(owner, name), ...parameters),
  };
}

/** A well-known type as a key spells it, with its type arguments: `prelude.Array<T>`. */
export function knownTypeKey(
  declaration: WellKnownDeclaration,
  ...typeArguments: readonly WrittenType[]
): KeyType {
  return namedKey(qualifiedName(declaration), ...typeArguments);
}
