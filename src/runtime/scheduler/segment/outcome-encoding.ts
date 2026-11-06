/**
 * An instance's outcome encoded for its host (§9), by the entry the instance keeps as its encoder:
 * the codec writing the outcome's type, which a start or a `spawn` named.
 *
 * - The encoder is called before the root's last frame returns, on top of it, as if its own
 *   `return` called it, so what that frame holds lives until the outcome is encoded and is
 *   disposed after, as at any return; a native encoder answers at once.
 * - Once the encoder's frame returns, the root's frame returns the outcome it was returning, and
 *   the instance finishes with both: the outcome, which `result()` copies, and its JSON.
 */

import type { Value } from '../../../definition/values/values.ts';
import type { ActiveFrame } from '../../interpreter/frames.ts';
import { newFrame } from '../../interpreter/machine.ts';
import type { Instance } from '../instance/index.ts';
import { type Caller, startCall } from './calls.ts';
import type { RunStack } from './run-stack.ts';

export interface OutcomeEncodingSeams {
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

/** The root frame to return once the encoder's has, and what it returns. */
interface RootReturn {
  readonly root: ActiveFrame;
  readonly outcome: Value;
}

export class OutcomeEncoding {
  readonly #seams: OutcomeEncodingSeams;
  /** The encoder's frame, running on the root's last frame. */
  #running: (RootReturn & { readonly encoder: ActiveFrame }) | undefined;
  /** What the encoder gave. */
  #encoded: Value | undefined;

  constructor(seams: OutcomeEncodingSeams) {
    this.#seams = seams;
  }

  /** Whether `frame`, about to return `value`, is the root's last and calls the encoder first. */
  before(frame: ActiveFrame, value: Value): boolean {
    const { instance, caller, runStack } = this.#seams;
    const { encoder } = instance;
    const execution = runStack.current();
    const isRootReturn = execution === instance.root() && execution.frames.length === 1;
    if (encoder === undefined || this.#encoded !== undefined || !isRootReturn) {
      return false;
    }
    const target = startCall(caller, encoder, [value], []);
    if (target.kind === 'answered') {
      this.#encoded = target.value;
      return false;
    }
    const { entry, contents, captures } = target;
    const encoding = newFrame(entry, contents, instance.frameHeap, captures);
    this.#running = { root: frame, outcome: value, encoder: encoding };
    runStack.pushFrame(encoding);
    return true;
  }

  /** When `frame`, which returned `value`, is the encoder's: the root's return to make now. */
  returned(frame: ActiveFrame, value: Value): RootReturn | undefined {
    const running = this.#running;
    if (frame !== running?.encoder) {
      return undefined;
    }
    this.#encoded = value;
    return running;
  }

  /** `outcome`, the root's, with what the encoder gave for it. */
  finished(outcome: Value): Outcome {
    const encoded = this.#encoded;
    return encoded === undefined ? { outcome } : { outcome, encoded };
  }
}
