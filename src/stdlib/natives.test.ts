/**
 * The std natives table against the std modules' sources: every extern a program can call has a
 * native under the key lowering gives its declaration, and no native is left over.
 */

import { describe, expect, it } from 'vitest';
import { stdProgramOf } from '../compiler/binder/bind.test-kit.ts';
import { checkProgram } from '../compiler/checker/check.ts';
import { externKeyOf } from '../compiler/lowering/names.ts';
import { stdNatives } from './natives.ts';
import { stdSources } from './stdlib-loader.ts';

/**
 * Externs without a native, by module and name: weak references arrive with 3.8, and the runtime
 * disposes futures and slots itself, so their `dispose` never has one.
 */
const withoutNative = new Set(['prelude.deref', 'prelude.disposed', 'prelude.dispose']);

describe('std natives', () => {
  it('implement exactly the callable externs the std modules declare, by the keys lowering gives', () => {
    const imports = Object.keys(stdSources).map((name) => `import * as ${name} from '${name}'`);
    const program = stdProgramOf({ main: imports.join('\n') });
    const checker = checkProgram(program);
    const std = [...program.modules.values()].filter((module) => module.isStd);
    expect(std.length).toBe(Object.keys(stdSources).length + 1);
    const callable = std.flatMap((module) =>
      module.tree.root.items.flatMap((item) =>
        item.kind === 'FunctionDeclaration' &&
        item.isExtern &&
        !withoutNative.has(`${module.name}.${item.name.text}`)
          ? [externKeyOf(checker, item)]
          : [],
      ),
    );
    expect(new Set(Object.keys(stdNatives))).toEqual(new Set(callable));
  });
});
