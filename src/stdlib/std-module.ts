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
import { staticName } from '../foundation/language/static-names.ts';
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
  /**
   * The keys of its natives that reach instances, contexts, slots or tests, which only the
   * interpreter has: compiled JavaScript refuses a program calling one (codegen/emit.ts).
   */
  readonly interpreterKeys: readonly string[];
}

/** The keys of one std module's natives (definition/extern-key.ts). */
export interface NativeKeys {
  /** Type `name` the module declares, with its type arguments: `decimal.Decimal`. */
  readonly type: (name: string, ...typeArguments: readonly WrittenType[]) => KeyType;
  /** Function `name` taking `parameters`: `time.at(time.Time)`. */
  readonly of: (name: string, ...parameters: readonly NativeParameter[]) => string;
  /** Static function `name` of type `owner` taking `parameters`: `time.Time.parse(String)`. */
  readonly ofStatic: (
    owner: string,
    name: string,
    ...parameters: readonly NativeParameter[]
  ) => string;
}

/** The natives of a std module's externs, built from its keys: those any runtime runs, and the interpreter's alone. */
export interface ModuleNatives {
  readonly everywhere?: (keys: NativeKeys) => Natives;
  readonly interpreter?: (keys: NativeKeys) => Natives;
}

/** Std module `name` with its `source`, and the natives `natives` builds from its keys. */
export function stdModule(name: string, source: string, natives: ModuleNatives = {}): StdModule {
  const keys = nativeKeysOf(name);
  const interpreter = natives.interpreter?.(keys) ?? {};
  return {
    name,
    source,
    natives: { ...natives.everywhere?.(keys), ...interpreter },
    interpreterKeys: Object.keys(interpreter),
  };
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

/** `Future<T, K>` as a key spells it: what a call of kind `kind` giving `value` gives. */
export function futureKey(value: WrittenType, kind: Persistence): KeyType {
  return knownTypeKey(wellKnown.future, value, { kind: 'literal', text: JSON.stringify(kind) });
}
