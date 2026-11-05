/**
 * The program's one index of the names denoting each declaration, against the binder's own
 * resolution of the corpus and against single programs.
 */

import { describe, expect, it } from 'vitest';
import { corpusDirectory } from '../../../test/corpus/programs.ts';
import type { Entity } from '../../compiler/binder/entities.ts';
import { checkProgram } from '../../compiler/checker/check.ts';
import type { Program } from '../../compiler/program/program.ts';
import { nodesUnder } from '../../compiler/syntax/tree.ts';
import { findProjectSources, loadProject } from '../../project/project.ts';
import { isSamePlace, type NamePlace, nameAt, spanOfUse, spelledName } from './declarations.ts';
import { navigable, placeOf } from './navigation.test-kit.ts';
import { namesDenoting, referencesAt } from './references.ts';

describe('the references of a declaration', () => {
  it('are every name of a field: declared, read, named in a literal, a pattern or a target, in any module', () => {
    const { program, named } = navigable({
      main: "import Pair from 'lib'\nfn f(p: Pair) -> Int:\n  let q = Pair{first: p.first, second: 2}\n  q.first = 3\n  match q:\n    case Pair{first == 1}: 1\n    case _: 0\n",
      lib: 'struct Pair:\n  first: Int\n  second: Int\n',
    });
    const declaring = named('lib', 'first');
    const expected = [declaring, ...[0, 1, 2, 3].map((nth) => named('main', 'first', nth))];
    for (const use of expected) {
      const found = referencesAt(program, use.module, spanOfUse(program, use).start);
      expect(new Set(found.map((each) => placeOf(program, each)))).toEqual(
        new Set(expected.map((each) => placeOf(program, each))),
      );
      expect(found).toHaveLength(expected.length);
    }
  });

  it("are a method's declaration and its calls", () => {
    const { program, named } = navigable({
      main: 'struct Box:\n  value: Int\nfn get(self: Box) -> Int: self.value\nfn f(b: Box) -> Int: b.get() + get(b)\n',
    });
    const found = referencesAt(
      program,
      named('main', 'get').module,
      spanOfUse(program, named('main', 'get')).start,
    );
    expect(found.map((each) => placeOf(program, each))).toEqual(
      [0, 1, 2].map((nth) => placeOf(program, named('main', 'get', nth))),
    );
  });

  it('say which name declares it', () => {
    const { program, named } = navigable({ main: 'fn f(x: Int) -> Int: x + x\n' });
    const use = named('main', 'x', 2);
    const found = referencesAt(program, use.module, spanOfUse(program, use).start);
    expect(found.filter(({ declares }) => declares).map((each) => placeOf(program, each))).toEqual([
      placeOf(program, named('main', 'x')),
    ]);
    expect(found).toHaveLength(3);
  });
});

/** Every name of `program` the binder resolves, by the entity it denotes. */
function namesByEntity(program: Program): ReadonlyMap<Entity | undefined, readonly NamePlace[]> {
  const { bindings } = checkProgram(program);
  const names = [...program.modules].flatMap(([module, { tree }]) =>
    nodesUnder(tree, tree.root).flatMap((name) =>
      name.kind === 'Identifier' ? [{ module, name }] : [],
    ),
  );
  return Map.groupBy(names, ({ module, name }) => bindings.entityOf(module, name));
}

/**
 * The names the binder resolves to what `name` of `module` declares, by place, that the names
 * denoting it miss; none where `name` declares no entity.
 */
function missedUses(
  program: Program,
  byEntity: ReadonlyMap<Entity | undefined, readonly NamePlace[]>,
  { module, name }: NamePlace,
): readonly string[] {
  const declaring = nameAt(
    program,
    module,
    spanOfUse(program, { module, name }).start,
  )?.declarations.find(({ at }) => isSamePlace(at, { module, name }));
  if (declaring === undefined || !('entity' in declaring.declared)) {
    return [];
  }
  const found = namesDenoting(program, declaring.at);
  const isFound = (use: NamePlace) => found.some((each) => isSamePlace(each, use));
  return (byEntity.get(declaring.declared.entity) ?? [])
    .filter((use) => !isFound(use))
    .map((use) => `${use.module}:${spanOfUse(program, use).start} ${spelledName(use.name)}`);
}

describe('the names denoting a declaration across the corpus', () => {
  it("include every use the binder resolves to the declaration's entity", () => {
    const { program } = loadProject(corpusDirectory, findProjectSources(corpusDirectory));
    const byEntity = namesByEntity(program);
    const missed = [...byEntity.values()]
      .flat()
      .flatMap((place) => missedUses(program, byEntity, place));
    expect(missed).toEqual([]);
  });
});
