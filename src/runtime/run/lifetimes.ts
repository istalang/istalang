/**
 * Holders, as compiled code keeps them (ir-first design, decision 5; docs/arch/definition.md,
 * "Holders"): lowering places every hold and let-go, so this module only counts and acts.
 *
 * - **Counted** values reach a disposable: each holder is counted, on the object itself for a run
 *   object and in a WeakMap for a composite, and what loses its last holder is disposed. Values
 *   losing it together go in rounds, the newest object first; what a disposed value held loses its
 *   holder only once that disposal is done, in the next round. A let-go during a round joins it
 *   rather than starting one of its own.
 * - **Heap** values reach none: nothing is counted, but a value given a second holder is marked
 *   shared, for good. A write changes a value in place only while it is unique: counted once, or
 *   never shared. A shared value is copied, its parts then shared or held by the copy too.
 * - **Plain** values are neither: `hold` and `letGo` pass over anything that isn't an object.
 * - A value changed in place forgets what was derived from it (its hash, its map's table, its
 *   summary), so derived data stays keyed by values that never change under it.
 */

import { copiedMap, forgetDerived } from '../../definition/values/equality.ts';
import {
  childValues,
  type CompositeValue,
  forgetSummary,
  isComposite,
  type Value,
} from '../../definition/values/values.ts';
import { RunObject, type Step } from './objects.ts';

/** What disposing an object that lost its last holder does: its `dispose`, its stop, its contents. */
export type Disposer = (object: RunObject) => readonly Value[];

const composites = new Set(['tuple', 'struct', 'variant', 'array', 'map', 'closure']);

/** Whether `value` is a composite whose holders a count or a shared mark can follow. */
function isNode(value: Value | undefined): value is CompositeValue {
  return value !== undefined && isComposite(value) && composites.has(value.kind);
}

export class Lifetimes {
  readonly #counts = new WeakMap<object, number>();
  readonly #shared = new WeakSet<object>();
  readonly #dispose: Disposer;
  /** The objects that lost their last holder, waiting for the round collecting them. */
  #zeros: RunObject[] | undefined;

  constructor(dispose: Disposer) {
    this.#dispose = dispose;
  }

  /** Another holder of `value`. */
  readonly hold = (value: Value | undefined): void => {
    if (value instanceof RunObject) {
      value.count += 1;
    } else if (isNode(value)) {
      this.#counts.set(value, (this.#counts.get(value) ?? 0) + 1);
    }
  };

  /** Marks `value`, a heap value, as having another holder. */
  readonly share = (value: Value | undefined): void => {
    if (isNode(value)) {
      this.#shared.add(value);
    }
  };

  /** One holder fewer of `value`; disposes what loses its last one, in rounds. */
  readonly letGo = (value: Value | undefined): void => {
    const outermost = this.#zeros === undefined;
    const zeros = this.#zeros ?? [];
    this.#zeros = zeros;
    this.#release(value, zeros);
    if (outermost) {
      try {
        this.#collect(zeros);
      } finally {
        this.#zeros = undefined;
      }
    }
  };

  /** Whether `node` has one holder: changing it in place changes no other's value. */
  isUnique(node: Value): boolean {
    if (node instanceof RunObject || !isNode(node)) {
      return true;
    }
    const count = this.#counts.get(node);
    return count === undefined ? !this.#shared.has(node) : count <= 1;
  }

  /**
   * `node` as its writer may change it: itself when unique; else a copy, whose parts its original
   * shares, the writer letting go of the original for it.
   */
  owned(node: CompositeValue): CompositeValue {
    if (this.isUnique(node)) {
      forgetDerived(node);
      forgetSummary(node);
      return node;
    }
    const copy = copiedNode(node);
    for (const child of childValues(copy)) {
      if (isNode(child) && this.#counts.has(child)) {
        this.hold(child);
      } else if (child instanceof RunObject) {
        if (child.count > 0) {
          this.hold(child);
        }
      } else {
        this.share(child);
      }
    }
    if (this.#counts.has(node)) {
      this.#counts.set(copy, 1);
      this.letGo(node);
    }
    return copy;
  }

  /**
   * `root` with the value at `path` replaced by `value`, moved in, each value along the path
   * changed in place where unique (`owned`); the value replaced let go of when `counted`.
   */
  withPart(root: Value, path: readonly Step[], value: Value, counted: boolean): Value {
    if (path.length === 0) {
      if (counted) {
        this.letGo(root);
      }
      return value;
    }
    const own = this.owned(root as CompositeValue);
    let parent: CompositeValue = own;
    for (const [at, [part, position]] of path.entries()) {
      const children = (parent as unknown as Record<string, Value[]>)[part] ?? [];
      const child = children[position] ?? null;
      if (at === path.length - 1) {
        children[position] = value;
        if (counted) {
          this.letGo(child);
        }
      } else {
        const next = this.owned(child as CompositeValue);
        children[position] = next;
        parent = next;
      }
    }
    return own;
  }

  /** Lets go of `value` into `zeros`: a counted composite losing its last holder lets go of its parts. */
  #release(first: Value | undefined, zeros: RunObject[]): void {
    const pending: (Value | undefined)[] = [first];
    for (let value = pending.pop(); pending.length > 0 || value !== undefined; value = pending.pop()) {
      if (value instanceof RunObject) {
        if (value.count > 0) {
          value.count -= 1;
          if (value.count === 0) {
            zeros.push(value);
          }
        }
      } else if (isNode(value)) {
        const count = this.#counts.get(value);
        if (count !== undefined) {
          this.#counts.set(value, count - 1);
          if (count === 1) {
            pending.push(...childValues(value));
          }
        }
      }
    }
  }

  /** Disposes `zeros` in rounds, newest first, what each held losing it in the round after. */
  #collect(zeros: RunObject[]): void {
    while (zeros.length > 0) {
      const round = zeros.splice(0).sort((first, second) => second.object - first.object);
      const released: Value[] = [];
      for (const object of round) {
        released.push(...this.#dispose(object));
      }
      for (const value of released) {
        this.#release(value, zeros);
      }
    }
  }
}

/** A shallow copy of `node`, its parts in a list of their own. */
function copiedNode(node: CompositeValue): CompositeValue {
  switch (node.kind) {
    case 'tuple':
    case 'array':
      return { ...node, elements: [...node.elements] };
    case 'struct':
    case 'variant':
      return { ...node, fields: [...node.fields] };
    case 'map':
      return copiedMap(node);
    case 'closure':
      return { ...node, captures: [...node.captures] };
    default:
      return node;
  }
}
