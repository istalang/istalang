/**
 * Completion in an import: the names a module exports, imported cleanly when written in, and the
 * words between an import's parts. The paths in it are module-paths.test.ts's.
 */

import { describe, expect, it } from 'vitest';
import { checkProgram } from '../../../../../compiler/checker/check.ts';
import { stdModuleSources } from '../../../../../stdlib/std-sources.ts';
import { mainProgram, programAt } from '../../../language-service.test-kit.ts';
import { completionsAt } from '../../index.ts';

function names(...lines: readonly string[]): readonly string[] {
  const { program, module, offset } = programAt(...lines);
  return completionsAt(program, module, offset).map(({ name }) => name);
}

describe('completion in an import', () => {
  it('offers what a std module exports, each imported cleanly when written in', () => {
    const modules = Object.keys(stdModuleSources).filter(
      (name) => name !== 'prelude' && name !== 'testing',
    );
    for (const module of modules) {
      const offered = names(`import ‸ from '${module}'`);
      expect(offered, module).not.toHaveLength(0);
      const written = mainProgram(`import ${offered.join(', ')} from '${module}'\n`);
      expect(checkProgram(written.program).diagnosticsOf(written.module), module).toEqual([]);
    }
  });

  it('leaves out what the file imports by name already, but not the name being written', () => {
    const offered = names("import Duration from 'time'", "import Ti‸, now from 'time'");
    expect(offered).toContain('Time');
    expect(offered).not.toContain('Duration');
    expect(offered).not.toContain('now');
  });

  it('offers `from` right after a name or the alias, in an import without one', () => {
    expect(names('import * as m ‸')).toEqual(['from']);
    expect(names('import from ‸')).toEqual(['from']);
    expect(names('import a fr‸')).toEqual(['from']);
    expect(names('import a from ‸')).toEqual([]);
    expect(names('import a from m ‸')).toEqual([]);
    expect(names("import a ‸ from 'time'")).toEqual([]);
  });

  it('offers the exports in parentheses, on a line of their own too, by export name', () => {
    expect(names("import (‸) from 'time'")).toContain('Duration');
    const listed = names('import (', '  Duration as Span', '  ‸', ") from 'time'");
    expect(listed).toContain('Time');
    expect(listed).not.toContain('Duration');
    expect(names("import (Time, ‸) from 'time'")).not.toContain('Time');
  });

  it('offers nothing for an alias, which is a new name, and `from` after the parentheses', () => {
    expect(names("import Duration as ‸ from 'time'")).toEqual([]);
    expect(names("import (Duration as ‸) from 'time'")).toEqual([]);
    expect(names('import (Duration) ‸')).toEqual(['from']);
    expect(names('import Duration as Span ‸')).toEqual(['from']);
  });

  it('offers the exports at a name spelled as a keyword so far', () => {
    expect(names("import in‸ from 'inbox'")).not.toHaveLength(0);
  });
});
