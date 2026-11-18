/**
 * `import *` and namespaces among an import's items (§3.13): `*` binds every export under its own
 * name, as if each were listed, so a body's free name finds it, and a name it brings that anything
 * else at the top level binds, another `*` among them, is reported once, on the `*`.
 */

import { describe, expect, it } from 'vitest';
import { reportedNothing, reportedOnce } from '../../foundation/diagnostics/diagnostic.test-kit.ts';
import { idOf } from '../program/program.test-kit.ts';
import { boundReport, declaringName, entityOfName, preludeProgramOf } from './bind.test-kit.ts';
import { bindProgram } from './bind.ts';
import { binderDiagnostics as d } from './diagnostics.ts';

const lib = 'fn a(): 1\nfn b(): 2\nstruct Point { x: Int }\nfn _hidden(): 4\n';
const other = 'fn b(): 3\nfn c(): 4\n';

describe('import *', () => {
  it('binds every export under its own name, which a body finds', () => {
    const program = preludeProgramOf({
      main: "import * from 'lib'\nfn f(p: Point) -> Int: a() + b() + p.x",
      lib,
    });
    expect(
      boundReport({ main: "import * from 'lib'\nfn f(p: Point) -> Int: a() + p.x", lib }),
    ).toEqual(reportedNothing);
    expect(declaringName(entityOfName(program, 'main', 'a', 0))?.text).toBe('a');
    expect(declaringName(entityOfName(program, 'main', 'Point', 0))?.text).toBe('Point');
    const bindings = bindProgram(program);
    expect(declaringName(bindings.topLevelNamed(idOf('main'), 'b'))?.text).toBe('b');
    expect(bindings.topLevelNames(idOf('main'))).toContain('Point');
  });

  it('binds no private name', () => {
    expect(boundReport({ main: "import * from 'lib'\nfn f() -> Int: _hidden", lib })).toEqual(
      reportedOnce(d.undeclared.code, '_hidden'),
    );
  });

  it('stands beside a namespace and names in one import', () => {
    const main = "import (*, * as l, a as first) from 'lib'\nfn f() -> Int: a() + l.b() + first()";
    expect(boundReport({ main, lib })).toEqual(reportedNothing);
  });

  it.each([
    ['a declaration', "import * from 'lib'\nfn a(): 5", d.importClash, 'a'],
    ['a named import', "import * from 'lib'\nimport c as a from 'other'", d.duplicateImport, 'a'],
    ['a named import of the same export', "import (*, a) from 'lib'", d.duplicateImport, 'a'],
    ['a namespace', "import * from 'lib'\nimport * as b from 'other'", d.duplicateImport, 'b'],
    ['another *', "import * from 'lib'\nimport * from 'other'", d.duplicateImport, 'b'],
  ])('reports a name it shares with %s once, on the *', (_, main, rule, name) => {
    const files = { main, lib, other };
    expect(boundReport(files)).toEqual(reportedOnce(rule.code, '*'));
    const [reported] = bindProgram(preludeProgramOf(files)).diagnosticsOf(idOf('main'));
    expect(reported?.message).toContain(`'${name}'`);
  });

  it('reuses a prelude name as a named import does: a function joins, anything else clashes', () => {
    expect(
      boundReport({ main: "import * from 'lib'", lib: 'fn add(a: Bool, b: Bool): a' }),
    ).toEqual(reportedNothing);
    expect(boundReport({ main: "import * from 'lib'", lib: 'struct Error { x: Int }' })).toEqual(
      reportedOnce(d.preludeClash.code, '*'),
    );
  });
});
