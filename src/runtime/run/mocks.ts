/**
 * Mocks (§10), in a Definition built to run tests: while a mock is held, the calls of its target,
 * the function-table entry its target names, run its replacement instead, from the instance
 * holding it and every instance spawned from it (run/world.ts).
 *
 * - **The newest held wins.** A target's mocks stack: releasing the newest brings back the one
 *   before, whatever order they are released in.
 * - **A call is recorded** as the tuple of its arguments, which the mock holds for `calls()`.
 * - **Where it hands over:** a code entry asks at its `mocked` instruction, past its prologue, so a
 *   replacement takes every parameter; a native is asked as its extern is called (natives.ts).
 */

import type { MockObject } from './objects/mock-object.ts';

/** The mocks one instance holds, by target, newest last. */
export class Mocks {
  readonly #held = new Map<number, MockObject[]>();

  /** Holds `mock`, the newest for its target. */
  hold(mock: MockObject): void {
    const held = this.#held.get(mock.target) ?? [];
    this.#held.set(mock.target, [...held, mock]);
  }

  /** Lets go of `mock`, which no call reaches any more. */
  release(mock: MockObject): void {
    const held = (this.#held.get(mock.target) ?? []).filter((each) => each !== mock);
    if (held.length === 0) {
      this.#held.delete(mock.target);
    } else {
      this.#held.set(mock.target, held);
    }
  }

  /** The mock the calls of `target` reach, if one is held. */
  of(target: number): MockObject | undefined {
    return this.#held.get(target)?.at(-1);
  }
}
