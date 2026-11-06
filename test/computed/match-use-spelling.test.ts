/**
 * An associated type's unreduced type `match` use reads as source writes it, through the type that
 * declares it (§3.1, §3.17): `Bad<T>.Data`, in hovers and in every message alike, never the
 * associated type's own name given its owner's arguments.
 */

import { describe, expect, it } from 'vitest';
import { stdProgramOf } from '../../src/compiler/binder/bind.test-kit.ts';
import { diagnosedAt } from '../../src/compiler/compile.test-kit.ts';
import { hoverCodeAt } from './computed.test-kit.ts';

const declarations = [
  'struct Bad<T>:',
  '  x: T',
  '  type Data = match T:',
  '    case Int: String',
  '    case _: Bool',
];

describe("an associated type's unreduced use", () => {
  it('reads through its owner in a hover', () => {
    const hover = hoverCodeAt(
      ...declarations,
      'fn f<T>(b: Bad<T>, d: Bad<T>.Data) -> Int:',
      '  const e = d‸',
      '  0',
    );
    expect(hover?.join('\n')).toContain('Bad<T>.Data');
    expect(hover?.join('\n')).not.toContain('Data<T>');
  });

  it('reads through its owner in a message, named bare in its declaration', () => {
    const main = [
      'struct Bad<T>:',
      '  x: T',
      '  y: Data',
      '  type Data = match T:',
      '    case Int: String',
      '    case _: Bool',
      'fn f<T>(b: Bad<T>) -> Int: b.y',
    ].join('\n');
    const messages = diagnosedAt(stdProgramOf({ main }), 'main').diagnostics.map(
      (diagnostic) => diagnostic.message,
    );
    expect(messages).toEqual(['Expected Int, found Bad<T>.Data.']);
  });
});
