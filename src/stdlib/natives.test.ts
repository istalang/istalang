/**
 * The std natives table against the std modules' sources: every extern a program can call has a
 * native under the key lowering gives its declaration, a key no other declaration has, and no
 * native is left over.
 */

import { describe, expect, it } from 'vitest';
import type { Checker } from '../compiler/checker/check.ts';
import { sameType } from '../compiler/checker/types/identity/identity.ts';
import { isHandleType } from '../compiler/checker/types/properties/handles.ts';
import { heldPartsOf } from '../compiler/checker/types/properties/held.ts';
import type { Type } from '../compiler/checker/types/type/index.ts';
import { derivedCodecs } from '../foundation/language/well-known/codecs.ts';
import { disposeFunction } from '../foundation/language/well-known/implicit-calls.ts';
import { languageModules, runtimeModule } from '../foundation/language/well-known/index.ts';
import { stdNatives } from './natives.ts';
import { stdExterns } from './std-externs.test-kit.ts';

/**
 * Externs without a native, by module and name: the runtime disposes futures, slots, mocks and
 * runtimes itself, so their `dispose` never has one, and the compiler writes the derived json
 * codecs per type (docs/arch/boundary.md).
 */
const withoutNative = new Set([
  `${languageModules.prelude}.${disposeFunction}`,
  `${languageModules.testing}.${disposeFunction}`,
  `${runtimeModule}.${disposeFunction}`,
  ...Object.values(derivedCodecs).map((name) => `${languageModules.json}.${name}`),
]);

const std = stdExterns();

/** Kinds of types whose values may be or hold anything: only a type naming one holds it. */
const opaque: ReadonlySet<Type['kind']> = new Set([
  'parameter',
  'function',
  'associated',
  'field',
  'keys',
  'match',
  'any',
  'error',
]);

/**
 * Whether a value of `kept` holds only what `held` names: it is one of them, or a value whose parts
 * each are, a primitive holding nothing.
 */
function heldWithin(
  checker: Checker,
  held: readonly Type[],
  kept: Type,
  seen: Set<Type> = new Set(),
): boolean {
  if (held.some((each) => sameType(each, kept)) || seen.has(kept)) {
    return true;
  }
  if (isHandleType(kept) || opaque.has(kept.kind)) {
    return false;
  }
  seen.add(kept);
  return heldPartsOf(checker, kept).every((part) => heldWithin(checker, held, part, seen));
}

describe('std natives', () => {
  it('implement exactly the callable externs the std modules declare, by the keys lowering gives', () => {
    const callable = std.externs.flatMap(({ key, module, declaration }) =>
      withoutNative.has(`${module}.${declaration.name.text}`) ? [] : [key],
    );
    expect(new Set(Object.keys(stdNatives))).toEqual(new Set(callable));
  });

  it('bind each extern declaration by a key of its own', () => {
    // A key is lossy (`&` and sendability inside a function type), and a Definition has an entry
    // per instance, so only here, by declaration, can two externs sharing one native be caught.
    const keys = std.externs.map(({ key }) => key);
    expect(keys.filter((key, index) => keys.indexOf(key) !== index)).toEqual([]);
  });

  it("keep only what the holder's type holds, as its @Holds says (§3.16)", () => {
    const { checker } = std;
    const unheld = std.externs.flatMap(({ key, declaration }) => {
      const parameters = checker.parametersOf(declaration);
      return checker.keepsOf(declaration).flatMap(({ holder, kept }) => {
        const type = parameters[holder]?.type;
        const held = type?.kind === 'nominal' ? checker.externHeldOf(type) : [];
        return kept.flatMap((position) => {
          const keptType = parameters[position]?.type;
          return keptType !== undefined && heldWithin(checker, held, keptType)
            ? []
            : [`${key}: parameter ${holder} keeps ${position}`];
        });
      });
    });
    expect(unheld).toEqual([]);
  });
});
