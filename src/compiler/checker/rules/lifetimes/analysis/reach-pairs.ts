/**
 * Which pairs of an analysis's nodes their types allow (design.md §5.5), answered once per pair of
 * the nodes' reaches. A function's nodes have few reaches among them, and the analysis asks the
 * pair of every two values a write relates, again at each pass over a loop, so each node is given
 * the number of its reach, and each test keeps its answers in a table by those numbers.
 */

import type { NodeId } from '../reach-state.ts';
import type { HandleReach } from '../type-reach.ts';

type PairTest = (first: HandleReach, second: HandleReach) => boolean;

const unknown = 0;
const no = 1;
const yes = 2;

export class ReachPairs {
  readonly #reachOf: (node: NodeId) => HandleReach;
  readonly #numbers = new Map<HandleReach, number>();
  readonly #reaches: HandleReach[] = [];
  readonly #numberOf = new Map<NodeId, number>();
  readonly #answers = new Map<PairTest, Uint8Array>();
  #width = 8;

  constructor(reachOf: (node: NodeId) => HandleReach) {
    this.#reachOf = reachOf;
  }

  /** Whether `test` allows the reaches of `first` and `second`. */
  allows(test: PairTest, first: NodeId, second: NodeId): boolean {
    const row = this.#number(first);
    const column = this.#number(second);
    const answers = this.#answersOf(test);
    const at = row * this.#width + column;
    if (answers[at] === unknown) {
      const allowed = test(this.#reaches[row] as HandleReach, this.#reaches[column] as HandleReach);
      answers[at] = allowed ? yes : no;
    }
    return answers[at] === yes;
  }

  #number(node: NodeId): number {
    const known = this.#numberOf.get(node);
    if (known !== undefined) {
      return known;
    }
    const reach = this.#reachOf(node);
    let number = this.#numbers.get(reach);
    if (number === undefined) {
      number = this.#reaches.length;
      this.#numbers.set(reach, number);
      this.#reaches.push(reach);
      if (number >= this.#width) {
        this.#widen();
      }
    }
    this.#numberOf.set(node, number);
    return number;
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
