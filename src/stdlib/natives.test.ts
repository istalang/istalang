/**
 * The std natives table against the std modules' sources: every extern a program can call has a
 * native under the key lowering gives its declaration, and no native is left over.
 */

import { describe, expect, it } from 'vitest';
import { keyOf } from '../compiler/lowering/tables/names.ts';
import { declaredFunctions } from '../compiler/syntax/declarations/index.ts';
import { derivedCodecs } from '../foundation/language/well-known/codecs.ts';
import { disposeFunction } from '../foundation/language/well-known/implicit-calls.ts';
import { languageModules } from '../foundation/language/well-known/index.ts';
import { stdNatives } from './natives.ts';
import { everyStdModule } from './std-modules.test-kit.ts';

/**
 * Externs without a native, by module and name: the runtime disposes futures, slots and mocks
 * itself, so their `dispose` never has one, and the compiler writes the derived json codecs per
 * type (docs/arch/boundary.md).
 */
const withoutNative = new Set([
  `${languageModules.prelude}.${disposeFunction}`,
  `${languageModules.testing}.${disposeFunction}`,
  ...Object.values(derivedCodecs).map((name) => `${languageModules.json}.${name}`),
]);

describe('std natives', () => {
  it('implement exactly the callable externs the std modules declare, by the keys lowering gives', () => {
    const { checker, modules } = everyStdModule();
    const callable = modules.flatMap(([, module]) =>
      declaredFunctions(module.tree.root).flatMap((item) =>
        item.isExtern && !withoutNative.has(`${module.name}.${item.name.text}`)
          ? [keyOf(checker, item, checker.parametersOf(item))]
          : [],
      ),
    );
    expect(new Set(Object.keys(stdNatives))).toEqual(new Set(callable));
  });
});
