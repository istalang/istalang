/**
 * `import *` and namespaces among an import's items (§13.1): `*` binds every export under its own
 * name, as if each were listed, so a body's free name finds it. A name it brings that something
 * else gives too, another `*`, the module's own declaration or import, or the prelude, is
 * ambiguous only where it is used, and reported there; two ways to the same entity are one.
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

  const shared: readonly (readonly [string, string, string])[] = [
    ['a declaration', "import * from 'lib'\nfn a(): 5", 'a'],
    ['a named import', "import * from 'lib'\nimport c as a from 'other'", 'a'],
    ['a namespace', "import * from 'lib'\nimport * as b from 'other'", 'b'],
    ['another *', "import * from 'lib'\nimport * from 'other'", 'b'],
  ];

  it.each(shared)('reports nothing for a name it shares with %s, while unused', (_, main) => {
    expect(boundReport({ main, lib, other })).toEqual(reportedNothing);
  });

  it.each(shared)('reports a name it shares with %s once, where used', (_, main, name) => {
    const used = `${main}\nfn use() -> Int: ${name}`;
    expect(boundReport({ main: used, lib, other })).toEqual(
      reportedOnce(d.ambiguousName.code, name),
    );
  });

  it('takes two ways to one export as one', () => {
    const main = "import (*, a) from 'lib'\nimport * from 'lib'\nfn f() -> Int: a() + b()";
    expect(boundReport({ main, lib })).toEqual(reportedNothing);
  });

  it('meets the prelude as a named import does: a function joins, anything else is ambiguous', () => {
    const adds = {
      main: "import * from 'lib'\nfn f() -> Bool: add(true, false)",
      lib: 'fn add(a: Bool, b: Bool): a',
    };
    expect(boundReport(adds)).toEqual(reportedNothing);
    const errors = {
      main: "import * from 'lib'\nfn f(e: Error): 1",
      lib: 'struct Error { x: Int }',
    };
    expect(boundReport(errors)).toEqual(reportedOnce(d.ambiguousName.code, 'Error'));
    expect(boundReport({ ...errors, main: "import * from 'lib'" })).toEqual(reportedNothing);
  });
});
