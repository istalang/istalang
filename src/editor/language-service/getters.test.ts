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
  it('is offered after a value as a field, of the type it gives', () => {
    const { program, module, offset } = programAt(...person, 'fn greet(p: Person) -> String: p.‸');
    const offered = completionsAt(program, module, offset).filter(({ name }) => name === 'full');
    expect(offered.map(({ kind, detail }) => ({ kind, detail }))).toEqual([
      { kind: 'field', detail: 'String' },
    ]);
  });

  it('shows the function it is when hovered where it is read', () => {
    const { program, module, offset } = programAt(
      ...person,
      'fn greet(p: Person) -> String: p.fu‸ll',
    );
    expect(hoverAt(program, module, offset)?.code).toEqual(['fn full(self: Person) -> String']);
  });

  it('goes to its declaration from a read, and is renamed with its reads', () => {
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
