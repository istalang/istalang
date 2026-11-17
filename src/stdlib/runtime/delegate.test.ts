/**
 * `delegate` (spec §5, proposal 8 Rule 8): ista code's job runs as live code after its segment
 * commits, its result in the delegating code's future; a segment discarded runs none, and a job
 * whose result never committed runs again at the store's next open. Letting go of its future
 * withdraws it: queued, it never runs; running, it is cancelled (§7). A job that isn't sendable, or
 * a result without codecs, is refused.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { reported } from '../../compiler/checker/check.test-kit.ts';
import { checkerDiagnostics } from '../../compiler/checker/diagnostics/index.ts';
import {
  compiledEncoded,
  encodedDespiteCycles,
  wholeProgramTimeout,
} from '../../compiler/compile.test-kit.ts';
import { lines } from '../../compiler/parser/parse.test-kit.ts';
import type { EncodedDefinition, KeyedDefinition } from '../../definition/definition.ts';
import type { HostExterns } from '../../runtime/boundary/host-natives.ts';
import { recordingStore, startToEnd, testRuntime } from '../../runtime/runtime.test-kit.ts';
import { memoryStore } from '../../runtime/store.ts';
import { chargeKey, countingHost, header } from './delegate.test-kit.ts';

/** A program whose `main` runs `body`, ista code, in the context "o1". */
function running(...body: string[]): EncodedDefinition {
  return compiledEncoded(
    lines(
      ...header,
      ...body,
      'live async fn main() -> String: await runtime.run("o1") purchase("o1")',
    ),
  );
}

/**
 * One step of a generated purchase: a job awaited at once, one awaited at the end, one whose future
 * is dropped at once, a commit.
 */
type Step = 'awaited' | 'started' | 'dropped' | 'commit';

/** The purchase taking `steps`, its jobs named by their step's position, and what it gives. */
function purchaseOf(steps: readonly Step[]): {
  readonly program: EncodedDefinition;
  readonly gives: string;
} {
  const body = steps.map((step, position) => {
    if (step === 'commit') {
      return '  await runtime.commit()';
    }
    const job = `runtime.delegate charge("j${position}")`;
    const written = {
      awaited: `  got = got + await ${job}`,
      started: `  started.push(${job})`,
      dropped: `  drop ${job}`,
    } satisfies Record<Exclude<Step, 'commit'>, string>;
    return written[step];
  });
  const named = (kind: Step) =>
    steps.flatMap((step, position) => (step === kind ? [`receipt for j${position}`] : []));
  return {
    program: running(
      'ista async fn purchase(id: String) -> String:',
      '  let got = id',
      '  let started: Array<Future<String, "ista">> = []',
      ...body,
      '  for job in started:',
      '    got = got + await job',
      '  got',
    ),
    gives: ['o1', ...named('awaited'), ...named('started')].join(''),
  };
}

const purchase = running(
  'ista async fn purchase(id: String) -> String: (await runtime.delegate charge(id)) + "!"',
);

