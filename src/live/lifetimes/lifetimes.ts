/**
 * Holders and disposal in a run of compiled code (spec §7; docs/work/js-codegen/design.md,
 * "Lifetimes and disposal"), on the interpreter's counts and collector (runtime/lifetimes/), so both
 * runtimes count and order disposals alike.
 *
 * - **Counted objects** (holdings.ts `Counted`) are made here, and found by identity while they
 *   may be disposed: until they are gone.
 * - **Registers and cells report their writes at once** (`swap`, `hold`, `release`): compiled
 *   code's counted registers (definition/tables/functions.ts `counted`) and a counted cell's value,
 *   the hot path.
 * - **The runtime's own objects report what their state makes them hold** (holdings.ts): an
 *   operation changing one `touch`es it, and what it and the objects reading it hold is reconciled
 *   with what was last reported before anything reads the counts.
 * - **Collecting:** compiled code checks `due` after each instruction that may have let go of
 *   something, and collects then. A disposal's code runs at once, inside its round, its own
 *   instructions collecting rounds of their own on top (collector.ts).
 */

import {
  type CompositeValue,
  childValues,
  isComposite,
  type Value,
} from '../../definition/values/values.ts';
import { pushAll } from '../../foundation/structures/stack.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';
import { Collector } from '../../runtime/lifetimes/collector.ts';
import { Counts } from '../../runtime/lifetimes/counts.ts';
import type { Cell } from '../values/cell.ts';
import type { Counted, Held } from './holdings.ts';

const nothing: Held = { values: [], holds: [] };

/** What lifetimes reach of the run: what objects hold, and how each kind is disposed. */
export interface LifetimeSeams<Run> {
  /** What `object` holds now (holdings.ts). */
  readonly heldBy: (object: Counted) => Held;
  /** The objects whose holdings read `object`'s state (holdings.ts). */
  readonly readersOf: (object: Counted) => readonly Counted[];
  /** Whether `object`, having lost its last holder, is disposed rather than only gone. */
  readonly isDisposable: (object: Counted) => boolean;
  /** Disposes `object` its own way: the code to run, for a disposal that runs code. */
  readonly dispose: (object: Counted) => Run | undefined;
  /** Runs `run`, a disposal's code, to its end. */
  readonly run: (run: Run) => void;
  /** `object` is gone: what watches it from the weak side, or waits on it, learns so. */
  readonly gone: (object: Counted) => void;
}

export class Lifetimes<Run> {
  readonly #seams: LifetimeSeams<Run>;
  readonly #objects = new Map<number, Counted>();
  /** Whether each composite value reaches a counted object; a value never changes, so neither does that. */
  readonly #reaches = new WeakMap<CompositeValue, boolean>();
  readonly #counts = new Counts(this.#reachesCounted.bind(this));
  /** What each of the runtime's own objects was last reported to hold; a cell reports itself. */
  readonly #reported = new Map<number, Held>();
  /** The runtime's own objects whose state changed since their holdings were last reported. */
  readonly #touched = new Set<Counted>();
  readonly #collector: Collector<Run>;
  /** How many `deferring` calls run: none may collect meanwhile. */
  #deferring = 0;

  constructor(seams: LifetimeSeams<Run>) {
    this.#seams = seams;
    this.#collector = new Collector({
      takeZeroes: () => {
        this.#reconcile();
        return this.#counts.takeZeroes();
      },
      has: (id) => this.#objects.has(id),
      isDisposable: (id) => seams.isDisposable(this.#objectOf(id)),
      dispose: (id) => seams.dispose(this.#objectOf(id)),
      run: (run) => {
        seams.run(run);
        return true;
      },
      remove: (id) => {
        this.#remove(id);
      },
    });
  }

  /** Whether something may have lost its last holder since the run last collected, and may be now. */
  get due(): boolean {
    return this.#deferring === 0 && (this.#touched.size > 0 || this.#counts.zeroed);
  }

  /** Runs `work` collecting nothing meanwhile: what it lets go of is collected with what follows. */
  deferring<Result>(work: () => Result): Result {
    this.#deferring += 1;
    try {
      return work();
    } finally {
      this.#deferring -= 1;
    }
  }

  /** A holder came to hold `value`, if any. */
  hold(value: Value | undefined): void {
    if (value !== undefined) {
      this.#counts.holdValue(value);
    }
  }

  /** A holder let go of `value`, if any. */
  release(value: Value | undefined): void {
    if (value !== undefined) {
      this.#counts.releaseValue(value);
    }
  }

  /** A holder let go of `was` for `now`: `now`. */
  swap<Now extends Value>(was: Value | undefined, now: Now): Now {
    this.#counts.holdValue(now);
    this.release(was);
    return now;
  }

