/**
 * The loop serving delegated jobs (spec §5, proposal 8 Rule 8) serves an instance again once a
 * retry runs it after a panic, which ended the loop serving it, and serves what that retry spawns.
 */

import { describe, expect, it } from 'vitest';
import { compiledEncoded } from '../../compiler/compile.test-kit.ts';
import { lines } from '../../compiler/parser/parse.test-kit.ts';
import { startToEnd, testRuntime } from '../../runtime/runtime.test-kit.ts';
import { countingHost, header } from './delegate.test-kit.ts';

describe('the loop serving jobs', () => {
  it('serves a context retried after it panicked, and what its retry spawns', async () => {
    const { host, calls } = countingHost();
    let ready = false;
    const test = testRuntime({
      host: {
        ...host,
        'main.ready()': () => ready,
        'main.retried()': async () => {
          ready = true;
          await test.runtime.retry('o/1');
          return null;
        },
      },
    });
    const program = compiledEncoded(
      lines(
        ...header,
        "import * as time from 'time'",
        'extern fn ready() -> Bool',
        'extern live async fn retried()',
        'ista const done = Slot.create<String>()',
        'ista async fn charging() -> String: await runtime.delegate charge("child")',
        'ista async fn work() -> String:',
        '  if not ready():',
        '    panic("not ready")',
        '  const child = spawn charging()',
        '  const own = await runtime.delegate charge("o/1")',
        '  match await child.result():',
        '    case Ok(theirs): drop done.put(own + ", " + theirs)',
        '    case Err(error): drop done.put(error.message)',
        '  "worked"',
        'ista async fn worked() -> String: await done.read()',
        'live async fn main() -> String:',
        '  const rt = await runtime.Runtime.open(runtime.hostStore())',
        '  drop await rt.call("o/1") work()',
        '  await time.delay(10ms)',
        '  await retried()',
        '  match await rt.call("o/1") worked():',
        '    case Ok(v): v',
        '    case Err(e): e.message',
      ),
    );
    expect(await startToEnd(test, program)).toEqual({
      kind: 'finished',
      outcome: '"receipt for o/1, receipt for child"',
    });
    expect(calls).toEqual(
      new Map([
        ['o/1', 1],
        ['child', 1],
      ]),
    );
  });
});
