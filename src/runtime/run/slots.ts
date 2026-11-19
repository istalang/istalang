/**
 * Rebindable function slots (§18), in a Definition built to run tests: while a function value is
 * bound to a function-table entry, the calls of that entry run it instead, in the instance holding
 * the binding and in every instance spawned from it. The testing library makes its mocks of them
 * (testing.ista): it binds a replacement recording its calls, and unbinds it as the mock is let go.
 *
 * - **The newest binding wins.** An entry's bindings stack: unbinding the newest brings back the one
 *   before, whatever order they are unbound in.
 * - **Who answers.** A call asks its instance's bindings, then those of the instances it was spawned
 *   from, nearest first; the holder runs the bound function, and its answer crosses back
 *   (remote-calls.ts).
 * - **Where it hands over:** a code entry asks at its `rebound` instruction, past its prologue, so a
 *   bound function takes every parameter; a native is asked as its extern is called (natives.ts).
 * - **The start stays.** The function an instance or a context's call starts with is never
 *   replaced, so a test can mock the function it calls into; one widened is the function it wraps.
 *   The start is the first call of it to enter (`startsHere`), not the first to ask, as a call its
 *   defaults make asks first.
 * - **Persisted** with the instance, each binding by its id, entry and function (snapshot/).
 */

import type { FunctionId } from '../../definition/operands.ts';
import type { TypeReference } from '../../definition/tables/types.ts';
import type { Value } from '../../definition/values/values.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';
import { calledIn, type HeldFunction } from './remote-calls.ts';
import type { Run } from './run.ts';

/** A function value a function-table entry's calls run instead, while it is bound. */
export interface Binding {
  readonly id: number;
  readonly target: FunctionId;
  readonly bound: Value;
}

/** A function value, as a start is given one. */
type Closure = Extract<Value, { readonly kind: 'closure' }>;

/** What `rebound` gives where no binding holds. */
export const NOT_REBOUND = Symbol('not rebound');

export class Slots {
  readonly #run: Run;
  /** The bindings this instance holds, oldest first. */
  #bindings: Binding[] = [];
  /** The entry an invocation starts with while it starts, which no binding replaces. */
  #starting: number | undefined;

  constructor(run: Run) {
    this.#run = run;
  }

  /** The bindings this instance holds, oldest first, as a snapshot keeps them. */
  get bindings(): readonly Binding[] {
    return this.#bindings;
  }

  /** Binds `bound` to entry `target`, held until it is unbound; the binding's id. */
  bind(target: FunctionId, bound: Value): number {
    const binding = { id: this.#run.newId(), target, bound };
    this.#run.lifetimes.hold(bound);
    this.#bindings = [...this.#bindings, binding];
    return binding.id;
  }

  /** Unbinds the binding `id`, letting go of its function; one unbound already is left alone. */
  unbind(id: number): void {
    const binding = this.#bindings.find((each) => each.id === id);
    if (binding !== undefined) {
      this.#bindings = this.#bindings.filter((each) => each !== binding);
      this.#run.lifetimes.letGo(binding.bound);
    }
  }

  /** Holds `bindings` again, as a snapshot read back gives them, each function held already. */
  restored(bindings: readonly Binding[]): void {
    this.#bindings = [...bindings];
  }

  /** The function bound to entry `target` here, the newest; undefined where none is. */
  boundHere(target: FunctionId): Value | undefined {
    return this.#bindings.findLast((each) => each.target === target)?.bound;
  }

  /**
   * What the function bound to entry `index` gives for `passed`, bound here or in an instance this
   * one was spawned from; `NOT_REBOUND` where none is bound.
   */
  readonly rebound = (index: number, passed: readonly Value[]): unknown => {
    const held = this.#heldFor(index);
    return held === undefined
      ? NOT_REBOUND
      : calledIn(this.#run, held, passed, this.#resultType(index));
  };

  #heldFor(index: number): HeldFunction | undefined {
    const run = this.#run;
    const own = this.boundHere(index);
    if (own !== undefined) {
      return { holder: run, function: own };
    }
    for (const name of run.instance.lineage) {
      const holder = run.world.runOf(name);
      const bound = holder?.slots.boundHere(index);
      if (holder !== undefined && bound !== undefined) {
        return { holder, function: bound };
      }
    }
    return undefined;
  }

  /**
   * Whether the call of entry `index` entering now is the start, which no binding replaces: the
   * first to enter while it starts, before its prologue can call the function again.
   */
  readonly startsHere = (index: number): boolean => {
    const starts = this.#starting === index;
    if (starts) {
      this.#starting = undefined;
    }
    return starts;
  };

  /** What `closure`'s function gives, started as an invocation: no binding replaces it. */
  started(closure: Value, passed: readonly Value[]): unknown {
    this.#starting = this.#startedFunction(closure as Closure);
    try {
      return this.#run.callValue(closure, passed);
    } finally {
      this.#starting = undefined;
    }
  }

  /** The function a start of `closure` starts: its own, or, widened, the one it wraps. */
  #startedFunction(closure: Closure): number {
    const entry = this.#run.definition.functions[closure.function];
    if (entry?.kind !== 'code' || entry.wrapping !== true) {
      return closure.function;
    }
    const [wrapped] = closure.captures;
    return this.#startedFunction(
      (wrapped as Closure | undefined) ?? unreachable('A wrapping entry captures what it wraps.'),
    );
  }

  /** What entry `index` gives: an extern's result, or what a bound function of a code entry gives. */
  #resultType(index: number): TypeReference {
    const entry = this.#run.definition.functions[index];
    if (entry?.kind === 'extern') {
      return entry.result;
    }
    const rebound = entry?.instructions.find((each) => each.kind === 'rebound');
    const type = rebound === undefined ? undefined : entry?.registers[rebound.dst]?.type;
    return type ?? unreachable(`Entry ${String(index)} is rebound nowhere.`);
  }
}
