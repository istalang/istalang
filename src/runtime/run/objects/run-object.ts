/**
 * What every object of a run has (ir-first design, decision 6): an identity from its run's serial,
 * so a newer object has the greater id and disposal rounds go newest first, its holders' count, and
 * whether it was disposed: once, for good, since a disposed value is held by nothing (§16).
 *
 * Every object compares by identity as a handle does (definition/values/equality.ts): its `kind`
 * is `handle` and its `object` its id. `count` is kept only for what reaches a disposable
 * (lifetimes.ts).
 */

/** What every object of a run has: its identity, its holders' count when counted, and its end. */
export abstract class RunObject {
  readonly kind = 'handle';
  readonly object: number;
  count = 0;
  /** Whether its disposal began; no holder counts on it from then on (lifetimes.ts). */
  disposed: boolean;

  /**
   * Whether disposing it ends it for good: all but a handle the run gives out again, a call's or a
   * weak reference, whose last holder letting go ends nothing.
   */
  readonly endsWithDisposal: boolean = true;

  constructor(id: number) {
    this.object = id;
    this.disposed = false;
  }
}
