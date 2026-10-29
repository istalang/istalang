/**
 * One result of a revision (index.ts) and the table it belongs to: what the entry read, in the
 * order it read it, with each answer; what it noted; and where it stands in Tarjan's search for
 * cycles. What an entry answers and what notes it reached are read off that record, here.
 */

import type { Equality } from '../equality.ts';
import { unreachable } from '../unreachable.ts';

/** How a table's entries answer in a cycle. */
interface Cyclic<Key, Value> {
  /**
   * What an entry answers while it computes, and for good once it is found in a cycle: made once
   * per entry, when first needed, in the entry that needs it.
   */
  readonly standIn: (key: Key) => Value;
  /** Reports one member of a cycle, once, inside the member's own entry. */
  readonly reportMember?: (key: Key) => void;
}

/** One kind of result: how it is named, computed and compared, and how it answers in a cycle. */
export interface TableOptions<Key, Value, Context> {
  /** Unique among a revision's tables: a later revision finds this one's entries by it. */
  readonly name: string;
  readonly compute: (key: Key, context: Context) => Value;
  /** Whether an answer computed again equals the one before; identity unless given. */
  readonly equal?: Equality<Value>;
  readonly cyclic?: Cyclic<Key, Value>;
}

export interface Table<Note> {
  readonly options: TableOptions<unknown, unknown, unknown>;
  readonly entries: Map<unknown, Entry<Note>>;
}

export interface Input {
  readonly read: (...args: readonly unknown[]) => unknown;
  readonly equal: Equality<unknown>;
}

export type Read<Note> =
  | { readonly kind: 'entry'; readonly entry: Entry<Note>; readonly answer: unknown }
  | {
      readonly kind: 'input';
      readonly input: string;
      readonly args: readonly unknown[];
      readonly answer: unknown;
    }
  | { readonly kind: 'notes'; readonly notes: readonly Note[] };

export interface Entry<Note> {
  readonly table: Table<Note>;
  readonly key: unknown;
  readonly context: unknown;
  madeStandIn?: { readonly value: unknown };
  value: unknown;
  running: boolean;
  /** The entries it read, for its notes and for Tarjan's. */
  readonly reads: Set<Entry<Note>>;
  /** Every read, in the order made, for a later revision to replay. */
  readonly log: Read<Note>[];
  readonly notes: Note[];
  /** Tarjan's: the order the entry started in, and the lowest order it reached on the stack. */
  readonly order: number;
  lowest: number;
  /** Whether it is on Tarjan's stack: computing, or computed in a component not closed yet. */
  open: boolean;
  /** Whether something read it while it computed. */
  reachedRunning: boolean;
  /** Whether it lies on a cycle, so that it answers its table's stand-in. */
  member: boolean;
}

/** Whether `entry`, done computing, lies on a cycle. */
export function isMember<Note>(entry: Entry<Note>): boolean {
  return entry.lowest < entry.order || entry.reachedRunning;
}

/** What `entry` answers: its stand-in while it computes or once found in a cycle, else its value. */
export function answerOf<Note>(entry: Entry<Note>): unknown {
  if (!(entry.running || entry.member)) {
    return entry.value;
  }
  const standIn = entry.table.options.cyclic?.standIn;
  if (standIn !== undefined) {
    entry.madeStandIn ??= { value: standIn(entry.key) };
    return entry.madeStandIn.value;
  }
  return entry.running
    ? unreachable('An entry was reached again while it computed, in a table with no stand-in.')
    : entry.value;
}

/** The notes of `entry` and of every entry it read, transitively, each entry once. */
export function notesFrom<Note>(entry: Entry<Note>): readonly Note[] {
  return [...entry.notes, ...notesOfReads(entry)];
}

/** The notes of every entry `entry` read, transitively, each entry once, its own left out. */
export function notesOfReads<Note>(entry: Entry<Note>): readonly Note[] {
  const seen = new Set<Entry<Note>>([entry]);
  const pending = [...entry.reads];
  const notes: Note[] = [];
  for (const read of pending) {
    seen.add(read);
  }
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    notes.push(...next.notes);
    for (const read of next.reads) {
      if (!seen.has(read)) {
        seen.add(read);
        pending.push(read);
      }
    }
  }
  return notes;
}
