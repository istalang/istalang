/**
 * Collecting by counts (§7), over random heaps of leases (cells whose type declares `dispose`) and
 * plain cells holding them, each object holding only older ones, as making an object does: once
 * a register holding every object nothing else holds lets go of them, the leases are disposed in
 * rounds, newest first in each. A lease's round comes after that of every lease holding it, even
 * through plain cells, which are gone as soon as nothing holds them: a lease held through one is
 * disposed in the round after its holder's, and one held by none in the first.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compiledText } from '../../compiler/compile.test-kit.ts';
import { handleTo } from '../../definition/values/values.ts';
import { startToEnd, testRuntime } from '../runtime.test-kit.ts';
import { futuresOn } from '../scheduler/instance/futures.test-kit.ts';
import { testHeap } from '../scheduler/instance/heap.test-kit.ts';
import { handleObject, type LiveObject } from '../scheduler/instance/heap.ts';
import { WeakSide } from '../scheduler/instance/weak-side.ts';
import { type Held, nothingHeld } from '../snapshot/holdings.ts';
import { Collector } from './collector.ts';
import { type DisposalContext, heapCollected } from './disposal.ts';
import { countedIn, HolderWrites } from './holder-writes.ts';
import { counterType, leaseType, testTypes } from './lifetimes.test-kit.ts';

/** Each object a cell: a lease or a plain one, holding some of the objects made before it. */
interface Made {
  readonly lease: boolean;
  readonly holds: readonly number[];
}

/** What `made[id]` holds: objects made before it. */
const holdsOf = (made: readonly Made[], id: number): readonly number[] =>
  (made[id]?.holds ?? []).filter((each) => each < id);

/** The objects of `made` nothing else holds. */
const unheldIn = (made: readonly Made[]): readonly number[] =>
  made.flatMap((_, id) =>
    made.some((__, holder) => holdsOf(made, holder).includes(id)) ? [] : [id],
  );

/** The leases, in the order collecting disposes them once nothing holds the objects `made`. */
function disposalOrder(made: readonly Made[]): readonly number[] {
  const objects = made.map(
    ({ lease }, id): LiveObject => ({
      kind: 'cell',
      id,
      type: lease ? leaseType : counterType,
      value: { kind: 'array', elements: holdsOf(made, id).map(handleTo) },
    }),
  );
  const holders = new HolderWrites(countedIn(testTypes));
  const heap = testHeap(objects, holders);
  const disposed: number[] = [];
  const context: DisposalContext = {
    heap,
    types: testTypes,
    stop: () => undefined,
    cleanupCase: () => undefined,
    weak: new WeakSide(heap, futuresOn(heap)),
    disposed: () => undefined,
    cancel: () => undefined,
  };
  const collector = new Collector(
    heapCollected(context, {
      takeZeroes: () => holders.takeZeroes(),
      run: (run) => {
        if (run.kind === 'call' && run.arguments[0] !== undefined) {
          disposed.push(handleObject(run.arguments[0]));
        }
        return true;
      },
    }),
  );
  const register: Held = { values: unheldIn(made).map(handleTo), holds: [] };
  holders.changed(nothingHeld, register);
  holders.takeZeroes();
  holders.changed(register, nothingHeld);
  collector.collect();
  return disposed;
}

/** The leases of `made` by round, newest first in each: a lease's after every lease holding it. */
function expectedOrder(made: readonly Made[]): readonly number[] {
  const rounds = new Map<number, number>();
  /** The leases holding `id`, directly or through plain cells. */
  const leasesHolding = (id: number): readonly number[] =>
    made
      .flatMap((holder, at) => (holdsOf(made, at).includes(id) ? [{ holder, at }] : []))
      .flatMap(({ holder, at }) => (holder.lease ? [at] : leasesHolding(at)));
  const roundOf = (lease: number): number => {
    const known = rounds.get(lease);
    if (known !== undefined) {
      return known;
    }
    const round = Math.max(-1, ...leasesHolding(lease).map(roundOf)) + 1;
    rounds.set(lease, round);
    return round;
  };
  const leases = made.flatMap(({ lease }, id) => (lease ? [id] : []));
  return leases.toSorted((first, second) => roundOf(first) - roundOf(second) || second - first);
}

