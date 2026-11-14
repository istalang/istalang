/**
 * A getter in the editor (§3.1): offered and shown as the field it reads as, while hover, going to
 * its definition and renaming reach the function it is.
 */

import { describe, expect, it } from 'vitest';
import { completionsAt } from './completion/index.ts';
import { hoverAt } from './hover.ts';
import { programAt } from './language-service.test-kit.ts';
import { nameAt, spanOfUse } from './navigation/declarations.ts';
import { edited, navigable, placeOf } from './navigation/navigation.test-kit.ts';
import { renameEdits } from './navigation/rename.ts';

const person = [
  'struct Person:',
  '  first: String',
  '  last: String',
  '',
  '@Getter',
  'fn full(self: Person) -> String: self.first',
  '',
];

const reader = 'fn greet(p: Person) -> String: p.full\n';

describe('a getter in the editor', () => {
  it('is offered after a value, an optional or a shared struct handle as a field, of the type it gives', () => {
    const direct = programAt(...person, 'fn greet(p: Person) -> String: p.‸');
    const optional = programAt(...person, 'fn greet(p: Person?) -> String?: p?.‸');
    const shared = programAt(
      'shared struct Lease:',
      '  renewals: Int = 0',
      '@Getter',
      'fn twice(self: Lease) -> Int: self->renewals * 2',
      'fn check(l: Lease) -> Int: l.‸',
    );
    for (const [at, name, detail] of [
      [direct, 'full', 'String'],
      [optional, 'full', 'String'],
      [shared, 'twice', 'Int'],
    ] as const) {
      const offered = completionsAt(at.program, at.module, at.offset).filter(
        (item) => item.name === name,
      );
      expect(offered.map(({ kind, detail: d }) => ({ kind, detail: d }))).toEqual([
        { kind: 'field', detail },
      ]);
    }
  });

  it('shows the function it is when hovered where it is read or called through', () => {
    const read = programAt(...person, 'fn greet(p: Person) -> String: p.fu‸ll');
    expect(hoverAt(read.program, read.module, read.offset)?.code).toEqual([
      'fn full(self: Person) -> String',
    ]);
    const called = programAt(
      'struct Adder:',
      '  n: Int',
      '@Getter',
      'fn add(self: Adder) -> fn(Int) -> Int: fn(x): x + self.n',
      'fn run(a: Adder) -> Int: a.ad‸d(3)',
    );
    expect(hoverAt(called.program, called.module, called.offset)?.code).toEqual([
      'fn add(self: Adder) -> fn(Int) -> Int',
    ]);
  });

  it('goes to its declaration from a read or call, and is renamed with its reads', () => {
    const { program, named } = navigable({ main: `${person.join('\n')}${reader}` });
    const read = named('main', 'full', 1);
    const declared = nameAt(program, read.module, spanOfUse(program, read).start)?.declarations;
    expect(declared?.map(({ at }) => placeOf(program, at))).toEqual([
      placeOf(program, named('main', 'full')),
    ]);
    const renaming = renameEdits(program, read.module, spanOfUse(program, read).start, 'whole');
    expect(renaming?.kind === 'renamed' && edited(program, renaming.edits).main).toBe(
      `${person.join('\n').replace('fn full', 'fn whole')}${reader.replace('p.full', 'p.whole')}`,
    );
  });
});
