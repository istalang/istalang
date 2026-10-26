/**
 * The std natives table against the std modules' sources: every extern a program can call, a
 * handle's functions included (§3.18), has a native under the key lowering gives its declaration,
 * and no native is left over.
 */

import { describe, expect, it } from 'vitest';
import { stdProgramOf } from '../compiler/binder/bind.test-kit.ts';
import { checkProgram } from '../compiler/checker/check.ts';
import { nativeKeyOf } from '../compiler/lowering/names.ts';
import { declaredFunctions } from '../compiler/syntax/declared-functions.ts';
import { derivedCodecs } from '../language/well-known.ts';
import { stdNatives } from './natives.ts';
import { jsonName, stdSources } from './stdlib-loader.ts';

/**
 * Externs without a native, by module and name: the runtime disposes futures and slots itself, so
 * their `dispose` never has one, and the compiler writes the derived json codecs per type
 * (docs/arch/boundary.md).
 */
const withoutNative = new Set([
  'prelude.dispose',
  ...Object.values(derivedCodecs).map((name) => `${jsonName}.${name}`),
]);

describe('std natives', () => {
  it('implement exactly the callable externs the std modules declare, by the keys lowering gives', () => {
    const imports = Object.keys(stdSources).map((name) => `import * as ${name} from '${name}'`);
    const program = stdProgramOf({ main: imports.join('\n') });
    const checker = checkProgram(program);
    const std = [...program.modules.values()].filter((module) => module.isStd);
    expect(std.length).toBe(Object.keys(stdSources).length + 1);
    const callable = std.flatMap((module) =>
      declaredFunctions(module.tree.root).flatMap((declared) =>
        declared.isExtern && !withoutNative.has(`${module.name}.${declared.name.text}`)
          ? [nativeKeyOf(checker, declared)]
          : [],
      ),
    );
    expect(new Set(Object.keys(stdNatives))).toEqual(new Set(callable));
  });
});
