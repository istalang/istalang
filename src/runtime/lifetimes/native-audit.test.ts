/**
 * The native audit (native-audit.test-kit.ts) sees each edge a native adds to what an argument
 * holds, and covers it by what its extern keeps: the std's `@Keeps`, or the `&` default. One the
 * table no longer names is reported, so a `@Keeps` left out of the std fails the sweeps that run it.
 */

import { describe, expect, it } from 'vitest';
import { compiledText } from '../../compiler/compile.test-kit.ts';
import { stdNativeKeeps } from '../../stdlib/std-externs.test-kit.ts';
import { startToEnd, testRuntime } from '../runtime.test-kit.ts';
import { type NativeKeeps, nativeAudit, withNativeAudit } from './native-audit.test-kit.ts';

const keeps = stdNativeKeeps();

/** The key of the prelude's extern `name`, of which it declares one. */
function preludeKey(name: string): string {
  const [key, ...others] = [...keeps.keys()].filter((each) => each.startsWith(`prelude.${name}(`));
  if (key === undefined || others.length > 0) {
    throw new Error(`The prelude declares no one extern ${name}.`);
  }
  return key;
}

/** How running `body` ended, and what the audit reported, auditing against `table`. */
async function uncoveredRunning(body: readonly string[], table: NativeKeeps) {
  const audit = nativeAudit(table);
  const text = compiledText(
    [
      "import * as runtime from 'runtime'",
      'shared struct Plain:',
      '  next: Plain? = none',
      'ista async fn later() -> Int:',
      '  await runtime.commit()',
      '  0',
      'live async fn main() -> Int: await runtime.run(runtime.id()) _main()',
      'ista async fn _main() -> Int:',
      ...body.map((line) => `  ${line}`),
      '  await runtime.commit()',
      '  0',
    ].join('\n'),
  );
  const heapCheck = withNativeAudit(audit);
  const ended = await startToEnd(testRuntime({ heapCheck }), text);
  return { ended, uncovered: audit.uncovered() };
}

const finished = { kind: 'finished', outcome: '0' };

/** `keeps` without what `name`'s parameters keep. */
const without = (name: string): NativeKeeps => new Map([...keeps, [preludeKey(name), []]]);

const cases = [
  [
    'put keeps its value in its slot',
    'put',
    ['const slot = Slot.create<Plain>()', 'drop slot.put(new Plain{})'],
  ],
  [
    'onAwait keeps a callback resolver in its future',
    'onAwait',
    [
      'const pending = later()',
      'pending.onAwait(Resolver.of(fn(_value: Int): ()))',
      '_ = await pending',
    ],
  ],
  [
    'push keeps its value through `&`',
    'push',
    ['let plains: Array<Plain> = []', 'plains.push(new Plain{})', '_ = plains'],
  ],
] as const;

describe('the native audit', () => {
  it.each(cases)('covers what %s', async (_name, _extern, body) => {
    expect(await uncoveredRunning(body, keeps)).toEqual({ ended: finished, uncovered: [] });
  });

  it.each(cases)('reports it once the table leaves it out: %s', async (_name, extern, body) => {
    expect(await uncoveredRunning(body, without(extern))).toEqual({
      ended: finished,
      uncovered: [expect.stringContaining(preludeKey(extern))],
    });
  });
});
