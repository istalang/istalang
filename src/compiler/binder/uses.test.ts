/**
 * Every name the binder resolves is listed among its entity's uses, across modules, and nothing
 * else is: over the whole corpus and every std module, and on a small program spanning modules.
 */

import { describe, expect, it } from 'vitest';
import { idOf } from '../program/program.test-kit.ts';
import {
  boundCorpus,
  type CorpusProgram,
  entityOfName,
  namesIn,
  type ResolvedName,
  resolvedNames,
  stdProgramOf,
} from './bind.test-kit.ts';
import { bindProgram } from './bind.ts';

const corpus = boundCorpus();

function label({ module, name }: Omit<ResolvedName, 'entity'>): string {
  return `${module}:${name.span.from} ${name.text}`;
}

/** The names of `modules` the binder resolved that their entity's uses leave out. */
function unlistedIn({ program, modules }: CorpusProgram): readonly ResolvedName[] {
  const bindings = bindProgram(program);
  const isListed = ({ module, name, entity }: ResolvedName) =>
    bindings.usesOf(entity).some((use) => use.module === module && use.name === name);
  return modules
    .flatMap((module) => resolvedNames(program, module))
    .filter((resolved) => !isListed(resolved));
}

describe('usesOf', () => {
  it("lists every name the binder resolves among its entity's uses", () => {
    expect(corpus.flatMap(unlistedIn).map(label)).toEqual([]);
  });

  it('lists only names that denote the entity', () => {
    const foreign = corpus.flatMap(({ program, modules }) => {
      const bindings = bindProgram(program);
      const entities = new Set(
        modules.flatMap((module) => resolvedNames(program, module).map(({ entity }) => entity)),
      );
      return [...entities].flatMap((entity) =>
        bindings.usesOf(entity).filter((use) => bindings.entityOf(use.module, use.name) !== entity),
      );
    });
    expect(foreign.map(label)).toEqual([]);
  });

  it('lists a declaration, its import and its uses in another module', () => {
    const files = {
      main: "import tally from 'lib'\nfn main(): tally(1) + tally(2)",
      lib: 'fn tally(n: int): n',
    };
    const program = stdProgramOf(files);
    const tally = entityOfName(program, 'lib', 'tally', 0);
    const uses = tally === undefined ? [] : bindProgram(program).usesOf(tally);
    expect(uses).toEqual([
      ...namesIn(program, 'main', 'tally').map((name) => ({ module: idOf('main'), name })),
      ...namesIn(program, 'lib', 'tally').map((name) => ({ module: idOf('lib'), name })),
    ]);
  });
});
