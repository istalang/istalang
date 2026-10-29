import { describe, expect, it } from 'vitest';
import { corpusDirectory } from '../../../test/corpus/programs.ts';
import type { EntityUse } from '../../compiler/binder/entities.ts';
import { checkProgram } from '../../compiler/checker/check.ts';
import type { ModuleId, Program } from '../../compiler/program/program.ts';
import type { Identifier } from '../../compiler/syntax/node.ts';
import { nodesUnder } from '../../compiler/syntax/tree.ts';
import { findProjectSources, loadProject } from '../../project/project.ts';
import { isSamePlace, nameAt } from './declarations.ts';
import { navigable, placeOf } from './navigation.test-kit.ts';
import { namesDenoting, referencesAt } from './references.ts';

describe('the references of a declaration', () => {
  it('are every name of a field: declared, read, named in a literal, a pattern or a target, in any module', () => {
    const { program, named } = navigable({
      main: "import Pair from 'lib'\nfn f(p: Pair) -> int:\n  let q = Pair{first: p.first, second: 2}\n  q.first = 3\n  match q:\n    case Pair{first == 1}: 1\n    case _: 0\n",
      lib: 'struct Pair:\n  first: int\n  second: int\n',
    });
    const declaring = named('lib', 'first');
    const expected = [declaring, ...[0, 1, 2, 3].map((nth) => named('main', 'first', nth))];
    for (const use of expected) {
      const found = referencesAt(program, use.module, use.name.span.start);
      expect(new Set(found.map(placeOf))).toEqual(new Set(expected.map(placeOf)));
      expect(found).toHaveLength(expected.length);
    }
  });

  it("are a method's declaration and its calls", () => {
    const { program, named } = navigable({
      main: 'struct Box:\n  value: int\nfn get(self: Box) -> int: self.value\nfn f(b: Box) -> int: b.get() + get(b)\n',
    });
    const found = referencesAt(
      program,
      named('main', 'get').module,
      named('main', 'get').name.span.start,
    );
    expect(found.map(placeOf)).toEqual([0, 1, 2].map((nth) => placeOf(named('main', 'get', nth))));
  });

  it('say which name declares it', () => {
    const { program, named } = navigable({ main: 'fn f(x: int) -> int: x + x\n' });
    const use = named('main', 'x', 2);
    const found = referencesAt(program, use.module, use.name.span.start);
    expect(found.filter(({ declares }) => declares).map(placeOf)).toEqual([
      placeOf(named('main', 'x')),
    ]);
    expect(found).toHaveLength(3);
  });
});

/**
 * The uses the binder resolves to what `name` of `module` declares, by place, that the names
 * denoting it miss; none where `name` declares no entity.
 */
function missedUses(program: Program, module: ModuleId, name: Identifier): readonly string[] {
  const declaring = nameAt(program, module, name.span.start)?.declarations.find(({ at }) =>
    isSamePlace(at, { module, name }),
  );
  if (declaring === undefined || !('entity' in declaring.declared)) {
    return [];
  }
  const found = namesDenoting(program, declaring.at);
  const isFound = (use: EntityUse) => found.some((each) => isSamePlace(each, use));
  return checkProgram(program)
    .bindings.usesOf(declaring.declared.entity)
    .filter((use) => !isFound(use))
    .map((use) => `${use.module}:${use.name.span.start} ${use.name.text}`);
}

describe('the names denoting a declaration across the corpus', () => {
  it("include every use the binder resolves to the declaration's entity", () => {
    const { program } = loadProject(corpusDirectory, findProjectSources(corpusDirectory));
    const missed = [...program.modules].flatMap(([module, { tree }]) =>
      nodesUnder(tree, tree.root).flatMap((name) =>
        name.kind === 'Identifier' ? missedUses(program, module, name) : [],
      ),
    );
    expect(missed).toEqual([]);
  });
});
