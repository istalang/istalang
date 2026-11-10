/**
 * A Definition never shows the numbers types are keyed by, which depend on what was numbered first
 * in the process: every runnable corpus program is written alike, however its identities were
 * numbered before it compiled.
 */

import { describe, expect, it } from 'vitest';
import { runPrograms } from '../../test/corpus/programs.ts';
import { definitionFormat } from '../definition/definition.ts';
import { stdProgramOf } from './binder/bind.test-kit.ts';
import { bindProgram } from './binder/bind.ts';
import { typeKeys } from './checker/types/identity/type-keys.ts';
import { compiledDefinition } from './compile.test-kit.ts';
import { idOf } from './program/program.test-kit.ts';
import type { Program } from './program/program.ts';
import { nodesUnder } from './syntax/tree/index.ts';

describe('compiling', () => {
  it.each(runPrograms.map(({ name, text }) => ({ name, text })))(
    'writes $name alike however its identities were numbered',
    ({ text }) => {
      const written = (compiled: Program) =>
        definitionFormat.write(compiledDefinition(compiled, 'main')).text;
      const first = written(stdProgramOf({ main: text }));
      const program = stdProgramOf({ main: text });
      const main = idOf('main');
      const tree = program.modules.get(main)?.tree;
      const bindings = bindProgram(program);
      for (const node of tree === undefined ? [] : nodesUnder(tree, tree.root).toReversed()) {
        const entity = node.kind === 'Identifier' ? bindings.entityOf(main, node) : undefined;
        typeKeys.identityOf(entity ?? node);
      }
      expect(written(program)).toBe(first);
    },
  );
});
