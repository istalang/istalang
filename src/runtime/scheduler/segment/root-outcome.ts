/**
 * An instance's outcome (§9): what its root call gives, awaited when that is a future, then encoded
 * for its host by the entry the instance keeps as its encoder, the codec writing the outcome's
 * type, which its start or its `Instance<T>` names.
 *
 * - The root call is code, run as the root execution, or an extern, whose native the instance's
 *   first segment calls (`callExtern`); starting an instance isn't a call, so no mock answers it
 *   (§10). Its answer is the outcome: an async entry's return value, a simple entry's or an
 *   extern's answer as it is, except a future, which can't outlive its instance. A spawned instance
 *   runs a function giving one, `sendable async fn() -> R`, which a simple entry, such as a
 *   deferred call's function giving its callee's future, or an extern gives as it is.
 * - A future that has resolved gives its value at once. One still pending is awaited: the root
 *   ends, its segment committing as at any driver's `await`, and an `outcome` object holds the
 *   future (snapshot/objects.ts) until it resolves, a future it resolves with followed in turn
 *   (`Futures.endOf`). No frame waits for it, so traces show only the code the instance runs. It
 *   is let go of as any root is (`Instance.releaseRoot`): once it resolves, what it held is
 *   collected before the instance finishes, a disposable outcome disposed as a returned one is;
 *   and a termination disposes the call it awaits, its cleanup running (§7).
 * - The encoder is called before the root's last frame returns the outcome, on top of it, as if
 *   its own `return` called it, so what that frame holds lives until the outcome is encoded and is
 *   disposed after, as at any return; a native encoder answers at once. An outcome no frame
 *   returns, an extern's or an awaited one, is encoded by a root execution of the encoder's own
 *   (`arrival`).
 * - Once the encoder's frame returns, the root's frame returns the outcome it was returning, and
 *   the instance finishes with both: the outcome, which `result()` copies, and its JSON.
 */

import { handleTarget, type Value } from '../../../definition/values/values.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { ActiveFrame } from '../../interpreter/frames.ts';
import { newFrame } from '../../interpreter/machine.ts';
import type { InstanceCall } from '../../snapshot/snapshot.ts';
import type { LiveExecution } from '../instance/heap.ts';
import { type Instance, topFrame } from '../instance/index.ts';
import { type Caller, type CallTarget, startCall } from './calls.ts';
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
 * ends the root, which awaits the future it gives; or lets the encoder run on top of it first.
 */
export type Returning =
  | { readonly kind: 'return'; readonly value: Value }
  | { readonly kind: 'await' }
  | { readonly kind: 'encode' };

/**
 * What an outcome no frame returns gives the segment once it has arrived: the root execution of
 * its encoder to drive, or the outcome to finish with.
 */
export type Arrival =
  | { readonly kind: 'encode'; readonly root: LiveExecution }
  | { readonly kind: 'finished'; readonly outcome: Outcome };

/** The root frame, if one returns it, to return once the encoder's has, and what it returns. */
interface RootReturn {
  readonly root: ActiveFrame | undefined;
  readonly outcome: Value;
}

/** An outcome, once it is known. */
interface Known {
  readonly value: Value;
}

