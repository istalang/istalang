/**
 * Values shared across instances are never written in place (docs/work/static-lifetimes/design.md
 * §9.6): a Definition's constants, which every instance shares, and the values of one snapshot,
 * which every instance restored from it shares. Both are frozen here, so a write in place into
 * either throws, and two instances restored from one snapshot must each end as the instance that
 * committed it does.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compiledText } from '../../compiler/compile.test-kit.ts';
import { definitionFormat } from '../../definition/definition.ts';
import { stdNatives } from '../../stdlib/natives.ts';
import { seedBytes } from '../random-draws.ts';
import { loadDefinition } from '../scheduler/loaded-definition.ts';
import { Resident } from '../scheduler/resident.ts';
import { advance, unstarted } from '../scheduler/wake.ts';
import { seedTextOf } from '../snapshot/random.ts';
import { memoryStore } from '../store.ts';
import { freezeValuesIn } from './in-place.test-kit.ts';

/** A statement changing the program's variables. */
const change = fc.constantFrom(
  'xs.push(4)',
  'xs[0] = 9',
  'xs.pop()',
  'xs.reverse()',
  'xs[0..1] = [5, 6]',
  'm[1] = 11',
  'm[3] = 30',
  'm.delete(2)',
  'box.items.push(8)',
  'box.n = box.n + 1',
  'ys = xs',
  'ys.push(7)',
);

const changes = fc.array(change, { maxLength: 6 });

/**
 * A program that builds its variables, makes `before`, awaits, then makes `after`, giving a digest
 * of them: what it changed in place before its commit is restored as the commit keeps it.
 */
function program(before: readonly string[], after: readonly string[]): string {
  return compiledText(`
import * as runtime from 'runtime'
import * as time from 'time'

struct Box:
  items: Array<Int>
  n: Int

live async fn main() -> Int: await runtime.run(runtime.id()) _main()
ista async fn _main() -> Int:
  let xs: Array<Int> = [1, 2, 3]
  let ys: Array<Int> = [0]
  let m: Map<Int, Int> = [1: 10, 2: 20]
  let box = Box{items: [7], n: 1}
  xs = xs
  ys = ys
  m = m
  box = box
${before.map((each) => `  ${each}`).join('\n')}
  await time.delay(10ms)
${after.map((each) => `  ${each}`).join('\n')}
  let digest = 0
  for x in [...xs, -1, ...ys, -1, ...box.items, -1, box.n]:
    digest = (digest * 31 + x) % 1000003
  for k, v in m:
    digest = (digest * 31 + k * 7 + v) % 1000003
  digest
`);
}

/** How a run of `text` ends: once straight through, and twice restored from its commit. */
function endings(text: string): readonly unknown[] {
  const definition = definitionFormat.read(text);
  freezeValuesIn(definition.constants);
  const loaded = loadDefinition(definition, '0'.repeat(64), stdNatives);
  const called = definition.functions.findIndex(
    (entry) => entry.kind === 'code' && entry.name === 'main._main',
  );
  const call = { function: called, captures: [], arguments: [] };
  const beginning = { seed: seedTextOf(new Uint8Array(seedBytes)) };
  const resident = new Resident(loaded, unstarted(loaded, 'test', call, beginning));
  advance({ store: memoryStore(), now: () => 0n }, resident);
  const { committed } = resident;
  freezeValuesIn(committed);
  const later = { store: memoryStore(), now: () => 100n };
  return [
    advance(later, resident).state,
    advance(later, new Resident(loaded, committed)).state,
    advance(later, new Resident(loaded, committed)).state,
  ];
}

describe('values shared across instances', () => {
  it('are never written, so every instance restored from one snapshot ends alike', () => {
    fc.assert(
      fc.property(changes, changes, (before, after) => {
        const [straight, ...restored] = endings(program(before, after));
        expect(straight).toMatchObject({ kind: 'finished' });
        for (const each of restored) {
          expect(each).toEqual(straight);
        }
      }),
      { numRuns: 30 },
    );
  }, 60_000);
});
