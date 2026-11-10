/**
 * An instance's outcome (§9): what its root's last frame gives as it returns, awaited when that is
 * a future, then encoded for its host by the entry the instance keeps as its encoder, the codec
 * writing the outcome's type, which its start or its `Instance<T>` names.
 *
 * - An instance never ends with a future, which can't outlive it. A spawned one runs a function
 *   giving one, `sendable async fn() -> R`: an async entry's execution is the root, whose value is
 *   the outcome, while a plain entry, such as a deferred call's function giving its callee's
 *   future, gives the future itself. That root waits on it at its `return`, then ends with its
 *   value (interpreter/suspension.ts), so no frame is added to wait: traces show only the code the
 *   instance runs, and the wait commits, survives a crash and resumes as any other.
 * - The encoder is called before the root's last frame returns, on top of it, as if its own
 *   `return` called it, so what that frame holds lives until the outcome is encoded and is
 *   disposed after, as at any return; a native encoder answers at once.
 * - Once the encoder's frame returns, the root's frame returns the outcome it was returning, and
 *   the instance finishes with both: the outcome, which `result()` copies, and its JSON.
 */

import { handleTarget, type Value } from '../../../definition/values/values.ts';
import type { ActiveFrame } from '../../interpreter/frames.ts';
import { newFrame } from '../../interpreter/machine.ts';
import type { Instance } from '../instance/index.ts';
import { type Caller, startCall } from './calls.ts';
import type { RunStack } from './run-stack.ts';

export interface RootOutcomeSeams {
  readonly instance: Instance;
  /** Who the segment's calls are made by, which a call to another instance's mock carries. */
  readonly caller: Caller;
  /** The segment's run stack, shared with it: what runs is its top. */
  readonly runStack: RunStack;
}

/** What an instance's root gave, and that as `Json` when the instance has an encoder (§9). */
export interface Outcome {
  readonly outcome: Value;
  readonly encoded?: Value;
}

/**
 * What the top frame does as it returns: returns a value, the root's outcome when the root returns;
 * waits, a plain root on the future it gives; or lets the encoder run on top of it first.
 */
export type Returning =
  | { readonly kind: 'return'; readonly value: Value }
  | { readonly kind: 'wait' }
  | { readonly kind: 'encode' };

/** The root frame to return once the encoder's has, and what it returns. */
interface RootReturn {
  readonly root: ActiveFrame;
  readonly outcome: Value;
}

export class RootOutcome {
  readonly #seams: RootOutcomeSeams;
  /** The outcome the root's last frame returns, once it is known. */
  #outcome: { readonly value: Value } | undefined;
  /** The encoder's frame, running on the root's last frame. */
  #encoding: (RootReturn & { readonly encoder: ActiveFrame }) | undefined;
  /** What the encoder gave. */
  #encoded: Value | undefined;

  constructor(seams: RootOutcomeSeams) {
    this.#seams = seams;
  }

  /** What `frame`, the top frame, does as it returns `value`. */
  returning(frame: ActiveFrame, value: Value): Returning {
    const { instance, runStack } = this.#seams;
    const execution = runStack.current();
    if (execution.frames.length !== 1 || execution !== instance.root()) {
      return { kind: 'return', value };
    }
    this.#outcome ??= this.#awaited(frame, value);
    if (this.#outcome === undefined) {
      return { kind: 'wait' };
    }
    const outcome = this.#outcome.value;
    return this.#encodes(frame, outcome) ? { kind: 'encode' } : { kind: 'return', value: outcome };
  }

  /**
   * The outcome a root's last frame gives with `value`: a plain root's future's value, undefined
   * until it resolves; any other `value` itself.
   */
  #awaited(frame: ActiveFrame, value: Value): { readonly value: Value } | undefined {
    const { heap, futures } = this.#seams.instance;
    const target = handleTarget(value);
    const givesFuture =
      frame.code.mode === 'plain' &&
      target !== undefined &&
      heap.objectOf(target).kind === 'future';
    return givesFuture ? futures.settled(value) : { value };
  }

  /** Whether the encoder runs on top of the root's `frame` first, before it returns `outcome`. */
  #encodes(frame: ActiveFrame, outcome: Value): boolean {
    const { instance, caller, runStack } = this.#seams;
    const { encoder } = instance;
    if (encoder === undefined || this.#encoded !== undefined) {
      return false;
    }
    const target = startCall(caller, encoder, [outcome], []);
    if (target.kind === 'answered') {
      this.#encoded = target.value;
      return false;
    }
    const { entry, contents, captures } = target;
    const encoding = newFrame(entry, contents, instance.frameHeap, captures);
    this.#encoding = { root: frame, outcome, encoder: encoding };
    runStack.pushFrame(encoding);
    return true;
  }

  /** When `frame`, which returned `value`, is the encoder's: the root's return to make now. */
  returned(frame: ActiveFrame, value: Value): RootReturn | undefined {
    const encoding = this.#encoding;
    if (frame !== encoding?.encoder) {
      return undefined;
    }
    this.#encoded = value;
    return encoding;
  }

  /** `outcome`, the root's, with what the encoder gave for it. */
  finished(outcome: Value): Outcome {
    const encoded = this.#encoded;
    return encoded === undefined ? { outcome } : { outcome, encoded };
  }
}
