/**
 * A start of a program (program.ts): every instance it makes draws from a source of its own
 * (§3.8 `random`), though the host gives one seed.
 */

import { describe, expect, it } from 'vitest';
import { compiledEncoded } from '../compiler/compile.test-kit.ts';
import { lines } from '../compiler/parser/parse.test-kit.ts';
import { stdNatives } from '../stdlib/natives.ts';
import { ManualClock } from './clock.ts';
import { startLive } from './program.ts';
import { testRuntime, testSeed } from './runtime.test-kit.ts';

describe('a start', () => {
  it('has its live run and each context it calls draw randoms of their own, from one seed', async () => {
    const program = compiledEncoded(
      lines(
        "import * as random from 'random'",
        "import * as runtime from 'runtime'",
        'ista fn drawn() -> String: random.uuid()',
        'live async fn main() -> Array<String>:',
        '  const own = random.uuid()',
        '  const a = await runtime.run("a") drawn()',
        '  const b = await runtime.run("b") drawn()',
        '  [own, a, b]',
      ),
    );
    const binding = { natives: stdNatives, clock: new ManualClock(), seed: testSeed };
    const { end } = await startLive(program, binding);
    expect(end.kind).toBe('finished');
    const drawn = end.kind === 'finished' ? (end.outcome as string[]) : [];
    expect(new Set(drawn).size).toBe(3);
  });

  it('has its live run and the context named after it, as the usual `main` runs, draw apart (§9)', async () => {
    const program = compiledEncoded(
      lines(
        "import * as random from 'random'",
        "import * as runtime from 'runtime'",
        'ista fn drawn() -> String: random.uuid()',
        'live async fn main() -> Array<String>:',
        '  [random.uuid(), await runtime.run(runtime.id()) drawn()]',
      ),
    );
    const binding = { natives: stdNatives, clock: new ManualClock(), seed: testSeed };
    const { end } = await startLive(program, binding);
    const drawn = end.kind === 'finished' ? (end.outcome as string[]) : [];
    expect(new Set(drawn).size).toBe(2);
  });

  it('draws apart from an earlier start under the same name, on one host', async () => {
    const program = compiledEncoded(
      lines("import * as random from 'random'", 'live async fn main() -> String: random.uuid()'),
    );
    const test = testRuntime();
    const deployed = test.runtime.deploy(program);
    const outcomes: string[] = [];
    for (const _ of [1, 2]) {
      // biome-ignore lint/performance/noAwaitInLoops: one start after the other, under one name.
      const { state } = await deployed.start('run');
      outcomes.push(state.kind === 'finished' ? deployed.outcomeText(state) : state.kind);
    }
    expect(new Set(outcomes).size).toBe(2);
  });
});
