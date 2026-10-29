import { describe, expect, it } from 'vitest';
import type { EntityUse } from '../../compiler/binder/entities.ts';
import { idOf } from '../../compiler/program/program.test-kit.ts';
import type { ModuleId } from '../../compiler/program/program.ts';
import { type DeclaredAt, nameAt } from './declarations.ts';
import { navigable, placeOf } from './navigation.test-kit.ts';

const pair = 'struct Pair:\n  first: int\n  second: int\n';

type Navigable = ReturnType<typeof navigable>['program'];

function declaredAround(
  program: Navigable,
  module: ModuleId,
  offset: number,
): readonly DeclaredAt[] {
  return nameAt(program, module, offset)?.declarations ?? [];
}

/** Where each declaration the name `use` denotes is declared. */
function declaredAt(program: ReturnType<typeof navigable>['program'], use: EntityUse): string[] {
  return declaredAround(program, use.module, use.name.span.start).map(({ at }) => placeOf(at));
}

describe('the declarations a name denotes', () => {
  it('are declared where the declaring name stands, in another module too', () => {
    const { program, named } = navigable({
      main: "import tally from 'lib'\nfn main() -> int: tally(1)\n",
      lib: 'fn tally(x: int) -> int: x\n',
    });
    expect(declaredAt(program, named('main', 'tally', 1))).toEqual([
      placeOf(named('lib', 'tally')),
    ]);
  });

  it("are a field's, read or named in a literal or a pattern", () => {
    const { program, named } = navigable({
      main: `${pair}fn f(p: Pair) -> int:\n  match Pair{first: p.first, second: 2}:\n    case Pair{first == 1}: 1\n    case Pair{first as x}: x\n`,
    });
    const field = placeOf(named('main', 'first'));
    for (const nth of [1, 2, 3, 4]) {
      expect(declaredAt(program, named('main', 'first', nth))).toEqual([field]);
    }
  });

  it('are a field and a variable for a shorthand', () => {
    const { program, named } = navigable({
      main: `${pair}fn f(first: int) -> Pair: Pair{first, second: 2}\n`,
    });
    expect(new Set(declaredAt(program, named('main', 'first', 2)))).toEqual(
      new Set([placeOf(named('main', 'first')), placeOf(named('main', 'first', 1))]),
    );
  });

  it("are a method's, called on a value", () => {
    const { program, named } = navigable({
      main: `${pair}fn sum(self: Pair) -> int: self.first + self.second\nfn f(p: Pair) -> int: p.sum()\n`,
    });
    expect(declaredAt(program, named('main', 'sum', 1))).toEqual([placeOf(named('main', 'sum'))]);
  });

  it('are in std for what std declares', () => {
    const { program, named } = navigable({ main: 'fn f() -> int?: Some{value: 1}\n' });
    const [declared] = declaredAround(program, idOf('main'), named('main', 'Some').name.span.start);
    expect(declared?.at.module).toBe('std:prelude');
  });

  it('are none for a primitive type, and where no name stands', () => {
    const { program, named } = navigable({ main: 'fn f(x: int) -> int: x\n' });
    expect(declaredAt(program, named('main', 'int'))).toEqual([]);
    expect(declaredAround(program, idOf('main'), 'fn'.length)).toEqual([]);
  });

  it('are found from right after the name, as after typing it', () => {
    const { program, named } = navigable({ main: 'fn f(x: int) -> int: x\n' });
    const use = named('main', 'x', 1);
    const after = declaredAround(program, use.module, use.name.span.end);
    expect(after.map(({ at }) => placeOf(at))).toEqual([placeOf(named('main', 'x'))]);
  });
});
