/**
 * The fields the heap finds objects by (heap.ts): each index files the objects of one kind under
 * keys derived from the object alone, never from an execution's frames, which change in place, so
 * the heap's `add`, `replace` and `remove` keep every one exact.
 */

import type { LiveKind, LiveObject, LiveObjectOf } from './heap.ts';

/** A field the heap finds objects of `kind` by: each such object's keys, derived from it alone. */
interface Index<Kind extends LiveKind, Key> {
  readonly kind: Kind;
  readonly keys: (object: LiveObjectOf<Kind>) => readonly Key[];
}

function index<Kind extends LiveKind, Key>(
  kind: Kind,
  keys: (object: LiveObjectOf<Kind>) => readonly Key[],
): Index<Kind, Key> {
  return { kind, keys };
}

export const indexes = {
  /**
   * Every execution, by the call future its return resolves: the root's, which has none, is
   * undefined.
   */
  executions: index('execution', (execution) => [execution.resolves]),
  /** Each weak reference, by its referent while it has one. */
  weakRefs: index('weakRef', (weak) => (typeof weak.target === 'number' ? [weak.target] : [])),
  /** Each pending `disposed()` watch, by the weak reference it is on. */
  watches: index('future', ({ state }) => (state.kind === 'disposed' ? [state.weakRef] : [])),
  /** Each pending future filled from outside, a mock's answer or a host's promise, by its token. */
  hostFutures: index('future', ({ state }) => (state.kind === 'host' ? [state.token] : [])),
  /** Each pending timer, watch and future filled from outside, by its state's kind. */
  pending: index('future', ({ state }) =>
    state.kind === 'timer' || state.kind === 'watch' || state.kind === 'host' ? [state.kind] : [],
  ),
  /** Each held mock, by the function it replaces. */
  mocks: index('mock', (mock) => [mock.target]),
  /** Each answer to another instance's call, by the future it waits on. */
  answers: index('answer', (answer) => [answer.future]),
  /** Each pending resolver registered on a future, by every future it is registered on. */
  resolvers: index('resolver', ({ state }) => (state.kind === 'pending' ? state.on : [])),
  /** Each pending resolver of a wait's case, by that wait. */
  cases: index('resolver', ({ state }) =>
    state.kind === 'pending' && state.target.kind === 'case' ? [state.target.wait] : [],
  ),
  /** Each context constant's value, by the constant's qualified name (spec §3.4). */
  contextConstants: index('contextConstant', (constant) => [constant.key]),
  /** Each pending `Resolver.at` resolver, by the resolver it decides. */
  positions: index('resolver', ({ state }) =>
    state.kind === 'pending' && state.target.kind === 'at' ? [state.target.done] : [],
  ),
};

export type Indexes = typeof indexes;

export type IndexName = keyof Indexes;

export type IndexKey<Name extends IndexName> = ReturnType<Indexes[Name]['keys']>[number];

export const indexNames = Object.keys(indexes) as IndexName[];

/** The indexes `Heap.#indexedHolds` finds a holder's edges by, each keyed by that holder's id. */
export const readIndexes: ReadonlySet<IndexName> = new Set(['resolvers', 'cases', 'positions']);

/** Every key `object` has, with the index it has it in. */
export function keysOf(object: LiveObject): readonly (readonly [IndexName, unknown])[] {
  return indexNames.flatMap((name) => {
    const { kind, keys } = indexes[name] as Index<LiveKind, unknown>;
    return kind === object.kind ? keys(object).map((key) => [name, key] as const) : [];
  });
}
