/**
 * The marks a witness meets a requirement by (proposal 8, Rule 4): a simple witness meets any
 * requirement, one of the requirement's kind meets it, and an unmarked requirement takes a witness
 * of the kind the implementing type's values are of; a witness meets it as its instantiation does,
 * its mark and all it calls through its own constraints.
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

  it('meets a requirement as every call it makes does, its own witnesses among them (Rule 3)', () => {
    const phantom = (argument: string) =>
      codesOf(
        'shared struct LiveResource { n: Int }',
        'live fn dispose(self: LiveResource): ()',
        'live fn LiveResource.default() -> LiveResource: new LiveResource{n: 42}',
        'struct Plain { n: Int }',
        'fn Plain.default() -> Plain: Plain{n: 0}',
        'struct Phantom<T> { tag: Int }',
        'fn Phantom.default<T is Default>() -> Phantom<T>:',
        '  drop T.default()',
        '  Phantom<T>{tag: 0}',
        'trait HasItem { type Item is Default }',
        `struct Impl { n: Int = 0, type Item = Phantom<${argument}> }`,
        'fn trigger<X is HasItem>() -> Int:',
        '  drop X.Item.default()',
        '  0',
        'ista fn main() -> Int: trigger<Impl>()',
      );
    expect(phantom('LiveResource')).toContain(unmet);
    expect(phantom('Plain')).toEqual([]);
  });
});
