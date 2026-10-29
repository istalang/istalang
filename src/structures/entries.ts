/**
 * Results computed once per key, each kept as an entry with what it read while it computed: the
 * other entries it asked for, and the notes it made (a checker's diagnostics). An answer is then a
 * function of what its entry read, never of who asked first, which is what lets a later revision
 * take entries over (docs/work/m6-m7/incremental-checking.md).
 *
 * - One `Entries` holds every table of a revision and one stack of the entries computing now, so
 *   an entry reached again while it computes closes a cycle whichever tables the cycle runs
 *   through.
 * - A cycle's members are the entries of a strongly connected component of what read what
 *   (Tarjan's algorithm, run as entries compute): every entry from the one reached again to the top
 *   of the stack, and every entry that reads a member before the component closes. A member
 *   answers its table's stand-in, which is also what reaching a running entry answers, so every
 *   member sees every other as its stand-in whichever was entered first. A table without a
 *   stand-in may still have members (they keep their values), but reaching one of its entries
 *   while it computes is a broken invariant.
 * - A note belongs to the entry computing when it is made, so notes are kept per entry and read
 *   back by walking what an entry read; a note made outside every entry is a broken invariant.
 */

import { unreachable } from './unreachable.ts';

/** How a table's entries answer in a cycle. */
export interface Cyclic<Key, Value> {
  /**
   * What an entry answers while it computes, and for good once it is found in a cycle: made once
   * per entry, when first needed, in the entry that needs it.
   */
  readonly standIn: (key: Key) => Value;
  /** Reports one member of a cycle, once, inside the member's own entry. */
  readonly reportMember?: (key: Key) => void;
}

/** One kind of result, by key, computed once in its revision. */
export interface EntryTable<Note, Key, Value> {
  /** `key`'s answer: computed by `compute` the first time it is asked for, read afterwards. */
  readonly get: (key: Key, compute: () => Value) => Value;
  /** `key`'s answer, read as `get` reads it, if it was ever asked for; else undefined. */
  readonly computed: (key: Key) => Value | undefined;
  /** The notes of `key`'s entry and of every entry it read, transitively. */
  readonly notesFrom: (key: Key) => readonly Note[];
}

interface Entry<Note> {
  readonly key: unknown;
  /** What the entry answers in a cycle, from its table, made once when first needed. */
  readonly standIn: (() => unknown) | undefined;
  madeStandIn?: { readonly value: unknown };
  value: unknown;
  running: boolean;
  /** The entries it read, in the order first read. */
  readonly reads: Set<Entry<Note>>;
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

/** Every table of one revision, and the entries computing now. */
export class Entries<Note> {
  /** The entries computing now, innermost last. */
  readonly #running: Entry<Note>[] = [];
  /** Tarjan's stack: the running entries and the computed ones whose component is still open. */
  readonly #open: Entry<Note>[] = [];
  #started = 0;

  /** A table of this revision; `cyclic` says how its entries answer in a cycle. */
  table<Key, Value>(cyclic?: Cyclic<Key, Value>): EntryTable<Note, Key, Value> {
    const computed = new Map<Key, Entry<Note>>();
    const found = (key: Key): Entry<Note> | undefined => computed.get(key);
    return {
      get: (key, compute) => {
        const entry = found(key);
        if (entry !== undefined) {
          return this.#read(entry) as Value;
        }
        const started = this.#start(
          key,
          cyclic === undefined ? undefined : () => cyclic.standIn(key),
        );
        computed.set(key, started);
        try {
          return this.#compute(started, compute, () => cyclic?.reportMember?.(key)) as Value;
        } catch (error) {
          computed.delete(key);
          throw error;
        }
      },
      computed: (key) => {
        const entry = found(key);
        return entry === undefined ? undefined : (this.#read(entry) as Value);
      },
      notesFrom: (key) => {
        const entry = found(key);
        return entry === undefined
          ? unreachable('Notes were read from an entry never asked for.')
          : notesFrom(entry);
      },
    };
  }

  /** Adds `note` to the entry computing now. */
  note(note: Note): void {
    const running = this.#running.at(-1);
    if (running === undefined) {
      unreachable('A note was made outside every entry.');
    }
    running.notes.push(note);
  }

  /** The notes the entry computing now has made itself, so far. */
  notesMade(): readonly Note[] {
    return this.#running.at(-1)?.notes ?? unreachable('Notes were read outside every entry.');
  }

  /** The notes of the entry computing now and of every entry it has read so far. */
  notesReached(): readonly Note[] {
    const running = this.#running.at(-1);
    return running === undefined
      ? unreachable('Notes were read outside every entry.')
      : notesFrom(running);
  }

  /** Records that the entry computing now, if any, read `target`, and answers what it reads. */
  #read(target: Entry<Note>): unknown {
    const reader = this.#running.at(-1);
    if (reader !== undefined) {
      reader.reads.add(target);
      if (target.open) {
        reader.lowest = Math.min(reader.lowest, target.order);
      }
    }
    if (target.running) {
      target.reachedRunning = true;
    }
    return answerOf(target);
  }

  /** A new entry of `key`, read by the entry computing now, if any. */
  #start(key: unknown, standIn: (() => unknown) | undefined): Entry<Note> {
    const entry: Entry<Note> = {
      key,
      standIn,
      value: undefined,
      running: true,
      reads: new Set(),
      notes: [],
      order: this.#started,
      lowest: this.#started,
      open: true,
      reachedRunning: false,
      member: false,
    };
    this.#started += 1;
    this.#running.at(-1)?.reads.add(entry);
    return entry;
  }

  /**
   * Computes `entry` with `compute` and answers it to the entry that asked; a member of a cycle
   * is reported by `reportMember`, inside itself.
   */
  #compute(entry: Entry<Note>, compute: () => unknown, reportMember: () => void): unknown {
    const reader = this.#running.at(-1);
    const depth = this.#open.length;
    this.#running.push(entry);
    this.#open.push(entry);
    try {
      entry.value = compute();
      entry.member = entry.lowest < entry.order || entry.reachedRunning;
      if (entry.member) {
        reportMember();
      }
    } catch (error) {
      this.#close(depth);
      throw error;
    } finally {
      this.#running.pop();
      entry.running = false;
    }
    if (reader !== undefined) {
      reader.lowest = Math.min(reader.lowest, entry.lowest);
    }
    if (entry.lowest === entry.order) {
      this.#close(depth);
    }
    return answerOf(entry);
  }

  /** Closes the component made of the open entries from `depth` up. */
  #close(depth: number): void {
    for (const each of this.#open.splice(depth)) {
      each.open = false;
    }
  }
}

/** What `entry` answers: its stand-in while it computes or once found in a cycle, else its value. */
function answerOf<Note>(entry: Entry<Note>): unknown {
  if (!(entry.running || entry.member)) {
    return entry.value;
  }
  if (entry.standIn !== undefined) {
    entry.madeStandIn ??= { value: entry.standIn() };
    return entry.madeStandIn.value;
  }
  return entry.running
    ? unreachable('An entry was reached again while it computed, in a table with no stand-in.')
    : entry.value;
}

/** The notes of `entry` and of every entry it read, transitively, each entry once. */
function notesFrom<Note>(entry: Entry<Note>): readonly Note[] {
  const seen = new Set<Entry<Note>>([entry]);
  const pending = [entry];
  const notes: Note[] = [];
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