describe('delegate', () => {
  it('runs the job once after the commit, its result in the future', async () => {
    const { host, calls } = countingHost();
    expect(await startToEnd(testRuntime({ externs: host }), purchase)).toEqual({
      kind: 'finished',
      outcome: '"receipt for o1!"',
    });
    expect(calls).toEqual(new Map([['o1', 1]]));
  });

  it('runs it once when the context crashes at every await', async () => {
    const { host, calls } = countingHost();
    const ended = await startToEnd(testRuntime({ externs: host }), purchase, {
      crashEveryAwait: true,
    });
    expect(ended).toEqual({ kind: 'finished', outcome: '"receipt for o1!"' });
    expect(calls).toEqual(new Map([['o1', 1]]));
  });

  it('runs the jobs of a segment, and of one awaited later, each once', async () => {
    const { host, calls } = countingHost();
    const both = running(
      'ista async fn purchase(id: String) -> String:',
      '  const first = runtime.delegate charge(id)',
      '  const second = await runtime.delegate charge(id + "/2")',
      '  (await first) + second',
    );
    expect(
      await startToEnd(testRuntime({ externs: host }), both, { crashEveryAwait: true }),
    ).toEqual({
      kind: 'finished',
      outcome: '"receipt for o1receipt for o1/2"',
    });
    expect(calls).toEqual(
      new Map([
        ['o1', 1],
        ['o1/2', 1],
      ]),
    );
  });

  it('runs a job again at the next open when its result never committed', async () => {
    const store = memoryStore();
    const { host, charge, calls } = countingHost();
    const failing: HostExterns = {
      [chargeKey]: async (arguments_) => {
        await charge(arguments_);
        throw new Error('the process stops');
      },
    };
    const once = running(
      'ista const started = new Shared{value: false}',
      'ista const receipt = Slot.create<String>()',
      'ista async fn purchase(id: String) -> String:',
      '  if not started->value:',
      '    started->value = true',
      '    drop receipt.put(await runtime.delegate charge(id))',
      '  await receipt.read()',
    );
    const stopped = await startToEnd(
      testRuntime({ externs: failing, store: recordingStore(store) }),
      once,
    );
    expect(stopped).toMatchObject({ kind: 'panicked' });
    expect(calls).toEqual(new Map([['o1', 1]]));

    const resumed = await startToEnd(
      testRuntime({ externs: host, store: recordingStore(store) }),
      once,
    );
    expect(resumed).toEqual({ kind: 'finished', outcome: '"receipt for o1"' });
    expect(calls).toEqual(new Map([['o1', 2]]));
  });

  it('runs every job a committed segment still holds once, and none withdrawn or discarded', {
    timeout: wholeProgramTimeout,
  }, async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom<Step>('awaited', 'started', 'dropped', 'commit'), {
          maxLength: 5,
        }),
        async (steps) => {
          const { host, calls } = countingHost();
          const { program, gives } = purchaseOf(steps);
          const ended = await startToEnd(testRuntime({ externs: host }), program, {
            crashEveryAwait: true,
          });
          expect(ended).toEqual({ kind: 'finished', outcome: JSON.stringify(gives) });
          const jobs = steps.flatMap((step, position) =>
            step === 'awaited' || step === 'started' ? [`j${position}`] : [],
          );
          expect(calls).toEqual(new Map(jobs.map((job) => [job, 1])));
        },
      ),
      // Jobs started, then one awaited: a committed segment then still names calls that ended.
      { numRuns: 15, examples: [[['started', 'started', 'started', 'awaited']]] },
    );
  });

  it('lowers the loop serving jobs only with a program that delegates', () => {
    const served = ({ definition }: KeyedDefinition) => {
      const { purpose, functions } = definition;
      const jobServer = purpose.kind === 'program' ? purpose.jobServer : undefined;
      const named = jobServer === undefined ? undefined : functions[jobServer]?.name;
      return [named, functions.some((entry) => entry.name.startsWith('runtime._nextWork'))];
    };
    expect(served(purchase)).toEqual(['runtime._serve', true]);
    const plain = compiledEncoded(
      lines(
        "import * as runtime from 'runtime'",
        'ista async fn purchase(id: String) -> String: id',
        'live async fn main() -> String: await runtime.run("o1") purchase("o1")',
      ),
    );
    expect(served(plain)).toEqual([undefined, false]);
  });

  it('refuses a job that is not sendable, or a result without codecs', () => {
    const unsendableJob = lines(
      ...header,
      'live fn read(counter: Shared<Int>) -> Int: counter->value',
      'ista async fn purchase(id: String) -> Int:',
      '  await runtime.delegate read(new Shared{value: 0})',
    );
    expect(reported(unsendableJob).codes).toContain(
      checkerDiagnostics.captureBeyondSendability.code,
    );

    const uncoded = lines(
      ...header,
      'live fn adder() -> fn(Int) -> Int: fn(n): n + 1',
      'ista async fn purchase(id: String) -> Int:',
      '  const add = await runtime.delegate adder()',
      '  add(1)',
    );
    expect(reported(uncoded).codes).toContain(checkerDiagnostics.notConforming.code);
  });

  it('never runs a job whose future was dropped or lost a select before its segment committed', async () => {
    const { host, calls } = countingHost();
    const droppedBeforeCommit = running(
      'ista async fn purchase(id: String) -> String:',
      '  drop runtime.delegate charge("dropped")',
      '  const polled = select:',
      '    case runtime.delegate charge("polled"):',
      '      "polled"',
      '    else:',
      '      "else"',
      '  polled + ":" + (await runtime.delegate charge(id))',
    );
    expect(await startToEnd(testRuntime({ externs: host }), droppedBeforeCommit)).toEqual({
      kind: 'finished',
      outcome: '"else:receipt for o1"',
    });
    expect(calls).toEqual(new Map([['o1', 1]]));
  });

  it('cancels a running job when its future loses an await select', async () => {
    const store = memoryStore();
    let cancelled = 0;
    const { host, calls } = countingHost();
    const slowHost: HostExterns = {
      ...host,
      'main.waitCancel(String)': (_arguments, call) => {
        const resolver = call.resolver();
        resolver.onCancel(() => {
          cancelled += 1;
        });
      },
    };
    const raced = compiledEncoded(
      lines(
        ...header,
        "import * as time from 'time'",
        'extern live async fn waitCancel(id: String) -> String',
        'ista async fn purchase(id: String) -> String:',
        '  const first = await select:',
        '    case runtime.delegate waitCancel(id):',
        '      "cancelled"',
        '    case time.delay(10ms):',
        '      "timed-out"',
        '  first + ":" + (await runtime.delegate charge(id))',
        'live async fn main() -> String: await runtime.run("o1") purchase("o1")',
      ),
    );
    expect(
      await startToEnd(testRuntime({ externs: slowHost, store: recordingStore(store) }), raced),
    ).toEqual({
      kind: 'finished',
      outcome: '"timed-out:receipt for o1"',
    });
    expect(cancelled).toBe(1);
    expect(calls).toEqual(new Map([['o1', 1]]));
  });

  it('cancels the jobs a runtime runs when it is disposed', async () => {
    let cancelled = 0;
    const pendingHost: HostExterns = {
      'main.waitCancel(String)': (_arguments, call) => {
        call.resolver().onCancel(() => {
          cancelled += 1;
        });
      },
    };
    // By types, the job table's closures may hold `kept`: what closures capture isn't refined.
    const disposedMidJob = encodedDespiteCycles(
      lines(
        "import * as runtime from 'runtime'",
        "import * as time from 'time'",
        'extern live async fn waitCancel(id: String) -> String',
        'ista const kept = new Shared<Future<String, "ista">?>{value: none}',
        'ista async fn start() -> String:',
        '  kept->value = runtime.delegate waitCancel("o1")',
        '  "started"',
        'ista async fn pause() -> String:',
        '  await time.delay(10ms)',
        '  "paused"',
        'live async fn main() -> String:',
        '  const rt = await runtime.Runtime.open(runtime.hostStore())',
        '  drop await rt.call("o1") start()',
        '  drop await rt.call("o1") pause()',
        '  drop rt',
        '  "disposed"',
      ),
    );
    expect(await startToEnd(testRuntime({ externs: pendingHost }), disposedMidJob)).toEqual({
      kind: 'finished',
      outcome: '"disposed"',
    });
    expect(cancelled).toBe(1);
  });

  it('runs a job delegated after a restart once, past the loop an earlier run left waiting', async () => {
    const store = memoryStore();
    let phase = 1;
    const { host, calls } = countingHost();
    const phasedHost: HostExterns = {
      ...host,
      'main.phase()': () => BigInt(phase),
    };
    // By types, the job table's closures may hold `kept`: what closures capture isn't refined.
    const program = encodedDespiteCycles(
      lines(
        ...header,
        "import * as time from 'time'",
        'extern fn phase() -> Int',
        'ista const kept = new Shared<Future<String, "ista">?>{value: none}',
        'ista async fn start() -> String:',
        '  await time.delay(10ms)',
        '  "started"',
        'ista async fn delegating() -> String:',
        '  kept->value = runtime.delegate charge("after-restart")',
        '  "delegated"',
        'ista async fn waitDone() -> String:',
        '  await time.delay(50ms)',
        '  "done"',
        'live async fn main() -> String:',
        '  if phase() == 1:',
        '    return await runtime.run("o1") start()',
        '  const rt = await runtime.Runtime.open(runtime.hostStore())',
        '  _ = rt.call("o1") delegating()',
        '  match await rt.call("o1") waitDone():',
        '    case Ok(v): v',
        '    case Err(e): e.message',
      ),
    );
    // The first run leaves its loop's take waiting in `o1`, which the second's job may decide.
    expect(
      await startToEnd(testRuntime({ externs: phasedHost, store: recordingStore(store) }), program),
    ).toEqual({
      kind: 'finished',
      outcome: '"started"',
    });

    phase = 2;
    expect(
      await startToEnd(testRuntime({ externs: phasedHost, store: recordingStore(store) }), program),
    ).toEqual({
      kind: 'finished',
      outcome: '"done"',
    });
    expect(calls).toEqual(new Map([['after-restart', 1]]));
  });
});
