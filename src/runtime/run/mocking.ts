/**
 * Mocking in a run (§10), in a Definition built to run tests: the mocks the instance holds
 * (mocks.ts), what a call of a mocked target answers, and the start no mock replaces.
 *
 * - **Who answers.** A call asks the instance's own mocks, then those of the instances it was
 *   spawned from, nearest first (world.ts `heldMock`); the holder runs the replacement, and its
 *   answer crosses back (mock-answers.ts).
 * - **The start stays.** The function an instance or a context's call starts with is never
 *   replaced, so a test can mock the function it calls into; one widened is the function it wraps.
 *   The start is the first call of it to enter (`startsHere`), not the first to ask, as a call its
 *   defaults make asks first.
 * - A call is recorded as the tuple of its arguments, a call of none as `Unit` (§10 `calls()`).
 */

import type { TypeReference } from '../../definition/tables/types.ts';
import type { Value } from '../../definition/values/values.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';
import { answerOfMock } from './mock-answers.ts';
import { Mocks } from './mocks.ts';
import { MockObject } from './objects/mock-object.ts';
import type { Run } from './run.ts';

/** A function value, as a start is given one. */
type Closure = Extract<Value, { readonly kind: 'closure' }>;

/** What `mocked` gives where no mock holds. */
export const NOT_MOCKED = Symbol('not mocked');

export class Mocking {
  /** The mocks the instance holds. */
  readonly held = new Mocks();
  readonly #run: Run;
  /** The entry an invocation starts with while it starts, which no mock replaces. */
  #starting: number | undefined;

  constructor(run: Run) {
    this.#run = run;
  }

  /**
   * What the mock the call of entry `index` with `passed` reaches answers, held here or by an
   * instance this one was spawned from; `NOT_MOCKED` where none is held.
   */
  readonly mocked = (index: number, passed: readonly Value[]): unknown => {
    const run = this.#run;
    const mock = this.held.of(index);
    const held = mock === undefined ? run.world.heldMock?.(run, index) : { holder: run, mock };
    return held === undefined
      ? NOT_MOCKED
      : answerOfMock(run, held, passed, this.#resultType(index));
  };

  /**
   * Whether the call of entry `index` entering now is the start, which no mock replaces: the first
   * to enter while it starts, before its prologue can call the function again.
   */
  readonly startsHere = (index: number): boolean => {
    const starts = this.#starting === index;
    if (starts) {
      this.#starting = undefined;
    }
    return starts;
  };

  /** What `closure`'s function gives, started as an invocation: no mock replaces it. */
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

  /** Records the call of `mock`'s target with `passed`, then runs its replacement with them. */
  answer(mock: MockObject, passed: readonly Value[]): unknown {
    const run = this.#run;
    const entry = run.definition.functions[mock.target];
    const types =
      entry?.kind === 'code'
        ? entry.registers.slice(0, entry.parameters.length).map(({ type }) => type)
        : (entry?.parameters.map(({ type }) => type) ?? []);
    const call: Value = passed.length === 0 ? null : { kind: 'tuple', elements: [...passed] };
    run.lifetimes.adopt(call, { kind: 'tuple', elements: types });
    mock.calls.push(call);
    return run.callValue(mock.replacement, passed);
  }

  /** Holds a mock replacing entry `target` with `replacement`; its handle. */
  mock(target: number, replacement: Value): MockObject {
    const mock = new MockObject(this.#run.newId(), target, replacement);
    this.#run.lifetimes.hold(replacement);
    this.held.hold(mock);
    return mock;
  }

  /** What entry `index` gives: an extern's result, or what a mock of a code entry answers. */
  #resultType(index: number): TypeReference {
    const entry = this.#run.definition.functions[index];
    if (entry?.kind === 'extern') {
      return entry.result;
    }
    const mocked = entry?.instructions.find((each) => each.kind === 'mocked');
    const type = mocked === undefined ? undefined : entry?.registers[mocked.dst]?.type;
    return type ?? unreachable(`Entry ${String(index)} answers no mock.`);
  }
}
