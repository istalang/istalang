/**
 * What each entry asks of the tables: every function, type, constant and module an entry's lowering
 * or a type entry's layout asks for, in the order first asked, whether it was there already or not.
 * A program reusing an entry another lowered (std-lowering.ts) asks for the same again, in the same
 * order, so its tables number and lay out exactly what lowering the entry itself would have.
 *
 * - A request goes to the entry being lowered or laid out; one made outside every entry, as `lower`
 *   lists the starts, belongs to none.
 * - What the tables compute once and keep (an instance's sharing) is captured, so a later ask that
 *   reuses the result records the requests computing it made.
 */

import type { Renumbering } from '../../../definition/references.ts';
import { memo } from '../../../foundation/structures/memo.ts';
import { withPushed } from '../../../foundation/structures/stack.ts';

/** A kind of table a request asks of, as references are renumbered by. */
export type RequestKind = keyof Renumbering;

/** A request for an entry of a table, by its index there. */
export interface TableRequest {
  readonly kind: RequestKind;
  readonly index: number;
}

/** What a list of requests belongs to: a function entry's lowering, or a type entry's layout. */
export interface RequestOwner {
  readonly kind: 'function' | 'type';
  readonly index: number;
}

/** Each request kind's place in a request's code, which tells requests apart in one number. */
const kindCodes: Readonly<Record<RequestKind, number>> = {
  function: 0,
  type: 1,
  constant: 2,
  module: 3,
};

const kindCount = Object.keys(kindCodes).length;

/** One owner's requests, each recorded once, by its code. */
interface RequestList {
  readonly requests: TableRequest[];
  readonly codes: Set<number>;
}

function requestList(): RequestList {
  return { requests: [], codes: new Set() };
}

/** Adds `request` to `list` unless it holds it already. */
function addTo(list: RequestList | undefined, request: TableRequest): void {
  const code = request.index * kindCount + kindCodes[request.kind];
  if (list !== undefined && !list.codes.has(code)) {
    list.codes.add(code);
    list.requests.push(request);
  }
}

export class TableRequests {
  readonly #lists = {
    function: new Map<number, RequestList>(),
    type: new Map<number, RequestList>(),
  };
  /** The lists of the entries being lowered or laid out, the innermost last. */
  readonly #working: RequestList[] = [];

  /** Records a request for entry `index` of the `kind` table, made by the entry `during` runs. */
  record(kind: RequestKind, index: number): void {
    addTo(this.#working.at(-1), { kind, index });
  }

  /** What `run` gives, its requests recorded as `owner`'s. */
  during<T>(owner: RequestOwner, run: () => T): T {
    const list = memo(this.#lists[owner.kind], owner.index, requestList);
    return withPushed(this.#working, list, run);
  }

  /** What `run` gives with the requests it made, which are also the current entry's. */
  captured<T>(run: () => T): { readonly result: T; readonly requests: readonly TableRequest[] } {
    const list = requestList();
    const result = withPushed(this.#working, list, run);
    this.replayed(list.requests);
    return { result, requests: list.requests };
  }

  /** Records `requests` again, as the current entry's. */
  replayed(requests: readonly TableRequest[]): void {
    const current = this.#working.at(-1);
    for (const request of requests) {
      addTo(current, request);
    }
  }

  /** The requests `owner` made, in the order first made. */
  of(owner: RequestOwner): readonly TableRequest[] {
    return this.#lists[owner.kind].get(owner.index)?.requests ?? [];
  }
}
