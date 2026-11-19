/**
 * A keyed member in the editor (§10.2): `d.city` read through an `index` keyed by a member parameter
 * is offered and shown as the field it reads as, of its own key's type, while hover and going to
 * its definition reach the `index` its read calls.
 */

import { describe, expect, it } from 'vitest';
import { completionsAt } from './completion/index.ts';
import { hoverAt } from './hover.ts';
import { programAt } from './language-service.test-kit.ts';
import { nameAt, spanOfUse } from './navigation/declarations.ts';
import { navigable, placeOf } from './navigation/navigation.test-kit.ts';

const scope = [
  'struct Model:',
  '  city: String',
  '  size: Int',
  'struct Reads<S is struct>:',
  '  m: S',
  'fn index<S is struct, K in keyof S>(self: Reads<S>, key: K) -> S[K]:',
  '  self.m[key]',
  '',
];

describe('a keyed member in the editor', () => {
  it('is offered after a value as a field, each key of the type its read gives', () => {
    const at = programAt(...scope, 'fn read(d: Reads<Model>) -> Unit:', '  _ = d.‸');
    const offered = completionsAt(at.program, at.module, at.offset).filter((item) =>
      ['city', 'size'].includes(item.name),
    );
    expect(offered.map(({ name, kind, detail }) => ({ name, kind, detail }))).toEqual([
      { name: 'city', kind: 'field', detail: 'String' },
      { name: 'size', kind: 'field', detail: 'Int' },
    ]);
  });

  it('shows the index its read calls when hovered', () => {
    const at = programAt(...scope, 'fn read(d: Reads<Model>) -> Int: d.si‸ze');
    expect(hoverAt(at.program, at.module, at.offset)?.code).toEqual([
      'fn index<S, K>(self: Reads<S>, key: K) -> S[K]',
    ]);
  });

  it('goes to the index from a read', () => {
    const reader = 'fn read(d: Reads<Model>) -> Int: d.size\n';
    const { program, named } = navigable({ main: `${scope.join('\n')}${reader}` });
    const read = named('main', 'size', 1);
    const declared = nameAt(program, read.module, spanOfUse(program, read).start)?.declarations;
    expect(declared?.map(({ at }) => placeOf(program, at))).toEqual([
      placeOf(program, named('main', 'index')),
    ]);
  });
});
