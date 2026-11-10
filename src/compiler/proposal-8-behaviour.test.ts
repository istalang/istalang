/**
 * Proposal 8's behaviour table, the rows its kinds decide (phase K1): each row's program, and what
 * it does now. The rows on deferred calls are DC's (deferred-calls tests), and those on `delegate`
 * and contexts are later phases'.
 */

import { describe, expect, it } from 'vitest';
import { definitionFormat } from '../definition/definition.ts';
import { startToEnd, testRuntime } from '../runtime/runtime.test-kit.ts';
import { reported } from './checker/check.test-kit.ts';
import { checkerDiagnostics } from './checker/diagnostics/index.ts';
import { compiledText } from './compile.test-kit.ts';
import { lines } from './parser/parse.test-kit.ts';

/** The codes checking `source` reports. */
function codesOf(source: string): readonly number[] {
  return reported(source).codes;
}

/** What an entry's name writes after its function's: an instance's type arguments. */
const typeArguments = /<.*$/u;

/** The modes of the code entries named `name`, each once, any instance of it, in `text`'s Definition. */
function modesOf(text: string, name: string): readonly string[] {
  return definitionFormat
    .read(text)
    .functions.flatMap((entry) =>
      entry.kind === 'code' && entry.name.replace(typeArguments, '') === name ? [entry.mode] : [],
    )
    .filter((mode, index, all) => all.indexOf(mode) === index)
    .toSorted();
}

const timeImport = "import * as time from 'time'";

