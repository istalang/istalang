/**
 * The marks a witness meets a requirement by (proposal 8, Rule 4): a simple witness meets any
 * requirement, one of the requirement's kind meets it, and an unmarked requirement takes a witness
 * of the kind the implementing type's values are of; a witness generic over its mark meets it as
 * its instantiation's mark does.
 */

import { describe, expect, it } from 'vitest';
import { lines } from '../../../parser/parse.test-kit.ts';
import { reported } from '../../check.test-kit.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';

/** The codes checking `source` reports. */
function codesOf(...source: readonly string[]): readonly number[] {
  return reported(lines(...source)).codes;
}

const unmet = checkerDiagnostics.notConforming.code;

describe('a witness of a kind', () => {
  it("meets an unmarked requirement for a type of its kind, and none of the other kind's", () => {
    const socket = ['extern live struct Socket', 'live fn act(self: Socket): ()'];
    expect(
      codesOf(
        ...socket,
        'trait Acts { fn act(self: Self) }',
        'fn via<T is Acts>(x: T): x.act()',
        'live fn main(s: Socket): via(s)',
      ),
    ).toEqual([]);
    expect(
      codesOf(
        ...socket,
        'trait IstaActs { ista fn act(self: Self) }',
        'ista fn via<T is IstaActs>(x: T): x.act()',
        'live fn main(s: Socket): via(s)',
      ),
    ).toContain(unmet);
  });

  it('meets a requirement of the other kind for no type, whatever it holds', () => {
    expect(
      codesOf(
        "import Inbox from 'inbox'",
        'ista fn act(self: Inbox<Int>): ()',
        'trait LiveActs { live fn act(self: Self) }',
        'live fn via<T is LiveActs>(x: T): x.act()',
        'ista fn main(i: Inbox<Int>): via(i)',
      ),
    ).toContain(unmet);
  });

  it('generic over its mark, meets a requirement as its instantiation does', () => {
    const runner = (witness: string) =>
      codesOf(
        'struct R { n: Int }',
        'trait Runner { fn run(self: Self) -> Int }',
        witness,
        'fn via<T is Runner>(x: T) -> Int: x.run()',
        'ista fn main() -> Int: via(R{n: 1})',
      );
    expect(runner('K fn run<K in Persistence = "live">(self: R) -> Int: 1')).toContain(unmet);
    expect(runner('M fn run<M in Mark>(self: R) -> Int: 1')).toEqual([]);
  });
});
