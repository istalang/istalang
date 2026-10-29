/**
 * Results computed once per key, each kept as an entry with what it read while it computed, so a
 * later revision takes an entry over when every read still answers alike, and an answer never
 * depends on who asked first (docs/work/m6-m7/incremental-checking.md §1).
 *
 * - A table names one kind of result and computes it from a key, with the context the key was asked
 *   in (which the key decides), so any revision can compute any entry: also one a later revision
 *   asks for again while it verifies another.
 * - An entry logs its reads in the order made, each with the answer it got: the entries it asked
 *   for, the inputs it read (named reads of what a revision is computed over, such as a program),
 *   and the notes of what it had read so far.
 * - A revision made with a previous one takes an entry over by replaying its reads in order. The
 *   first answer its table or input doesn't count equal stops the replay, and the entry is computed
 *   instead. Everything before that read answered alike, so computing makes the same reads up to
 *   it: what replay did is neither wasted nor wrong. A read entry computed again and found equal
 *   ends the walk there (early cutoff), and the entries replay takes over join this revision.
 * - A cycle's members are the entries of a strongly connected component of what read what (Tarjan's
 *   algorithm, run as entries compute). A member answers its table's stand-in, which is also what
 *   reaching a running entry answers, so every member sees every other as its stand-in whichever
 *   was entered first. A member is never taken over: what it answers depends on its whole cycle.
 *   Reaching an entry of a table with no stand-in while it computes is a broken invariant.
 * - A note belongs to the entry computing when it is made, and is read back by walking what an
 *   entry read; a note made outside every entry is a broken invariant.
 */

import type { Equality } from '../equality.ts';
import { sameItems } from '../equality.ts';
import { unreachable } from '../unreachable.ts';
import {
  answerOf,
  type Entry,
  type Input,
  isMember,
  notesFrom,
  notesOfReads,
  type Read,
  type Table,
  type TableOptions,
} from './entry.ts';

/** One kind of result, by key, computed once in its revision. */
export interface EntryTable<Note, Key, Value, Context = void> {
  /** `key`'s answer: taken over or computed the first time it is asked for, read afterwards. */
  readonly get: (key: Key, context: Context) => Value;
  /** `key`'s answer, read as `get` reads it, if this revision ever had it; else undefined. */
  readonly computed: (key: Key) => Value | undefined;
  /** The notes of `key`'s entry and of every entry it read, transitively. */
  readonly notesFrom: (key: Key) => readonly Note[];
}

/** A named read of what a revision is computed over, recorded in the entry computing now. */
export interface InputOptions<Args extends readonly unknown[], Value> {
  /** Unique among a revision's inputs: a later revision replays this one's reads by it. */
  readonly name: string;
  readonly read: (...args: Args) => Value;
  /** Whether a later revision's answer equals this one's; identity unless given. */
  readonly equal?: Equality<Value>;
}

/** What a revision is made from. */
export interface RevisionOptions<Note> {
  /** The revision whose entries this one may take over. */
  readonly previous?: Entries<Note> | undefined;
  /** Called each time an entry is computed rather than taken over: a seam for tests to count. */
  readonly observe?: ((table: string, key: unknown) => void) | undefined;
}

const sameNotes = sameItems<unknown>();

/** Every table and input of one revision, and the entries computing now. */
export class Entries<Note> {
  #previous: Entries<Note> | undefined;
  readonly #observe: ((table: string, key: unknown) => void) | undefined;
  readonly #tables = new Map<string, Table<Note>>();
  readonly #inputs = new Map<string, Input>();
  /** The entries computing now, innermost last. */
  readonly #running: Entry<Note>[] = [];
  /** Tarjan's stack: the running entries and the computed ones whose component is still open. */
  readonly #open: Entry<Note>[] = [];
  #started = 0;

  constructor({ previous, observe }: RevisionOptions<Note> = {}) {
    this.#previous = previous;
    this.#observe = observe;
  }

