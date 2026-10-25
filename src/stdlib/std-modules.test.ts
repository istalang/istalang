/**
 * The modules the toolchain ships check clean: a compile doesn't check them again
 * (compiler/compile.ts `diagnose`), so this is where a mistake in one would show.
 */

import { describe, expect, it } from 'vitest';
import { stdProgramOf } from '../compiler/binder/bind.test-kit.ts';
import { checkProgram } from '../compiler/checker/check.ts';
import { stdSources } from './stdlib-loader.ts';

describe('std modules', () => {
  it('check without a diagnostic', () => {
    const imports = Object.keys(stdSources).map((name) => `import * as ${name} from '${name}'`);
    const program = stdProgramOf({ main: imports.join('\n') });
    const checker = checkProgram(program);
    const std = [...program.modules].filter(([, module]) => module.isStd);
    expect(std.length).toBe(Object.keys(stdSources).length + 1);
    for (const [id, module] of std) {
      const diagnostics = [...module.tree.diagnostics, ...checker.diagnosticsOf(id)];
      expect(
        diagnostics.map(({ code, message }) => `${code} ${message}`),
        module.name,
      ).toEqual([]);
    }
  });
});