describe('collecting by counts', () => {
  it('disposes leases by rounds, after every lease holding them, newest first in each', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            lease: fc.boolean(),
            holds: fc.uniqueArray(fc.nat({ max: 7 }), { maxLength: 3 }),
          }),
          { minLength: 1, maxLength: 8 },
        ),
        (made) => {
          expect(disposalOrder(made)).toEqual(expectedOrder(made));
        },
      ),
    );
  });

  it('disposes a lease held only through a plain cell at once, and one a lease holds after it', () => {
    const made: readonly Made[] = [
      { lease: true, holds: [] },
      { lease: true, holds: [0] },
      { lease: true, holds: [] },
      { lease: false, holds: [2] },
      { lease: true, holds: [] },
    ];
    expect(disposalOrder(made)).toEqual([4, 2, 1, 0]);
  });

  it.each([false, true])(
    'finishes the current round before disposing what a code disposal in that round held (crashing at every await: %s)',
    async (crashEveryAwait) => {
      const text = compiledText(
        [
          "import * as runtime from 'runtime'",
          'shared struct Lease:',
          '  name: String',
          '  log: Shared<Array<String>>',
          '  child: Lease? = none',
          'fn dispose(self: Lease):',
          '  self->log->value.push("disposed " + self->name)',
          'live async fn main() -> String: await runtime.run(runtime.id()) _main()',
          'ista async fn _main() -> String:',
          '  const log = new Shared<Array<String>>{value: []}',
          '  if true:',
          '    const l0 = new Lease{name: "0", log}',
          '    const l1 = new Lease{name: "1", log}',
          '    const l2 = new Lease{name: "2", log, child: l0}',
          '    drop l0',
          '  await runtime.commit()',
          '  log->value.join(", ")',
        ].join('\n'),
      );
      expect(await startToEnd(testRuntime(), text, { crashEveryAwait })).toEqual({
        kind: 'finished',
        outcome: '"disposed 2, disposed 1, disposed 0"',
      });
    },
  );

  it.each(['', '    const w = WeakRef(s)', '    _ = WeakRef(s)'])(
    'disposes what a slot holds in the slot’s round, whatever weak reference refers to it (%j)',
    async (weak) => {
      const text = compiledText(
        [
          "import * as runtime from 'runtime'",
          'shared struct Lease:',
          '  name: String',
          '  log: Shared<Array<String>>',
          'fn dispose(self: Lease):',
          '  self->log->value.push("disposed " + self->name)',
          'live async fn main() -> String: await runtime.run(runtime.id()) _main()',
          'ista async fn _main() -> String:',
          '  const log = new Shared<Array<String>>{value: []}',
          '  if true:',
          '    const first = new Lease{name: "first", log}',
          '    const s = Slot.create<Lease>()',
          '    drop s.put(new Lease{name: "inside", log})',
          weak,
          '    await runtime.commit()',
          '  log->value.join(", ")',
        ].join('\n'),
      );
      expect(await startToEnd(testRuntime(), text)).toEqual({
        kind: 'finished',
        outcome: '"disposed inside, disposed first"',
      });
    },
  );

  it('does not preempt a running dispose mid-function with a disposable released by an earlier synchronous disposal in the same round', async () => {
    const text = compiledText(
      [
        "import * as time from 'time'",
        "import * as runtime from 'runtime'",
        'shared struct Lease:',
        '  name: String',
        '  log: Shared<Array<String>>',
        'fn dispose(self: Lease):',
        '  self->log->value.push("start " + self->name)',
        '  self->log->value.push("end " + self->name)',
        'ista async fn holder(l: Lease):',
        '  await time.delay(1h)',
        '  _ = l',
        'live async fn main() -> String: await runtime.run(runtime.id()) _main()',
        'ista async fn _main() -> String:',
        '  const log = new Shared<Array<String>>{value: []}',
        '  if true:',
        '    const l0 = new Lease{name: "0", log}',
        '    const l1 = new Lease{name: "1", log}',
        '    const h = holder(l0)',
        '    drop l0',
        '  log->value.join(", ")',
      ].join('\n'),
    );
    expect(await startToEnd(testRuntime(), text)).toEqual({
      kind: 'finished',
      outcome: '"start 1, end 1, start 0, end 0"',
    });
  });

  it("disposes a dispose body's own locals and defers before removing the disposed value or releasing what it holds", async () => {
    const text = compiledText(
      [
        "import * as runtime from 'runtime'",
        'shared struct Lease:',
        '  name: String',
        '  log: Shared<Array<String>>',
        'fn dispose(self: Lease):',
        '  self->log->value.push("disposed " + self->name)',
        'shared struct Outer:',
        '  log: Shared<Array<String>>',
        '  box: Shared<Lease?>',
        '  child: Lease? = none',
        'fn dispose(self: Outer) -> Unit:',
        '  const log = self->log',
        '  const taken = self->box->value',
        '  self->box->value = none',
        '  _ = taken',
        '  log->value.push("outer body")',
        'live async fn main() -> String: await runtime.run(runtime.id()) _main()',
        'ista async fn _main() -> String:',
        '  const log = new Shared<Array<String>>{value: []}',
        '  if true:',
        '    const box = new Shared<Lease?>{value: new Lease{name: "local", log}}',
        '    const outer = new Outer{log, box}',
        '    const child = new Lease{name: "child", log}',
        '    outer->child = child',
        '    drop child',
        '  log->value.join(", ")',
      ].join('\n'),
    );
    expect(await startToEnd(testRuntime(), text)).toEqual({
      kind: 'finished',
      outcome: '"outer body, disposed local, disposed child"',
    });
  });

  it("returns none from WeakRef.deref() once the referent's last holder has released it, preventing resurrection during a round", async () => {
    const text = compiledText(
      [
        "import * as runtime from 'runtime'",
        'shared struct Lease:',
        '  name: String',
        'fn dispose(self: Lease): ()',
        'shared struct Grabber:',
        '  w: WeakRef<Lease>',
        '  box: Shared<Lease?>',
        'fn dispose(self: Grabber):',
        '  self->box->value = self->w.deref()',
        'live async fn main() -> String: await runtime.run(runtime.id()) _main()',
        'ista async fn _main() -> String:',
        '  const box = new Shared<Lease?>{value: none}',
        '  if true:',
        '    const y = new Lease{name: "y"}',
        '    const g = new Grabber{w: WeakRef(y), box}',
        '  await runtime.commit()',
        '  match box->value:',
        '    case None: "none"',
        '    case l: l->name',
      ].join('\n'),
    );
    expect(await startToEnd(testRuntime(), text)).toEqual({
      kind: 'finished',
      outcome: '"none"',
    });
  });
});
