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
import { testSeed } from './runtime.test-kit.ts';

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
});