export class RootOutcome {
  readonly #seams: RootOutcomeSeams;
  /** The outcome the root's last frame returns, once it is known. */
  #outcome: Known | undefined;
  /** The outcome an extern's answer gave at once, which no frame returns. */
  #fromExtern: Known | undefined;
  /** The encoder's frame, running on the root's last frame, or as a root of its own. */
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
    const isRootReturn =
      frame !== this.#encoding?.encoder &&
      execution.frames.length === 1 &&
      execution === instance.root();
    if (!isRootReturn) {
      return { kind: 'return', value };
    }
    this.#outcome ??= frame.code.mode === 'simple' ? this.#awaited(value) : { value };
    if (this.#outcome === undefined) {
      return { kind: 'await' };
    }
    const outcome = this.#outcome.value;
    return this.#encodes(frame, outcome) ? { kind: 'encode' } : { kind: 'return', value: outcome };
  }

  /**
   * Makes `call`, of an extern, the call a new instance starts with: its native's answer is the
   * root's, which no mock answers (§10).
   */
  callExtern(call: InstanceCall): void {
    const { instance, caller } = this.#seams;
    const callee = instance.loaded.functions.callee(call.function);
    if (callee.kind !== 'native') {
      unreachable(`Instance '${instance.name}' starts with code, which its root execution runs.`);
    }
    this.#fromExtern = this.#awaited(
      caller.natives.call(call.function, callee.native, call.arguments),
    );
  }

  /**
   * An outcome no frame returns, once it has arrived: an extern's answer, or the future the
   * instance awaits once it resolved, which then holds nothing any more. Undefined until then.
   */
  arrival(): Arrival | undefined {
    const known = this.#fromExtern ?? this.#resolved();
    this.#fromExtern = undefined;
    if (known === undefined) {
      return undefined;
    }
    const outcome = known.value;
    const target = this.#encoderCall(outcome);
    if (target === undefined) {
      return { kind: 'finished', outcome: { outcome } };
    }
    if (target.kind === 'answered') {
      return { kind: 'finished', outcome: { outcome, encoded: target.value } };
    }
    const root = this.#seams.instance.startExecution(
      target.entry,
      target.contents,
      target.captures,
    );
    this.#encoding = { root: undefined, outcome, encoder: topFrame(root) };
    return { kind: 'encode', root };
  }

  /**
   * The outcome a root gives with `value`, a simple entry's or an extern's: a future's value once
   * it has resolved, a pending one held by an `outcome` object meanwhile; any other `value` itself.
   */
  #awaited(value: Value): Known | undefined {
    const { heap, futures } = this.#seams.instance;
    const future = handleTarget(value);
    if (future === undefined || heap.objectOf(future).kind !== 'future') {
      return { value };
    }
    const resolved = futures.endOf(future);
    if (resolved === undefined) {
      this.#seams.instance.awaitOutcome(future);
    }
    return resolved;
  }

  /** What the future the instance awaits ended with, letting go of it; undefined while pending. */
  #resolved(): Known | undefined {
    const { instance } = this.#seams;
    const awaited = instance.awaitedOutcome();
    const resolved = awaited === undefined ? undefined : instance.futures.endOf(awaited);
    if (resolved !== undefined) {
      instance.releaseRoot();
    }
    return resolved;
  }

  /** Whether the encoder runs on top of the root's `frame` first, before it returns `outcome`. */
  #encodes(frame: ActiveFrame, outcome: Value): boolean {
    const { instance, runStack } = this.#seams;
    const target = this.#encoded === undefined ? this.#encoderCall(outcome) : undefined;
    if (target?.kind === 'answered') {
      this.#encoded = target.value;
    }
    if (target?.kind !== 'code') {
      return false;
    }
    const { entry, contents, captures } = target;
    const encoding = newFrame(entry, contents, instance.frameHeap, captures);
    this.#encoding = { root: frame, outcome, encoder: encoding };
    runStack.pushFrame(encoding);
    return true;
  }

  /** The instance's encoder called with `outcome`; undefined when it has none. */
  #encoderCall(outcome: Value): CallTarget | undefined {
    const { instance, caller } = this.#seams;
    const { encoder } = instance;
    return encoder === undefined ? undefined : startCall(caller, encoder, [outcome], []);
  }

  /** `replacement` takes `frame`'s place as the call it runs, the encoder's staying the encoder. */
  replaceFrame(frame: ActiveFrame, replacement: ActiveFrame): void {
    if (this.#encoding?.encoder === frame) {
      this.#encoding = { ...this.#encoding, encoder: replacement };
    }
  }

  /**
   * When `frame`, which returned `value`, is the encoder's: the root's return to make now, from
   * its last frame, or none, the outcome no frame returns.
   */
  returned(frame: ActiveFrame, value: Value): RootReturn | undefined {
    const encoding = this.#encoding;
    if (frame !== encoding?.encoder) {
      return undefined;
    }
    this.#encoded = value;
    return encoding;
  }

  /**
   * `outcome`, the root's, with what the encoder gave for it, the instance finishing with it: the
   * runs still ready never run, so they are dropped (`Instance.dropRuns`).
   */
  finished(outcome: Value): Outcome {
    this.#seams.instance.dropRuns();
    const encoded = this.#encoded;
    return encoded === undefined ? { outcome } : { outcome, encoded };
  }
}
