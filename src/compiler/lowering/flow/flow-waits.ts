/**
 * The waits of a flow being written (§6, §8): an `await` or `select` waits on one wait, which the
 * first `onAwait` call written before it opens and the rest hand their resolvers to. Once it is
 * decided, each future it waited on gives its value into a register of its own.
 */

import type { Register } from '../../../definition/operands.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { ValueId } from '../../checker/surface/flow-ir.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import type { OpenWait } from '../calls/waits.ts';

export class FlowWaits {
  #open: OpenWait | undefined;
  readonly #awaited: ValueId[] = [];
  /** What each future gave once it settled, in the register owning it. */
  readonly #given = new Map<ValueId, Register>();

  /** The wait being opened, opened by `open` the first time. */
  opened(open: () => OpenWait): OpenWait {
    this.#open ??= open();
    return this.#open;
  }

  /** Notes that the case of the wait being opened waits on `future`. */
  awaiting(future: ValueId): void {
    this.#awaited.push(future);
  }

  /** The wait opened, which the `await` or `select` written now waits on, and its futures. */
  take(): { readonly open: OpenWait; readonly futures: readonly ValueId[] } {
    const open = this.#open ?? unreachable('An await waits on no wait opened.');
    this.#open = undefined;
    return { open, futures: this.#awaited.splice(0) };
  }

  /** Makes `register`, which owns it, what `future` gave once it settled. */
  give(future: ValueId, register: Register): void {
    this.#given.set(future, register);
  }

  /** What `future` gave once it settled. */
  givenBy(future: ValueId, span: AnchoredSpan): Register {
    return (
      this.#given.get(future) ??
      unreachable(`What the future at ${span.from} gave is read before it settled.`)
    );
  }

  /** Whether `register` holds what some future gave. */
  holdsGiven(register: Register): boolean {
    return [...this.#given.values()].includes(register);
  }
}
