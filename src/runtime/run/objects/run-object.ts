/**
 * What every object of a run has (ir-first design, decision 6): an identity from its run's serial,
 * so a newer object has the greater id and disposal rounds go newest first, and its holders' count.
 *
 * Every object compares by identity as a handle does (definition/values/equality.ts): its `kind`
 * is `handle` and its `object` its id. `count` is kept only for what reaches a disposable
 * (lifetimes.ts).
 */

/** What every object of a run has: its identity, and its holders' count when counted. */
export abstract class RunObject {
  readonly kind = 'handle';
  readonly object: number;
  count = 0;

  constructor(id: number) {
    this.object = id;
  }
}
