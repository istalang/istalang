/**
 * Which pairs of reaches the declaration graph allows (design.md §5.5), each answered once for the
 * whole program: what a pair answers depends on the two reaches alone, and the analysis asks the
 * pair of every two values a write relates, again at each pass over a loop, in every body. Each
 * reach gets a number, and each test keeps its answers in a table by those numbers; an analysis
 * keeps each of its nodes' numbers (`allowedBy`).
 */

import type { HandleReach } from '../type-reach.ts';

type PairTest = (first: HandleReach, second: HandleReach) => boolean;

const unknown = 0;
const no = 1;
const yes = 2;

export class ReachPairs {
  readonly #numbers = new Map<HandleReach, number>();
  readonly #reaches: HandleReach[] = [];
  readonly #answers = new Map<PairTest, Uint8Array>();
  #width = 8;

  /** `reach`'s number, given it now if it has none. */
  numberOf(reach: HandleReach): number {
    const known = this.#numbers.get(reach);
    if (known !== undefined) {
      return known;
    }
    const number = this.#reaches.length;
    this.#numbers.set(reach, number);
    this.#reaches.push(reach);
    if (number >= this.#width) {
      this.#widen();
    }
    return number;
  }

  /** Whether `test` allows the reaches numbered `first` and `second`. */
  allows(test: PairTest, first: number, second: number): boolean {
    const answers = this.#answersOf(test);
    const at = first * this.#width + second;
    if (answers[at] === unknown) {
      const allowed = test(
        this.#reaches[first] as HandleReach,
        this.#reaches[second] as HandleReach,
      );
      answers[at] = allowed ? yes : no;
    }
    return answers[at] === yes;
  }

  #answersOf(test: PairTest): Uint8Array {
    const known = this.#answers.get(test);
    if (known !== undefined) {
      return known;
    }
    const answers = new Uint8Array(this.#width * this.#width);
    this.#answers.set(test, answers);
    return answers;
  }

  /** Doubles the tables' width, keeping each answer at its pair. */
  #widen(): void {
    const width = 2 * this.#width;
    for (const [test, answers] of this.#answers) {
      const wider = new Uint8Array(width * width);
      for (let row = 0; row < this.#width; row += 1) {
        wider.set(answers.subarray(row * this.#width, (row + 1) * this.#width), row * width);
      }
      this.#answers.set(test, wider);
    }
    this.#width = width;
  }
}
