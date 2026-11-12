/**
 * Context constants (spec §3.4): one value per context, made the first time code in it reads one,
 * inside the reading segment, and kept in its memory from then on, across its invocations and
 * commits; a segment that is discarded made none. Each context has its own, and an instance that
 * ends lets go of them, disposing what they held.
 */

import { describe, expect, it } from 'vitest';
import { compiledText } from '../../../compiler/compile.test-kit.ts';
import { startToEnd, testRuntime } from '../../runtime.test-kit.ts';

const shared = [
  "import * as runtime from 'runtime'",
  'shared struct Count:',
  '  value: Int',
  'ista const made = new Count{value: 0}',
  'ista const count = _counted()',
  'ista fn _counted() -> Count:',
  '  made->value = made->value + 1',
  '  new Count{value: 0}',
  'ista fn bump() -> Int:',
  '  count->value = count->value + 10',
  '  count->value',
];

/** `main`, given every line of `lines`, run to its end, crashing at every await or not. */
function ended(lines: readonly string[], crashEveryAwait = false) {
  return startToEnd(testRuntime(), compiledText([...shared, ...lines].join('\n')), {
    crashEveryAwait,
  });
}

describe('a context constant', () => {
  it.each([false, true])(
    'is made once per context, at its first read, and kept across commits (crashing at every await: %s)',
    async (crashEveryAwait) => {
      const main = [
        'live async fn main() -> (Int, Int, Int):',
        '  const first = await runtime.run("a") _twice()',
        '  const again = await runtime.run("a") bump()',
        '  const other = await runtime.run("b") bump()',
        '  (first, again, other)',
        'ista async fn _twice() -> Int:',
        '  _ = bump()',
        '  await runtime.commit()',
        '  bump() * 100 + made->value',
      ];
      expect(await ended(main, crashEveryAwait)).toEqual({
        kind: 'finished',
        outcome: '[2001,30,10]',
      });
    },
  );

  it('is disposed with what it holds once its instance ends', async () => {
    const text = compiledText(
      [
        ...shared,
        'extern shared struct Lease',
        'extern fn makeLease() -> Lease',
        'extern fn dispose(self: Lease)',
        'ista const lease = makeLease()',
        'live async fn main() -> Int:',
        '  _ = await runtime.run("a") _spawnReading()',
        '  await runtime.run("a") _readLater()',
        'ista fn _spawnReading() -> Instance<Int>: spawn _reads()',
        'ista async fn _reads() -> Int:',
        '  _ = lease',
        '  0',
        'ista async fn _readLater() -> Int:',
        '  await runtime.commit()',
        '  0',
      ].join('\n'),
    );
    let disposed = 0;
    const test = testRuntime({
      host: {
        'main.makeLease()': () => 'lease',
        'main.dispose(main.Lease)': () => {
          disposed += 1;
          return null;
        },
      },
    });
    expect(await startToEnd(test, text)).toMatchObject({ kind: 'finished' });
    expect(disposed).toBe(1);
  });

  it('read once in its own initializer, panics as the initializer outside makes it again', async () => {
    const main = [
      'shared struct Flag:',
      '  first: Bool',
      'ista const flag = new Flag{first: true}',
      'ista const sneaky: Int = if flag->first: { flag->first = false; sneaky + 1 } else: 10',
      'live async fn main() -> Int: await runtime.run("a") _read()',
      'ista fn _read() -> Int: sneaky',
    ];
    expect(await ended(main)).toMatchObject({
      kind: 'panicked',
      message: "The context constant 'main.sneaky' is read while it is being made.",
    });
  });

  it('read in its own initializer, calls itself until the frame limit panics', async () => {
    const main = [
      'ista const looped: Int = looped + 1',
      'live async fn main() -> Int: await runtime.run("a") _read()',
      'ista fn _read() -> Int: looped',
    ];
    expect(await ended(main)).toMatchObject({ kind: 'panicked' });
  });

  it('is made once though a temporary of its initializer reads it as it is let go', async () => {
    const main = [
      'shared struct Box:',
      '  x: Int',
      'ista fn dispose(self: Box): made->value = made->value + c',
      'ista const c: Int = (new Box{x: 7})->x',
      'live async fn main() -> Int: await runtime.run("a") _read()',
      'ista fn _read() -> Int: c * 100 + made->value',
    ];
    expect(await ended(main)).toEqual({ kind: 'finished', outcome: '707' });
  });

  it.each([
    ['made', 'client', ['finish 5', 'client 5'], 0],
    ['client', 'made', ['finish 5'], -1],
  ])(
    'is read by what its instance disposes as it ends, the last made let go of first (%s read first)',
    async (first, second, recorded, outcome) => {
      const records: string[] = [];
      const test = testRuntime({
        host: {
          'main.record(String)': ([recordText]) => {
            records.push(String(recordText));
            return null;
          },
        },
      });
      const text = compiledText(
        [
          ...shared,
          'extern fn record(text: String)',
          'shared struct Client:',
          '  name: String',
          'ista fn dispose(self: Client): record(`${self->name} ${made->value}`)',
          'ista const client = new Client{name: "client"}',
          'ista fn _finish():',
          '  record(`finish ${made->value}`)',
          'ista async fn _reads() -> Int:',
          '  hold _ = defer _finish()',
          `  _ = ${first}`,
          `  _ = ${second}`,
          '  made->value = 5',
          '  0',
          'live async fn main() -> Int:',
          '  const child = await runtime.run("a") _spawned()',
          '  await runtime.run("a") _awaited(child)',
          'ista fn _spawned() -> Instance<Int>: spawn _reads()',
          'ista async fn _awaited(child: Instance<Int>) -> Int:',
          '  match await child.result():',
          '    case Ok(value): value',
          '    case Err(_): -1',
        ].join('\n'),
      );
      expect(await startToEnd(test, text)).toEqual({ kind: 'finished', outcome: `${outcome}` });
      expect(records).toEqual(recorded);
    },
  );

  // B83: an ending instance stops every execution before releasing its constants.
  it.fails('runs the disposing() cleanup of a call a context constant holds when its instance ends, in last-made-first order (§3.4, §7)', async () => {
    const records: string[] = [];
    const test = testRuntime({
      host: {
        'main.record(String)': ([recordText]) => {
          records.push(String(recordText));
          return null;
        },
      },
    });
    const text = compiledText(
      [
        "import * as time from 'time'\nimport * as runtime from 'runtime'",
        'extern fn record(text: String)',
        'shared struct Lease { name: String }',
        'fn dispose(self: Lease): record("disposed " + self->name)',
        'ista const holder = new Shared<Future<Unit, "ista">?>{value: none}',
        'ista const laterLease = new Lease{name: "later"}',
        'ista async fn worker():',
        '  _ = defer(fn(): record("worker defer"))',
        '  await select:',
        '    case time.delay(1h):',
        '      ()',
        '    case worker.disposing():',
        '      record("worker cleanup")',
        'ista async fn _reads() -> Int:',
        '  holder->value = worker()',
        '  _ = laterLease',
        '  await runtime.commit()',
        '  0',
        'live async fn main() -> Int:',
        '  const child = await runtime.run("a") _spawned()',
        '  await runtime.run("a") _awaited(child)',
        'ista fn _spawned() -> Instance<Int>: spawn _reads()',
        'ista async fn _awaited(child: Instance<Int>) -> Int:',
        '  match await child.result():',
        '    case Ok(value): value',
        '    case Err(_): -1',
      ].join('\n'),
    );
    expect(await startToEnd(test, text)).toEqual({ kind: 'finished', outcome: '0' });
    expect(records).toEqual(['disposed later', 'worker cleanup', 'worker defer']);
  });
});