  /**
   * `value`, written where nothing counts it: a bug in lowering's `counted` if it reaches a counted
   * object (codegen/emit.ts `checksCounted`).
   */
  uncounted<Written extends Value>(value: Written): Written {
    if (isComposite(value) && this.#reachesCounted(value)) {
      unreachable(
        `An uncounted register was written what reaches a counted object: ${value.kind}.`,
      );
    }
    return value;
  }

  /** `object`, of the runtime's own, was made, held by nothing yet; what its state holds follows. */
  made<Made extends Exclude<Counted, Cell>>(object: Made): Made {
    this.#add(object);
    this.#reported.set(object.object, nothing);
    this.#touched.add(object);
    return object;
  }

  /** The counted `cell` was made, holding its value, held by nothing yet. */
  madeCell(cell: Cell): Cell {
    this.#add(cell);
    this.#counts.holdValue(cell.v);
    return cell;
  }

  /** The state of `object`, of the runtime's own, changed: what it holds may have. */
  touch(object: Counted): void {
    if (this.#objects.has(object.object)) {
      this.#touched.add(object);
    }
  }

  /** How many holders `object` has; undefined once it is gone, or for one never counted. */
  holdersOf(object: Counted): number | undefined {
    this.#reconcile();
    return this.#counts.holdersOf(object.object);
  }

  /** Disposes what lost its last holder, round by round, newest first in each (§7). */
  collect(): void {
    this.#collector.collect();
  }

  #add(object: Counted): void {
    this.#counts.made(object.object);
    this.#objects.set(object.object, object);
  }

  /**
   * Whether `node` reaches a counted object, through its parts: a handle to one, such as a counted
   * cell or a future, reaches it; anything else counts nothing. Every handle inside a value was
   * made before the value, so whether it was counted is known by then.
   */
  #reachesCounted(node: CompositeValue): boolean {
    if (node.kind === 'handle') {
      return this.#objects.has(node.object);
    }
    return this.#reaches.get(node) ?? this.#findReach(node);
  }

  /**
   * `#reachesCounted` of `node`, not known yet: its parts first, without recursing, as values may
   * nest deeper than the stack goes.
   */
  #findReach(node: CompositeValue): boolean {
    const pending: CompositeValue[] = [node];
    for (let top = pending.at(-1); top !== undefined; top = pending.at(-1)) {
      const unknown = childValues(top).filter(
        (part) => isComposite(part) && part.kind !== 'handle' && !this.#reaches.has(part),
      ) as CompositeValue[];
      if (unknown.length === 0) {
        this.#reaches.set(
          top,
          childValues(top).some((part) => isComposite(part) && this.#reachesCounted(part)),
        );
        pending.pop();
      } else {
        pushAll(pending, unknown);
      }
    }
    return this.#reaches.get(node) === true;
  }

  /** Reports what the touched objects, and the objects reading them, hold now. */
  #reconcile(): void {
    while (this.#touched.size > 0) {
      const touched = [...this.#touched];
      this.#touched.clear();
      for (const object of this.#readingAlong(touched)) {
        this.#report(object);
      }
    }
  }

  /** `objects`, and the objects whose holdings read theirs, in turn. */
  #readingAlong(objects: readonly Counted[]): ReadonlySet<Counted> {
    const affected = new Set<Counted>();
    const pending = [...objects];
    for (let object = pending.pop(); object !== undefined; object = pending.pop()) {
      if (!affected.has(object)) {
        affected.add(object);
        pushAll(pending, this.#seams.readersOf(object));
      }
    }
    return affected;
  }

  /** Reports what `object`, unless gone, holds now, if that differs from what it last did. */
  #report(object: Counted): void {
    if (!this.#objects.has(object.object)) {
      return;
    }
    const now = this.#seams.heldBy(object);
    const was = this.#reported.get(object.object) ?? nothing;
    this.#reported.set(object.object, now);
    if (!sameHeld(was, now)) {
      this.#counts.changed(was, now);
    }
  }

  /**
   * Object `id` is gone: it lets go of what it held, as last reported for the runtime's own objects,
   * a cell its value.
   */
  #remove(id: number): void {
    const object = this.#objectOf(id);
    if (this.#touched.has(object)) {
      this.#reconcile();
    }
    const held = this.#reported.get(id) ?? this.#seams.heldBy(object);
    this.#objects.delete(id);
    this.#reported.delete(id);
    this.#touched.delete(object);
    this.#counts.gone(id);
    this.#counts.changed(held, nothing);
    this.#seams.gone(object);
  }

  #objectOf(id: number): Counted {
    return this.#objects.get(id) ?? unreachable(`No counted object ${id} in the run.`);
  }
}

function sameHeld(first: Held, second: Held): boolean {
  return sameItems(first.values, second.values) && sameItems(first.holds, second.holds);
}

function sameItems<Item>(first: readonly Item[], second: readonly Item[]): boolean {
  return first.length === second.length && first.every((item, at) => item === second[at]);
}
