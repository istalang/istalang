/**
 * Proposal 8's behaviour table, the rows its kinds and its data rule decide (phase K1): each row's
 * program, and what it does now. The rows on deferred calls are DC's (deferred-calls tests), and
 * those on contexts CX's (runtime/host/contexts.test.ts).
 */

import { describe, expect, it } from 'vitest';
import type { KeyedDefinition } from '../definition/definition.ts';
import { startToEnd, testRuntime } from '../runtime/runtime.test-kit.ts';
import { stdProgramOf } from './binder/bind.test-kit.ts';
import { reported } from './checker/check.test-kit.ts';
import { checkerDiagnostics } from './checker/diagnostics/index.ts';
import { compiledEncoded, diagnosedAt } from './compile.test-kit.ts';
import { lines } from './parser/parse.test-kit.ts';

/** The codes checking `source` reports. */
function codesOf(source: string): readonly number[] {
  return reported(source).codes;
}

/** What an entry's name writes after its function's: an instance's type arguments. */
const typeArguments = /<.*$/u;

/** The modes of the code entries named `name`, each once, any instance of it, in `keyed`'s Definition. */
function modesOf({ definition }: KeyedDefinition, name: string): readonly string[] {
  return definition.functions
    .flatMap((entry) =>
      entry.kind === 'code' && entry.name.replace(typeArguments, '') === name ? [entry.mode] : [],
    )
    .filter((mode, index, all) => all.indexOf(mode) === index)
    .toSorted();
}

const timeImport = "import * as time from 'time'";

const socket = 'extern live struct Socket';

/** `K async fn twice`, generic over its kind, waiting once. */
const twice = lines(
  timeImport,
  'K async fn twice<K in Persistence>(x: Int) -> Int:',
  '  await time.delay(1ms)',
  '  x * 2',
);

const retry =
  'K async fn retry<K in Persistence, T>(f: Fn<(), Future<T, K>, K>, times: Int) -> T: await f()';

