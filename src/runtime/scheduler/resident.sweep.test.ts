/**
 * A resident instance runs as one restored from the store at every step would (§5). The run to
 * compare with is `crashEveryAwait`'s (§10): each of its segments runs first on the resident
 * instance, then again on one restored from the last commit, which panics the instance unless
 * both runs agree, and only the restored run commits. Over the run corpus and generated programs,
 * both runs end the same and commit the same snapshots, but for the option itself.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { runPrograms } from '../../../test/corpus/programs.ts';
import { compiledText } from '../../compiler/compile.test-kit.ts';
import { memo } from '../../foundation/structures/memo.ts';
import type { StartOptions } from '../instance-state.ts';
import { acyclicOracle, type Oracle, oracleFor } from '../lifetimes/oracle.test-kit.ts';
import { type RecordingStore, startToEnd, testRuntime } from '../runtime.test-kit.ts';
import { snapshotFormat } from '../snapshot/snapshot.ts';

const callToken = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/**
 * What `store` committed, each snapshot without the `crashEveryAwait` option, and each call into a
 * context named by the order its token, random per process, first appears in.
 */
function commitsOf(store: RecordingStore): readonly unknown[] {
  const ordinals = new Map<string, string>();
  const renamed = (value: unknown): unknown => {
    if (typeof value === 'string' && callToken.test(value)) {
      return memo(ordinals, value, () => `call ${ordinals.size}`);
    }
    if (Array.isArray(value)) {
      return value.map(renamed);
    }
    return typeof value === 'object' && value !== null
      ? Object.fromEntries(Object.entries(value).map(([key, each]) => [key, renamed(each)]))
      : value;
  };
  return store.commits.map((text) => {
    const { crashEveryAwait: _, ...rest } = snapshotFormat.read(text);
    return renamed(rest);
  });
}

/** How a run of the Definition `text`, its heaps checked by `oracle`, ended, and what it committed. */
async function runOf(text: string, oracle: Oracle, options: StartOptions = {}) {
  const test = testRuntime({ heapCheck: oracle.heapCheck });
  const ended = await startToEnd(test, text, options);
  return { ended, commits: commitsOf(test.store) };
}

/** Runs of `text` resident and restored at every segment, for comparing. */
async function bothRuns(text: string, oracle: Oracle) {
  return {
    resident: await runOf(text, oracle),
    restored: await runOf(text, oracle, { crashEveryAwait: true }),
  };
}

/** Statements `main` may run, each given a name of its own and a small number. */
const statements: readonly ((name: string, n: number) => readonly string[])[] = [
  (_, n) => [`await time.delay(${n}ms)`],
  () => ['await runtime.commit()'],
  () => ['total = total + await step(total)'],
  (name, n) => [`const ${name} = step(${n})`, `await time.delay(${n}ms)`, `total += await ${name}`],
  (name, n) => [
    `const ${name} = time.delay(${n}ms)`,
    `await time.delay(${n + 3}ms)`,
    `await ${name}`,
  ],
  (name) => [
    `const ${name} = spawn half(total)`,
    `match await ${name}.result():`,
    '  case Ok(value): total += value',
    '  case Err(error): total = 0',
  ],
  (name, n) => [
    `const ${name} = Slot.create<Int>()`,
    `await ${name}.put(${n})`,
    `const ${name}Picked = await select:`,
    `  case ${name}.read() as got:`,
    '    got',
    '  case time.delay(1ms):',
    '    0',
    `total += ${name}Picked`,
  ],
];

/** A program whose `main` runs `chosen` statements in order. */
function programOf(chosen: readonly (readonly [number, number])[]): string {
  const body = chosen.flatMap(([statement, n], position) =>
    (statements[statement]?.(`s${position}`, n) ?? []).map((line) => `  ${line}`),
  );
  return [
    "import * as time from 'time'",
    "import * as runtime from 'runtime'",
    'ista async fn step(n: Int) -> Int:',
    '  await time.delay(3ms)',
    '  n + 1',
    'ista async fn half(n: Int) -> Int:',
    '  await time.delay(2ms)',
    '  n // 2',
    'live async fn main() -> Int: await runtime.run(runtime.id()) _main()',
    'ista async fn _main() -> Int:',
    '  let total = 1',
    ...body,
    '  total',
  ].join('\n');
}

describe('a resident instance', () => {
  it.each(runPrograms)('runs $name as one restored at every segment', async ({ name, text }) => {
    const oracle = oracleFor(name);
    const { resident, restored } = await bothRuns(compiledText(text), oracle);
    expect(restored).toEqual(resident);
    expect(oracle.asExpected()).toBe(true);
  });

  it('runs generated programs as one restored at every segment', async () => {
    const chosen = fc.array(
      fc.tuple(fc.nat(statements.length - 1), fc.integer({ min: 1, max: 9 })),
      {
        minLength: 1,
        maxLength: 6,
      },
    );
    await fc.assert(
      fc.asyncProperty(chosen, async (program) => {
        const { resident, restored } = await bothRuns(
          compiledText(programOf(program)),
          acyclicOracle,
        );
        expect(restored).toEqual(resident);
      }),
      { numRuns: 40 },
    );
  });
});
