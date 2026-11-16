import { describe, expect, it } from 'vitest';
import { idOf } from '../../../compiler/program/program.test-kit.ts';
import { type ModuleId, programModule, stdModuleIdOf } from '../../../compiler/program/program.ts';
import { parentOf } from '../../../compiler/syntax/tree/index.ts';
import { type DeclaredAt, type NamePlace, nameAt, spanOfUse } from './declarations.ts';
import { navigable, placeOf } from './navigation.test-kit.ts';

const pair = 'struct Pair:\n  first: Int\n  second: Int\n';

type Navigable = ReturnType<typeof navigable>['program'];

function declaredAround(
  program: Navigable,
  module: ModuleId,
  offset: number,
): readonly DeclaredAt[] {
  return nameAt(program, module, offset)?.declarations ?? [];
}

/** Where each declaration the name `use` denotes is declared. */
function declaredAt(program: ReturnType<typeof navigable>['program'], use: NamePlace): string[] {
  return declaredAround(program, use.module, spanOfUse(program, use).start).map(({ at }) =>
    placeOf(program, at),
  );
}

describe('the declarations a name denotes', () => {
  it('are declared where the declaring name stands, in another module too', () => {
    const { program, named } = navigable({
      main: "import tally from 'lib'\nfn main() -> Int: tally(1)\n",
      lib: 'fn tally(x: Int) -> Int: x\n',
    });
    expect(declaredAt(program, named('main', 'tally', 1))).toEqual([
      placeOf(program, named('lib', 'tally')),
    ]);
  });

  it("are the export's, at a renaming import's alias, its uses and its exported name", () => {
    const { program, named } = navigable({
      main: "import (\n  tally as count\n) from 'lib'\nfn main() -> Int: count(1)\n",
      lib: 'fn tally(x: Int) -> Int: x\n',
    });
    const declaring = [placeOf(program, named('lib', 'tally'))];
    expect(declaredAt(program, named('main', 'tally'))).toEqual(declaring);
    expect(declaredAt(program, named('main', 'count'))).toEqual(declaring);
    expect(declaredAt(program, named('main', 'count', 1))).toEqual(declaring);
  });

  it("are a field's, read or named in a literal or a pattern", () => {
    const { program, named } = navigable({
      main: `${pair}fn f(p: Pair) -> Int:\n  match Pair{first: p.first, second: 2}:\n    case Pair{first == 1}: 1\n    case Pair{first as x}: x\n`,
    });
    const field = placeOf(program, named('main', 'first'));
    for (const nth of [1, 2, 3, 4]) {
      expect(declaredAt(program, named('main', 'first', nth))).toEqual([field]);
    }
  });

  it('are a field and a variable for a shorthand', () => {
    const { program, named } = navigable({
      main: `${pair}fn f(first: Int) -> Pair: Pair{first, second: 2}\n`,
    });
    expect(new Set(declaredAt(program, named('main', 'first', 2)))).toEqual(
      new Set([
        placeOf(program, named('main', 'first')),
        placeOf(program, named('main', 'first', 1)),
      ]),
    );
  });

  it("are a method's, called on a value", () => {
    const { program, named } = navigable({
      main: `${pair}fn sum(self: Pair) -> Int: self.first + self.second\nfn f(p: Pair) -> Int: p.sum()\n`,
    });
    expect(declaredAt(program, named('main', 'sum', 1))).toEqual([
      placeOf(program, named('main', 'sum')),
    ]);
  });

  it('are in std for what std declares', () => {
    const { program, named } = navigable({ main: 'fn f() -> Result<Int>: Ok(1)\n' });
    const [declared] = declaredAround(
      program,
      idOf('main'),
      spanOfUse(program, named('main', 'Ok')).start,
    );
    expect(declared?.at.module).toBe('std:prelude');
  });

  it("are a parameter's for a name a std function's @Keeps gives", () => {
    const { program } = navigable({ main: '' });
    const prelude = stdModuleIdOf('prelude');
    const { text } = programModule(program, prelude).tree.source;
    const put = text.indexOf('@Keeps{["self": ["value"]]}\nista fn put<');
    const kept = text.indexOf('"value"', put) + 1;
    const declared = declaredAround(program, prelude, kept).map(({ at }) => placeOf(program, at));
    expect(declared).toEqual([`prelude:${text.indexOf('value: T)', put)}`]);
  });

  it("are the prelude's alias for `Optional`, whose static functions are on it", () => {
    const { program, named } = navigable({
      main: 'fn f(x: Optional<Int>) -> Int?: Optional.default()\n',
    });
    for (const nth of [0, 1]) {
      const [declared] = declaredAround(
        program,
        idOf('main'),
        spanOfUse(program, named('main', 'Optional', nth)).start,
      );
      const at = declared?.at;
      const holder = at && parentOf(programModule(program, at.module).tree, at.name);
      expect([at?.module, holder?.kind]).toEqual(['std:prelude', 'TypeAliasDeclaration']);
    }
  });

  it('are none for a primitive type, `None` among them, and where no name stands', () => {
    const { program, named } = navigable({ main: 'fn f(x: Int, n: None) -> Int: x\n' });
    expect(declaredAt(program, named('main', 'Int'))).toEqual([]);
    expect(declaredAt(program, named('main', 'None'))).toEqual([]);
    expect(declaredAround(program, idOf('main'), 'fn'.length)).toEqual([]);
  });

  it('are found from right after the name, as after typing it', () => {
    const { program, named } = navigable({ main: 'fn f(x: Int) -> Int: x\n' });
    const use = named('main', 'x', 1);
    const after = declaredAround(program, use.module, spanOfUse(program, use).end);
    expect(after.map(({ at }) => placeOf(program, at))).toEqual([
      placeOf(program, named('main', 'x')),
    ]);
  });
});
