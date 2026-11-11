/**
 * A wait's and a language resolver's shapes on the heap (proposal 8, Rule 5), and the lookups
 * among them, as the instance's waits read them: a resolver pending for a wait's case, a
 * `Resolver.at` position or a `Resolver.of` callback, or ended, resolved or cancelled.
 */

import type { Value } from '../../../../definition/values/values.ts';
import { unreachable } from '../../../../foundation/structures/unreachable.ts';
import { stoppedAt } from '../../../interpreter/suspension.ts';
import type { ResolverTarget } from '../../../snapshot/objects.ts';
import type { Heap, LiveExecution, LiveObjectOf } from '../heap.ts';

export type Wait = LiveObjectOf<'wait'>;

export type Resolver = LiveObjectOf<'resolver'>;

type PendingState = Extract<Resolver['state'], { readonly kind: 'pending' }>;

export type PendingResolver = Resolver & { readonly state: PendingState };

export type CaseTarget = Extract<ResolverTarget, { readonly kind: 'case' }>;

/** A pending resolver of a wait's case. */
export type CaseResolver = Resolver & {
  readonly state: PendingState & { readonly target: CaseTarget };
};

/** How a resolver ended: resolved, or cancelled. */
export type Ended = Exclude<Resolver['state'], PendingState>;

export function isPending(resolver: Resolver): resolver is PendingResolver {
  return resolver.state.kind === 'pending';
}

export function isCase(resolver: Resolver): resolver is CaseResolver {
  return resolver.state.kind === 'pending' && resolver.state.target.kind === 'case';
}

/**
 * The resolver `id`, which a pending `Resolver.at` one decides, so pending itself: deciding a
 * resolver cancels the `Resolver.at` ones deciding it.
 */
export function pendingOf(heap: Heap, id: number): PendingResolver {
  const resolver = heap.of(id, 'resolver');
  return isPending(resolver) ? resolver : unreachable(`Resolver ${id} decided already.`);
}

/**
 * What the pending `resolver` comes down to deciding: itself, or what the resolver a `Resolver.at`
 * one decides comes down to, pending as long as it is.
 */
export function rootOf(heap: Heap, resolver: PendingResolver): PendingResolver {
  let root = resolver;
  while (root.state.target.kind === 'at') {
    root = pendingOf(heap, root.state.target.done);
  }
  return root;
}

/** What a `Resolver.at` resolver decides its resolver with: `(position, value)`. */
export function positioned(position: bigint, value: Value): Value {
  return { kind: 'tuple', elements: [position, value] };
}

/**
 * The execution waiting on `wait`; none for a disposal's call run on a carrier of its own, which
 * isn't on the heap (../../segment/disposal-runs.ts) and never stops at a wait, since a `dispose`
 * can't await.
 */
export function waiterOf(heap: Heap, wait: Wait): LiveExecution | undefined {
  return heap.has(wait.waiter) ? heap.of(wait.waiter, 'execution') : undefined;
}

/** The wait `waiter` is stopped at, if it is. */
export function stoppedWait(heap: Heap, waiter: LiveExecution): Wait | undefined {
  const top = waiter.frames.at(-1);
  const id = top === undefined ? undefined : stoppedAt(top);
  return id === undefined ? undefined : heap.of(id, 'wait');
}

/** The resolvers of `wait`'s cases still pending. */
export function pendingCases(heap: Heap, wait: Pick<Wait, 'id'>): readonly CaseResolver[] {
  return heap.find('cases', wait.id).filter(isCase);
}