describe('proposal 8 behaviour table: kinds', () => {
  it('a written `Future<T>` names neither kind, and is refused', () => {
    expect(codesOf('fn f(x: Future<Int>): ()')).toContain(
      checkerDiagnostics.typeArgumentCount.code,
    );
  });

  it('an unmarked `async fn` and `async fn` type are refused: a future takes a kind', () => {
    expect(codesOf('async fn two(x: Int) -> Int: x * 2')).toEqual([
      checkerDiagnostics.unkindedFuture.code,
    ]);
    expect(codesOf('fn run(f: async fn() -> Int): ()')).toEqual([
      checkerDiagnostics.unkindedFuture.code,
    ]);
    expect(codesOf('type Later = async fn() -> Int')).toEqual([
      checkerDiagnostics.unkindedFuture.code,
    ]);
  });

  it('a function generic over its kind has an entry per kind it is used at', () => {
    const text = compiledEncoded(
      lines(
        twice,
        'live async fn fromLive() -> Int: await twice(1)',
        "import * as runtime from 'runtime'\nlive async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int: await twice(2)",
      ),
    );
    expect(modesOf(text, 'main.twice')).toEqual(['ista', 'live']);
  });

  it('each entry of a function generic over its kind runs as its kind', async () => {
    const live = testRuntime();
    const fromLive = compiledEncoded(lines(twice, 'live async fn main() -> Int: await twice(1)'));
    expect(await startToEnd(live, fromLive)).toEqual({ kind: 'finished', outcome: '2' });
    expect(live.store.commits).toEqual([]);
    const ista = testRuntime();
    const fromIsta = compiledEncoded(
      lines(
        twice,
        "import * as runtime from 'runtime'\nlive async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int: await twice(2)",
      ),
    );
    expect(await startToEnd(ista, fromIsta)).toEqual({ kind: 'finished', outcome: '4' });
    expect(ista.store.commits.length).toBeGreaterThan(0);
  });

  it('a `live async fn` waits in memory and writes nothing to the store across its wait', async () => {
    const test = testRuntime();
    const text = compiledEncoded(
      lines(timeImport, 'live async fn main() -> Int:', '  await time.delay(5ms)', '  7'),
    );
    expect(await startToEnd(test, text)).toEqual({ kind: 'finished', outcome: '7' });
    expect(test.store.commits).toEqual([]);
  });

  it('an ista main commits at its wait, as every main did', async () => {
    const test = testRuntime();
    const text = compiledEncoded(
      lines(
        timeImport,
        "import * as runtime from 'runtime'\nlive async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:",
        '  await time.delay(5ms)',
        '  7',
      ),
    );
    expect(await startToEnd(test, text)).toEqual({ kind: 'finished', outcome: '7' });
    expect(test.store.commits.length).toBeGreaterThan(0);
  });

  it("a header's written `Future<…>` must be of its kind", () => {
    expect(codesOf('live async fn f() -> Future<Int, "ista">: 1')).toEqual([
      checkerDiagnostics.kindsHeld.code,
    ]);
  });

  it("an unmarked requirement is met by an unmarked function, or one of its type's own kind", () => {
    const runner = (type: string, witness: string) =>
      lines(
        socket,
        'trait Runner { fn run(self: Self) -> Int }',
        `${witness} run(self: ${type}) -> Int: 1`,
        'fn via<T is Runner>(x: T) -> Int: x.run()',
      );
    expect(codesOf(lines(runner('Int', 'ista fn'), 'ista fn main() -> Int: via(1)'))).not.toEqual(
      [],
    );
    expect(codesOf(lines(runner('Int', 'fn'), 'ista fn main() -> Int: via(1)'))).toEqual([]);
    expect(
      codesOf(lines(runner('Socket', 'live fn'), 'live fn main(s: Socket) -> Int: via(s)')),
    ).toEqual([]);
  });

  it("`Socket`'s `live fn dispose` meets `Disposable`'s unmarked one", () => {
    const source = lines(
      socket,
      'extern live fn dispose(self: Socket)',
      'live fn weak(s: Socket) -> WeakRef<Socket>: WeakRef(s)',
    );
    expect(codesOf(source)).toEqual([]);
  });

  it('an unmarked function calling a live one is missing its mark', () => {
    const source = lines('live async fn x() -> Int: 1', 'fn y(): _ = x()');
    expect(codesOf(source)).toContain(checkerDiagnostics.unmarkedCalls.code);
  });

  it('a function handling a live handle is live, an extern included', () => {
    expect(codesOf(lines(socket, 'fn f(s: Socket): ()'))).toEqual([
      checkerDiagnostics.unmarkedHolds.code,
    ]);
    // A host's extern is judged at its boundary too (5101): a handle has no JSON form.
    const extern = (head: string) => codesOf(lines(socket, `${head} getSocket() -> Socket`));
    expect(extern('extern fn')).toContain(checkerDiagnostics.unmarkedHolds.code);
    expect(extern('extern live fn')).not.toContain(checkerDiagnostics.unmarkedHolds.code);
  });

  it('a function handles its temporaries too, not only its signature', () => {
    const source = lines(
      socket,
      'extern live fn getSocket() -> Socket',
      'extern live fn close(self: Socket)',
      'fn f(): getSocket().close()',
    );
    expect(codesOf(source)).toContain(checkerDiagnostics.unmarkedHolds.code);
  });

  it('a function value is simple data: ista code gives a live function', () => {
    expect(codesOf('ista fn f1() -> live fn() -> String: live fn(): "hello"')).toEqual([]);
  });

  it("generic code passes its values through: `id(f)` is the code naming `f`'s to judge", () => {
    const id = 'fn id<T>(x: T) -> T: x';
    expect(codesOf(lines(id, 'live fn a(f: Future<Int, "live">): _ = id(f)'))).toEqual([]);
    expect(codesOf(lines(id, 'ista fn b(f: Future<Int, "live">): _ = id(f)'))).toContain(
      checkerDiagnostics.kindsHeld.code,
    );
  });

  it('unmarked generic code releasing a `T` that is a `Socket` checks', () => {
    const source = lines(
      socket,
      'extern live fn dispose(self: Socket)',
      'fn release<T>(x: T): drop x',
      'live fn main(s: Socket): release(s)',
    );
    expect(codesOf(source)).toEqual([]);
  });

  it('a timer is of a kind, so unmarked code makes none', () => {
    expect(codesOf(lines(timeImport, 'fn x(): _ = time.delay(1s)'))).not.toEqual([]);
  });

  it('simple code defers a simple call', () => {
    expect(codesOf(lines('fn log(x: Int): ()', 'fn w(x: Int): _ = defer log(x)'))).toEqual([]);
  });

  it('live code calls nothing ista, and holds no inbox', () => {
    expect(
      codesOf(lines('ista async fn x() -> Int: 1', 'live async fn y() -> Int: await x()')),
    ).toContain(checkerDiagnostics.kindsMeet.code);
    const receiving = lines(
      "import Inbox from 'inbox'",
      'live async fn y(i: Inbox<Int>) -> Int: await i.receive()',
    );
    expect(codesOf(receiving)).toContain(checkerDiagnostics.kindsHeld.code);
  });

  it('ista code calls nothing live, and delegates it instead', async () => {
    const fetching = lines(
      'extern live async fn get(u: String) -> String',
      'ista async fn f() -> String: await get("u")',
    );
    expect(codesOf(fetching)).toContain(checkerDiagnostics.kindsMeet.code);
    const charging = lines(
      'extern live fn charge(id: String) -> Int',
      'ista fn g() -> Int: charge("o/1")',
    );
    expect(codesOf(charging)).toContain(checkerDiagnostics.kindsMeet.code);
    const delegated = compiledEncoded(
      lines(
        "import * as runtime from 'runtime'",
        'extern live async fn get(u: String) -> String',
        'extern live fn charge(id: String) -> Int',
        'ista async fn f() -> String:',
        '  const page = await runtime.delegate get("u")',
        '  `${page} ${await runtime.delegate charge("o/1")}`',
        'live async fn main() -> String: await runtime.run("o/1") f()',
      ),
    );
    const host = {
      'main.get(String)': ([u]: readonly unknown[]) => Promise.resolve(`page ${String(u)}`),
      'main.charge(String)': () => 7n,
    };
    expect(await startToEnd(testRuntime({ externs: host }), delegated)).toEqual({
      kind: 'finished',
      outcome: '"page u 7"',
    });
  });

  it('`time.delay` in live code is a live timer', async () => {
    const test = testRuntime();
    const text = compiledEncoded(
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
    const text = compiledEncoded(
      lines(
        retry,
        'live async fn fetchLive() -> Int: 1',
        'ista async fn fetchIsta() -> Int: 2',
        'live async fn inLive() -> Int: await retry(fetchLive, 3)',
        "import * as runtime from 'runtime'\nlive async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int: await retry(fetchIsta, 3)",
      ),
    );
    expect(modesOf(text, 'main.retry')).toEqual(['ista', 'live']);
  });

  it('`retry` given a live function in ista code is refused, naming the call', () => {
    const source = lines(
      retry,
      'live async fn fetchLive() -> Int: 1',
      "import * as runtime from 'runtime'\nlive async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int: await retry(fetchLive, 3)",
    );
    const { diagnostics } = diagnosedAt(stdProgramOf({ 'main.ista': source }), 'main.ista');
    expect(diagnostics.map(({ code }) => code)).toContain(checkerDiagnostics.kindsMeet.code);
    expect(diagnostics.map(({ message }) => message).join()).toContain("'retry'");
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

  it('a local function is of its written mark: unmarked, it is simple and fits an unmarked field', () => {
    const source = lines(
      'shared struct Box { run: fn() -> Unit }',
      'ista fn make(flag: Shared<Bool>) -> Box:',
      '  fn note(): flag->value = true',
      '  new Box{run: note}',
    );
    expect(codesOf(source)).toEqual([]);
  });

  it('a lambda an unmarked field takes is simple, so it calls and holds nothing ista', () => {
    const source = lines(
      'shared struct Later { run: fn() -> Future<Int, "ista"> }',
      'ista async fn x() -> Int: 1',
      'ista fn make() -> Later: new Later{run: fn(): x()}',
    );
    expect(codesOf(source)).toEqual(
      expect.arrayContaining([
        checkerDiagnostics.unmarkedHolds.code,
        checkerDiagnostics.unmarkedCalls.code,
      ]),
    );
  });

  it('a lambda given no mark infers it from the values its parameters take', () => {
    const source = lines(
      socket,
      'live fn close(self: Socket): ()',
      'fn closer() -> live fn(Socket) -> Unit: fn(s: Socket): s.close()',
    );
    expect(codesOf(source)).toEqual([]);
  });

  it('a plain lambda fits where an ista async function is expected: a resolved future', () => {
    const source = lines(
      'struct Order { id: String }',
      'ista async fn retry(times: Int, call: ista async fn(String) -> Order) -> Order: await call("x")',
      "import * as runtime from 'runtime'\nlive async fn main() -> String: await runtime.run(runtime.id()) _main()\nista async fn _main() -> String: (await retry(3, fn(id): Order{id})).id",
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
