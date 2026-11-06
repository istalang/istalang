/**
 * A recursive type's entry in a compiled program is named for its preferred alias (§3.17,
 * docs/arch/definition.md): of every alias of the program naming that type, a generic one given
 * its arguments included, a std module's first, then by module path, then by name, so the name
 * never depends on which alias lowering met first.
 */

import { describe, expect, it } from 'vitest';
import { stdProgramOf } from '../binder/bind.test-kit.ts';
import { compiledDefinition } from '../compile.test-kit.ts';

const modules = {
  'a.ista': 'type FormTree<T> = T | Array<FormTree<T>>',
  'b.ista': 'type CrmTree<T> = T | Array<CrmTree<T>>',
};

/** The type entries' names of a program whose `main` calls `first`, then `second`. */
function entryNames(first: string, second: string): readonly (string | undefined)[] {
  const main = [
    "import FormTree from 'a.ista'",
    "import CrmTree from 'b.ista'",
    'fn fromForm(t: FormTree<Int>) -> Int: 1',
    'fn fromCrm(t: CrmTree<Int>) -> Int: 2',
    'async fn main() -> Future<Int>:',
    `  return ${first}([1, [2]]) + ${second}([3])`,
  ].join('\n');
  return compiledDefinition(stdProgramOf({ 'main.ista': main, ...modules }), 'main.ista')
    .types.map((entry) => entry.name)
    .filter((name) => name?.endsWith('Tree') === true);
}

describe("a generic recursive alias's instantiation in a compiled program", () => {
  it('names its entry for the preferred alias, whichever lowering meets first', () => {
    expect(entryNames('fromForm', 'fromCrm')).toEqual(['a.ista.FormTree']);
    expect(entryNames('fromCrm', 'fromForm')).toEqual(['a.ista.FormTree']);
  });
});
