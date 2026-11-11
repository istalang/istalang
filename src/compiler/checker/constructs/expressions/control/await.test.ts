/**
 * What `await` and a `select`'s case wait on (proposal 8, Rule 5): any type with an `onAwait`
 * taking a `Resolver`, whose value is what the wait gives and whose kind, the type's `Mode`, the
 * code's must be. A type parameter's awaitable waits in its `Mode`, which no kind is.
 */

import { describe, expect, it } from 'vitest';
import { checkerDiagnostics } from '../../../diagnostics/index.ts';
import { codesOf } from '../../../rules/kinds/kinds.test-kit.ts';

const { awaitNeedsFuture, caseNeedsFuture, waitOfOtherKind } = checkerDiagnostics;

/** A type awaited in `mode`, giving an `Int`. */
function awaitable(mode: string): readonly string[] {
  return [
    'struct Ticket:',
    `  type Mode = "${mode}"`,
    `${mode} fn onAwait(self: Ticket, done: Resolver<Int, "${mode}">): done.resolve(1)`,
  ];
}

describe('an awaited value', () => {
  it('is any type with an onAwait, giving what its resolver takes', () => {
    expect(codesOf(...awaitable('ista'), 'ista async fn main() -> Int: 1 + await Ticket')).toEqual(
      [],
    );
    expect(codesOf(...awaitable('live'), 'live async fn run() -> Int: 1 + await Ticket')).toEqual(
      [],
    );
  });

  it('waits in its Mode, which must be the kind of the code awaiting it', () => {
    expect(codesOf(...awaitable('live'), 'ista async fn main() -> Int: await Ticket')).toEqual([
      waitOfOtherKind.code,
    ]);
  });

  it("is refused through a type parameter's awaitable, whose Mode no kind is", () => {
    expect(
      codesOf('ista async fn wait<A is Awaitable<Int>>(awaited: A) -> Int: await awaited'),
    ).toEqual([waitOfOtherKind.code]);
  });

  it('is refused without an onAwait, or with one taking no resolver, or with an async or non-Unit onAwait', () => {
    expect(codesOf('ista async fn main() -> Int: await 1')).toEqual([awaitNeedsFuture.code]);
    expect(
      codesOf(
        'struct Odd {}',
        'fn onAwait(self: Odd, done: Int): ()',
        'ista async fn main(): await Odd',
      ),
    ).toEqual([awaitNeedsFuture.code]);
    expect(
      codesOf(
        'struct AsyncOdd { type Mode = "ista" }',
        'ista async fn onAwait(self: AsyncOdd, done: Resolver<Int, "ista">): done.resolve(1)',
        'ista async fn main() -> Int: await AsyncOdd',
      ),
    ).toEqual([awaitNeedsFuture.code]);
    expect(
      codesOf(
        'struct NonUnitOdd { type Mode = "ista" }',
        'ista fn onAwait(self: NonUnitOdd, done: Resolver<Int, "ista">) -> Int: 1',
        'ista async fn main() -> Int: await NonUnitOdd',
      ),
    ).toEqual([awaitNeedsFuture.code]);
  });

  it("is a select case's, checked alike, including Never and error cases without spurious diagnostics", () => {
    const select = (mode: string, operand: string) => [
      `${mode} async fn main() -> Int:`,
      '  await select:',
      `    case ${operand} as got:`,
      '      got',
    ];
    expect(codesOf(...awaitable('ista'), ...select('ista', 'Ticket'))).toEqual([]);
    expect(codesOf(...awaitable('ista'), ...select('live', 'Ticket'))).toEqual([
      waitOfOtherKind.code,
    ]);
    expect(codesOf(...select('ista', '1'))).toEqual([caseNeedsFuture.code]);
    expect(codesOf(...select('ista', 'panic("boom")'))).toEqual([caseNeedsFuture.code]);
    expect(codesOf(...awaitable('ista'), ...select('ista', 'panic("boom")'))).toEqual([
      caseNeedsFuture.code,
    ]);
    expect(codesOf(...awaitable('ista'), ...select('live', 'unknownVar'))).not.toContain(
      waitOfOtherKind.code,
    );
  });

  it('waits in a mark-generic async function when the awaitable has that mark', () => {
    expect(
      codesOf(
        'struct Custom<T, K in Persistence>:',
        '  value: T',
        '  type Mode = K',
        'K fn onAwait<T, K in Persistence>(self: Custom<T, K>, done: Resolver<T, K>): done.resolve(self.value)',
        'K async fn waitCustom<T, K in Persistence>(c: Custom<T, K>) -> T: await c',
        'ista async fn main() -> Int: await waitCustom(Custom<Int, "ista">{value: 42})',
      ),
    ).toEqual([]);
  });
});
