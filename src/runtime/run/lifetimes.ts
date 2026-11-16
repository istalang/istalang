/**
 * Holders, as compiled code keeps them (ir-first design, decision 5; docs/arch/definition.md,
 * "Holders"): lowering places every hold and let-go, so this module only counts and acts.
 *
 * - **Counted** values reach a disposable: each holder is counted, on the object itself for a run
 *   object and in a WeakMap for a composite, and what loses its last holder is disposed. Values
 *   losing it together go in rounds, the newest object first; what a disposed value held loses its
 *   holder only once that disposal is done, in the next round. A let-go during a round joins it
 *   rather than starting one of its own, but for one `apart` from it: a disposed call's cleanup,
 *   whose let-gos are disposed before its call is gone (§7).
 * - **Heap** values reach none: nothing is counted, but a value given a second holder is marked
 *   shared, for good. A write changes a value in place only while it is unique: counted once, or
 *   never shared. A shared value is copied, its parts then shared or held by the copy too.
 * - **Plain** values are neither: `hold` and `letGo` pass over anything that isn't an object.
 * - A value changed in place forgets what was derived from it (its hash, its map's table, its
 *   summary, the JSON written of it and the host's object of that JSON), so derived data stays
 *   keyed by values that never change under it. The JSON the run wrote values as is kept here
 *   (`written`), each held for good: shared, so no part of it changes in place.
 * - A native builds its result around values it borrowed, where compiled code moves each part in:
 *   its taker `adopt`s it, a composite of counted type it built holding each of its parts in turn.
 */