describe('proposal 8 behaviour table: kinds', () => {
  it('a written `Future<T>` names neither kind, and is refused', () => {
    expect(codesOf('fn f(x: Future<Int>): ()')).toContain(
      checkerDiagnostics.typeArgumentCount.code,
    );
  });

  it('an unmarked `async fn` is of its caller kind: two entries when both kinds call it', () => {
    const text = compiledText(
      lines(
        'async fn two(x: Int) -> Int: x * 2',
        'live async fn fromLive() -> Int: await two(1)',
        'ista async fn fromIsta() -> Int: await two(2)',
        'ista async fn main() -> Int: await fromIsta()',
      ),
    );
    expect(modesOf(text, 'main.two')).toEqual(['ista', 'live']);
  });

  it('a plain function made async in unmarked code runs as the kind each copy is of', async () => {
    const text = compiledText(
      lines(
        'fn plainOne() -> Int: 1',
        'async fn runAsync(f: async fn() -> Int) -> Int: await f()',
        'async fn caller() -> Int: await runAsync(plainOne)',
        'ista async fn main() -> Int: await caller()',
      ),
    );
    expect(await startToEnd(testRuntime(), text)).toEqual({ kind: 'finished', outcome: '1' });
  });

  it('a `live async fn` waits in memory and writes nothing to the store across its wait', async () => {
    const test = testRuntime();
    const text = compiledText(
      lines(timeImport, 'live async fn main() -> Int:', '  await time.delay(5ms)', '  7'),
    );
    expect(await startToEnd(test, text)).toEqual({ kind: 'finished', outcome: '7' });
    expect(test.store.commits).toEqual([]);
  });

  it('an ista main commits at its wait, as every main did', async () => {
    const test = testRuntime();
    const text = compiledText(
      lines(timeImport, 'ista async fn main() -> Int:', '  await time.delay(5ms)', '  7'),
    );
    expect(await startToEnd(test, text)).toEqual({ kind: 'finished', outcome: '7' });
    expect(test.store.commits.length).toBeGreaterThan(0);
  });

  it("a header's written `Future<…>` must be of its kind", () => {
    expect(codesOf('live async fn f() -> Future<Int, "ista">: 1')).toEqual([
      checkerDiagnostics.kindsHeld.code,
    ]);
  });

  it('an unmarked requirement is met only by an unmarked function, one of a kind by that kind', () => {
    const runner = (requirement: string, witness: string) =>
      lines(
        'struct R { n: Int }',
        `trait Runner { ${requirement} run(self: Self) -> Int }`,
        `${witness} run(self: R) -> Int: self.n`,
        'fn via<T is Runner>(x: T) -> Int: x.run()',
        'ista fn main() -> Int: via(R{n: 1})',
      );
    expect(codesOf(runner('fn', 'ista fn'))).not.toEqual([]);
    expect(codesOf(runner('fn', 'fn'))).toEqual([]);
  });

  it('an unmarked function calling a live one is missing its mark', () => {
    const source = lines('live async fn x() -> Int: 1', 'fn y(): _ = x()');
    expect(reported(source)).toEqual({
      codes: [checkerDiagnostics.unmarkedCalls.code],
      spanTexts: ['x()'],
    });
  });

  it('a signature holding a live handle is live', () => {
    const source = lines('extern live struct Socket', 'fn f(s: Socket): ()');
    expect(codesOf(source)).toEqual([checkerDiagnostics.unmarkedHolds.code]);
  });

  it('live code calls nothing ista, an inbox receive included', () => {
    expect(
      codesOf(lines('ista async fn x() -> Int: 1', 'live async fn y() -> Int: await x()')),
    ).toContain(checkerDiagnostics.kindsMeet.code);
    const receiving = lines(
      "import Inbox from 'inbox'",
      'live async fn y(i: Inbox<Int>) -> Int: await i.receive()',
    );
    expect(codesOf(receiving)).toContain(checkerDiagnostics.kindsMeet.code);
  });

  it('ista code calls nothing live', () => {
    const source = lines(
      'extern live async fn get(u: String) -> String',
      'ista async fn f() -> String: await get("u")',
    );
    expect(codesOf(source)).toContain(checkerDiagnostics.kindsMeet.code);
  });

  it('`time.delay` in live code is a live timer', async () => {
    const test = testRuntime();
    const text = compiledText(
      lines(
        timeImport,
        'live async fn wait() -> Int:',
        '  await time.delay(5s)',
        '  1',
        'live async fn main() -> Int: await wait()',
      ),
    );
    expect(await startToEnd(test, text)).toEqual({ kind: 'finished', outcome: '1' });
    expect(test.store.commits).toEqual([]);
  });

  it('`retry` given a live function runs live, and given an ista one runs ista', () => {
    const text = compiledText(
      lines(
        'async fn retry<T>(f: async fn() -> T, times: Int) -> T: await f()',
        'live async fn fetchLive() -> Int: 1',
        'ista async fn fetchIsta() -> Int: 2',
        'live async fn inLive() -> Int: await retry(fetchLive, 3)',
        'ista async fn main() -> Int: await retry(fetchIsta, 3)',
      ),
    );
    expect(modesOf(text, 'main.retry')).toEqual(['ista', 'live']);
  });

  it('an `await select` over a case of the other kind is refused', () => {
    const source = lines(
      timeImport,
      'live async fn f(other: Future<Int, "ista">) -> Int:',
      '  await select:',
      '    case other as x: x',
    );
    expect(codesOf(source)).toContain(checkerDiagnostics.waitOfOtherKind.code);
  });

  it('a local function whose body depends on no kind is of either kind, so it fits an unmarked field', () => {
    const source = lines(
      'shared struct Box { run: fn() -> Unit }',
      'ista fn make(flag: Shared<Bool>) -> Box:',
      '  fn note(): flag->value = true',
      '  new Box{run: note}',
    );
    expect(codesOf(source)).toEqual([]);
  });

  it('a lambda an unmarked field takes is of either kind, so it calls and holds nothing ista', () => {
    const source = lines(
      'shared struct Later { run: fn() -> Future<Int, "ista"> }',
      'ista async fn x() -> Int: 1',
      'ista fn make() -> Later: new Later{run: fn(): x()}',
    );
    expect(codesOf(source)).toEqual([
      checkerDiagnostics.unmarkedHolds.code,
      checkerDiagnostics.unmarkedCalls.code,
    ]);
  });

  it('an unmarked `async fn` type outside a signature has no kind, and is refused', () => {
    expect(codesOf('type Later = async fn() -> Int')).toEqual([
      checkerDiagnostics.unkindedFuture.code,
    ]);
  });

  it('a plain lambda fits where an ista async function is expected: a resolved future', () => {
    const source = lines(
      'struct Order { id: String }',
      'ista async fn retry(times: Int, call: ista async fn(String) -> Order) -> Order: await call("x")',
      'ista async fn main() -> String: (await retry(3, fn(id): Order{id})).id',
    );
    expect(codesOf(source)).toEqual([]);
  });

  it('overloads on the two kinds are two types, and a plain argument to them is ambiguous', () => {
    const pair = lines(
      'fn f(g: live async fn() -> Int) -> Int: 1',
      'fn f(g: ista async fn() -> Int) -> Int: 2',
    );
    expect(codesOf(pair)).toEqual([]);
    const plain = `${pair}\nfn plain() -> Int: 0\nfn main(): _ = f(plain)`;
    expect(codesOf(plain)).toContain(checkerDiagnostics.ambiguousCall.code);
  });
});
