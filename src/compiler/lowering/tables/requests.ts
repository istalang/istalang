/**
 * What each entry asks of the tables: the set of functions, types, constants and modules an
 * entry's lowering or a type entry's layout asks for, whether they were there already or not. A
 * program reusing an entry another lowered (std-lowering.ts) asks for the same set again, so its
 * tables hold exactly what lowering the entry itself would have put there; in what order is no
 * matter, since a Definition never shows which entry lowering reached first.
 *
 * - A request goes to the entry being lowered or laid out; one made outside every entry, as `lower`
 *   lists the starts, belongs to none.
 * - What the tables compute once and keep (an instance's sharing) is captured, so a later ask that
 *   reuses the result records the requests computing it made.
 */

import type { Renumbering } from '../../../definition/references.ts';
import { memo } from '../../../foundation/structures/memo.ts';
import { withPushed } from '../../../foundation/structures/stack.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';

/** A kind of table a request asks of, as references are renumbered by. */
export type RequestKind = keyof Renumbering;

/** A request for an entry of a table, by its index there. */
export interface TableRequest {
  readonly kind: RequestKind;
  readonly index: number;
}

/** What a set of requests belongs to: a function entry's lowering, or a type entry's layout. */
export interface RequestOwner {
  readonly kind: 'function' | 'type';
  readonly index: number;
}

/** Each request kind, by its place in a request's code, which tells requests apart in one number. */
const kinds: readonly RequestKind[] = ['function', 'type', 'constant', 'module'];

/** One owner's requests, each by its code. */
type RequestSet = Set<number>;

function codeOf({ kind, index }: TableRequest): number {
  return index * kinds.length + kinds.indexOf(kind);
}

function requestOf(code: number): TableRequest {
  const kind = kinds[code % kinds.length] ?? unreachable(`${String(code)} codes no request.`);
  return { kind, index: Math.floor(code / kinds.length) };
}

export class TableRequests {
  readonly #sets = { function: new Map<number, RequestSet>(), type: new Map<number, RequestSet>() };
  /** The sets of the entries being lowered or laid out, the innermost last. */
  readonly #working: RequestSet[] = [];

  /** Records a request for entry `index` of the `kind` table, made by the entry `during` runs. */
  record(kind: RequestKind, index: number): void {
    this.#working.at(-1)?.add(codeOf({ kind, index }));
  }

  /** What `run` gives, its requests recorded as `owner`'s. */
  during<T>(owner: RequestOwner, run: () => T): T {
    const set = memo(this.#sets[owner.kind], owner.index, () => new Set<number>());
    return withPushed(this.#working, set, run);
  }

  /** What `run` gives with the requests it made, which are also the current entry's. */
  captured<T>(run: () => T): { readonly result: T; readonly requests: readonly TableRequest[] } {
    const set = new Set<number>();
    const result = withPushed(this.#working, set, run);
    const requests = [...set].map(requestOf);
    this.replayed(requests);
    return { result, requests };
  }

  /** Records `requests` again, as the current entry's. */
  replayed(requests: readonly TableRequest[]): void {
    for (const request of requests) {
      this.#working.at(-1)?.add(codeOf(request));
    }
  }

  /** The requests `owner` made. */
  of(owner: RequestOwner): readonly TableRequest[] {
    return [...(this.#sets[owner.kind].get(owner.index) ?? [])].map(requestOf);
  }
}