  /** A table of this revision. */
  table<Key, Value, Context = void>(
    options: TableOptions<Key, Value, Context>,
  ): EntryTable<Note, Key, Value, Context> {
    const table: Table<Note> = {
      options: options as TableOptions<unknown, unknown, unknown>,
      entries: new Map(),
    };
    register(this.#tables, options.name, table);
    return {
      get: (key, context) => this.#get(table, key, context) as Value,
      computed: (key) => {
        const entry = table.entries.get(key);
        return entry === undefined ? undefined : (this.#read(entry) as Value);
      },
      notesFrom: (key) => {
        const entry = table.entries.get(key);
        return entry === undefined
          ? unreachable('Notes were read from an entry never asked for.')
          : notesFrom(entry);
      },
    };
  }

  /** An input of this revision: `options.read`, each answer recorded in the entry computing now. */
  input<Args extends readonly unknown[], Value>(
    options: InputOptions<Args, Value>,
  ): (...args: Args) => Value {
    const input: Input = {
      read: options.read as Input['read'],
      equal: (options.equal ?? Object.is) as Equality<unknown>,
    };
    register(this.#inputs, options.name, input);
    return (...args) => this.#readInput(options.name, input, args) as Value;
  }

  /** Lets go of the previous revision: entries this one hasn't taken over are computed anew. */
  release(): void {
    this.#previous = undefined;
  }

  /** Adds `note` to the entry computing now. */
  note(note: Note): void {
    this.#current().notes.push(note);
  }

  /** The notes the entry computing now has made itself, so far. */
  notesMade(): readonly Note[] {
    return this.#current().notes;
  }

  /**
   * The notes of the entry computing now and of every entry it has read so far. What it read
   * noted is a read of its own, which a later revision replays.
   */
  notesReached(): readonly Note[] {
    return [...this.#current().notes, ...this.#readNotes()];
  }

  /** The notes of every entry the entry computing now has read so far, logged as its read. */
  #readNotes(): readonly Note[] {
    const running = this.#current();
    const notes = notesOfReads(running);
    running.log.push({ kind: 'notes', notes });
    return notes;
  }

  #current(): Entry<Note> {
    return this.#running.at(-1) ?? unreachable('A note was made or read outside every entry.');
  }

  #get(table: Table<Note>, key: unknown, context: unknown): unknown {
    const found = table.entries.get(key);
    if (found !== undefined) {
      return this.#read(found);
    }
    const started = this.#start(table, key, context);
    table.entries.set(key, started);
    try {
      return this.#produce(started);
    } catch (error) {
      table.entries.delete(key);
      throw error;
    }
  }

  #readInput(name: string, input: Input, args: readonly unknown[]): unknown {
    const answer = input.read(...args);
    this.#running.at(-1)?.log.push({ kind: 'input', input: name, args, answer });
    return answer;
  }

  /** Records that the entry computing now, if any, read `target`, and answers what it reads. */
  #read(target: Entry<Note>): unknown {
    const reader = this.#running.at(-1);
    const first = reader !== undefined && !reader.reads.has(target);
    if (reader !== undefined) {
      reader.reads.add(target);
      if (target.open) {
        reader.lowest = Math.min(reader.lowest, target.order);
      }
    }
    if (target.running) {
      target.reachedRunning = true;
    }
    const answer = answerOf(target);
    if (first) {
      reader.log.push({ kind: 'entry', entry: target, answer });
    }
    return answer;
  }

  /** A new entry of `key`, read by the entry computing now, if any. */
  #start(table: Table<Note>, key: unknown, context: unknown): Entry<Note> {
    const entry: Entry<Note> = {
      table,
      key,
      context,
      value: undefined,
      running: true,
      reads: new Set(),
      log: [],
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
   * Takes `entry` over from the previous revision, or computes it, and answers it to the entry that
   * asked; a member of a cycle is reported by its table, inside itself.
   */
  #produce(entry: Entry<Note>): unknown {
    const reader = this.#running.at(-1);
    const depth = this.#open.length;
    const { options } = entry.table;
    this.#running.push(entry);
    this.#open.push(entry);
    try {
      if (!this.#takeOver(entry)) {
        this.#observe?.(options.name, entry.key);
        entry.value = options.compute(entry.key, entry.context);
        entry.member = isMember(entry);
        if (entry.member) {
          options.cyclic?.reportMember?.(entry.key);
        }
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
    const answer = answerOf(entry);
    reader?.log.push({ kind: 'entry', entry, answer });
    return answer;
  }

  /**
   * Whether `entry`, running, took over its previous revision's: every read replayed alike, and
   * nothing it replayed reached back to it. Otherwise it is left to compute, its replay dropped.
   */
  #takeOver(entry: Entry<Note>): boolean {
    const before =
      this.#previous === undefined
        ? undefined
        : this.#previous.#takeable(entry.table.options.name, entry.key);
    if (before === undefined) {
      return false;
    }
    if (before.log.every((read) => this.#replays(read)) && !isMember(entry)) {
      entry.value = before.value;
      entry.notes.push(...before.notes);
      return true;
    }
    entry.reads.clear();
    entry.log.length = 0;
    return false;
  }

  /** Whether `read` answers in this revision what it answered when it was made. */
  #replays(read: Read<Note>): boolean {
    switch (read.kind) {
      case 'entry': {
        const { name, equal = Object.is } = read.entry.table.options;
        const table = this.#tables.get(name) ?? unreachable(`No table is named ${name}.`);
        return equal(read.answer, this.#get(table, read.entry.key, read.entry.context));
      }
      case 'input': {
        const input =
          this.#inputs.get(read.input) ?? unreachable(`No input is named ${read.input}.`);
        return input.equal(read.answer, this.#readInput(read.input, input, read.args));
      }
      case 'notes':
        return sameNotes(read.notes, this.#readNotes());
      default: {
        const unhandled: never = read;
        return unhandled;
      }
    }
  }

  /** The entry of `key` in the table named `name`, if a later revision may take it over. */
  #takeable(name: string, key: unknown): Entry<Note> | undefined {
    const entry = this.#tables.get(name)?.entries.get(key);
    return entry === undefined || entry.running || entry.member ? undefined : entry;
  }

  /** Closes the component made of the open entries from `depth` up. */
  #close(depth: number): void {
    for (const each of this.#open.splice(depth)) {
      each.open = false;
    }
  }
}

function register<Value>(registry: Map<string, Value>, name: string, value: Value): void {
  if (registry.has(name)) {
    unreachable(`Two tables or inputs of one revision are named ${name}.`);
  }
  registry.set(name, value);
}
