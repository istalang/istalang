/**
 * A resolver of a run of compiled code (proposal 8, Rule 5): it decides a wait's case, decides
 * another resolver with its value and a position (`Resolver.at`), or calls back a function value
 * (`Resolver.of`). It resolves once; a pending one ends cancelled when what it decides no longer
 * waits for it.
 */

import type { Value } from '../../definition/values/values.ts';
import { newObject } from '../values/cell.ts';
import type { Future } from './future.ts';
import type { Wait } from './wait.ts';

/** What a resolver decides. */
export type Target =
  | { readonly kind: 'case'; readonly wait: Wait; readonly position: number }
  | { readonly kind: 'at'; readonly done: Resolver; readonly position: bigint }
  | { readonly kind: 'callback'; readonly callback: Value };

export class Resolver {
  readonly kind = 'handle';
  readonly object = newObject();
  state: 'pending' | 'resolved' | 'cancelled';
  readonly target: Target;
  /** The futures it is registered on, in the order it was. */
  readonly on: Future[] = [];
  readonly onCancel: Value[] = [];
  /** The pending `Resolver.at` resolvers deciding it. */
  readonly positions: Resolver[] = [];

  constructor(target: Target, state: Resolver['state'] = 'pending') {
    this.target = target;
    this.state = state;
  }

  /** What it comes down to deciding: itself, or what the one a `Resolver.at` one decides does. */
  get root(): Resolver {
    return this.target.kind === 'at' ? this.target.done.root : this;
  }
}