import {
  lifetimeOf,
  type TypeDefinition,
  type TypeReference,
} from '../../definition/tables/types.ts';
import { copiedMap, forgetDerived } from '../../definition/values/equality.ts';
import { forgetPlainOf } from '../../definition/values/json-values.ts';
import {
  type CompositeValue,
  childValues,
  forgetSummary,
  isComposite,
  type Value,
} from '../../definition/values/values.ts';
import { WrittenJson } from '../../definition/values/written-json.ts';
import type { Step } from './objects/reference.ts';
import { RunObject } from './objects/run-object.ts';

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
  /** What the run wrote values as (written-json.ts), each `Json` held for good. */
  readonly written = new WrittenJson((json) => this.share(json));
  readonly #dispose: Disposer;
  readonly #types: readonly TypeDefinition[];
  /** The objects that lost their last holder, waiting for the round collecting them. */
  #zeros: RunObject[] | undefined;

  constructor(dispose: Disposer, types: readonly TypeDefinition[]) {
    this.#dispose = dispose;
    this.#types = types;
  }

  /** Another holder of `value`. */
  readonly hold = (value: Value | undefined): void => {
    if (value instanceof RunObject) {
      value.count += 1;
    } else if (isNode(value)) {
      this.#counts.set(value, (this.#counts.get(value) ?? 0) + 1);
    }
  };

  /**
   * Another holder of `value`, of `type`, which a native gave: a composite of counted type with no
   * count yet is one it built, counted once and holding each of its parts; any other part is held,
   * or shared where it is a heap value.
   */
  adopt(value: Value | undefined, type: TypeReference): void {
    const pending: [Value | undefined, TypeReference][] = [[value, type]];
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
      const [part, partType] = next;
      const lifetime = lifetimeOf(this.#types, partType);
      if (lifetime === 'heap') {
        this.share(part);
      } else if (lifetime === 'counted' && isNode(part) && !this.#counts.has(part)) {
        this.#counts.set(part, 1);
        pending.push(...typedParts(this.#types, part, partType));
      } else if (lifetime === 'counted') {
        this.hold(part);
      }
    }
  }

  /** Another holder of `value`, of `type`: counted, or marked shared where it is a heap value. */
  keep(value: Value | undefined, type: TypeReference): void {
    const lifetime = lifetimeOf(this.#types, type);
    if (lifetime === 'counted') {
      this.hold(value);
    } else if (lifetime === 'heap') {
      this.share(value);
    }
  }

  /** Marks `value`, a heap value, as having another holder. */
  readonly share = (value: Value | undefined): void => {
    if (isNode(value)) {
      this.#shared.add(value);
    }
  };

  /**
   * One holder fewer of each of `values`, let go of together; disposes what loses its last one, in
   * rounds, so values losing it at one block exit go newest first.
   */
  readonly letGo = (...values: (Value | undefined)[]): void => {
    const outermost = this.#zeros === undefined;
    const zeros = this.#zeros ?? [];
    this.#zeros = zeros;
    for (const value of values) {
      this.#release(value, zeros);
    }
    if (outermost) {
      try {
        this.#collect(zeros);
      } finally {
        this.#zeros = undefined;
      }
    }
  };

  /** Runs `cleanup`, whose let-gos are collected together, in rounds of their own, as it ends. */
  apart(cleanup: () => void): void {
    const outer = this.#zeros;
    const zeros: RunObject[] = [];
    this.#zeros = zeros;
    try {
      cleanup();
      this.#collect(zeros);
    } finally {
      this.#zeros = outer;
    }
  }

  /** Whether `node` has one holder: changing it in place changes no other's value. */
  isUnique(node: Value): boolean {
    if (node instanceof RunObject || !isNode(node)) {
      return true;
    }
    const count = this.#counts.get(node);
    return (count === undefined || count <= 1) && !this.#shared.has(node);
  }

  /**
   * Another holder of `value`, read back from a snapshot: an object is held once more; a composite,
   * which comes back held by this holder alone, is counted once and holds each of its parts in turn.
   */
  adoptRestored(value: Value | undefined): void {
    const pending: (Value | undefined)[] = [value];
    for (let next = pending.pop(); pending.length > 0 || next !== undefined; next = pending.pop()) {
      if (isNode(next) && !this.#counts.has(next)) {
        this.#counts.set(next, 1);
        pending.push(...childValues(next));
      } else {
        this.hold(next);
      }
    }
  }

  /**
   * `node` as its writer may change it: itself when unique; else a copy, whose parts its original
   * shares, the writer letting go of the original for it.
   */
  owned(node: CompositeValue): CompositeValue {
    if (this.isUnique(node)) {
      forgetDerived(node);
      forgetSummary(node);
      forgetPlainOf(node);
      this.written.forget(node);
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
    for (
      let value = pending.pop();
      pending.length > 0 || value !== undefined;
      value = pending.pop()
    ) {
      if (value instanceof RunObject) {
        releaseObject(value, zeros);
      } else if (isNode(value)) {
        pending.push(...this.#releasedNode(value));
      }
    }
  }

  /** Lets go of the composite `node`; the parts it held, should that be its last holder. */
  #releasedNode(node: CompositeValue): readonly Value[] {
    const count = this.#counts.get(node);
    if (count === undefined) {
      return [];
    }
    this.#counts.set(node, count - 1);
    return count === 1 ? childValues(node) : [];
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

/** Lets go of `object`, a counted one into `zeros` once it loses its last holder. */
function releaseObject(object: RunObject, zeros: RunObject[]): void {
  if (object.count > 0) {
    object.count -= 1;
    if (object.count === 0) {
      zeros.push(object);
    }
  }
}

/** The parts of `node`, of `type`, each with its type; a closure's captures, untyped, are held as functions are. */
function typedParts(
  types: readonly TypeDefinition[],
  node: CompositeValue,
  type: TypeReference,
): [Value, TypeReference][] {
  const function_: TypeReference = {
    kind: 'function',
    parameters: [],
    result: { kind: 'primitive', name: 'Unit' },
  };
  const of = (values: readonly Value[], typeAt: (at: number) => TypeReference | undefined) =>
    values.map((value, at): [Value, TypeReference] => [value, typeAt(at) ?? function_]);
  if (type.kind === 'tuple' && node.kind === 'tuple') {
    return of(node.elements, (at) => type.elements[at]);
  }
  const entry = type.kind === 'named' ? types[type.type] : undefined;
  switch (entry?.kind) {
    case 'alias':
      return typedParts(types, node, entry.type);
    case 'struct':
      return node.kind === 'struct' ? of(node.fields, (at) => entry.fields[at]?.type) : [];
    case 'enum':
      return node.kind === 'variant'
        ? of(node.fields, (at) => entry.variants[node.variant]?.fields[at]?.type)
        : [];
    case 'extern':
      if (node.kind === 'array') {
        return of(node.elements, () => entry.arguments[0]);
      }
      return node.kind === 'map' ? of(node.entries.flat(), (at) => entry.arguments[at % 2]) : [];
    default:
      return of(childValues(node), () => undefined);
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
