/**
 * Passes (§4): a field loop's body is checked once per field it visits, as the body written out
 * once per field, so what checking records of a node inside it is recorded per pass, and lowering
 * writes each pass's code from that pass's records (CheckedBody `passesOf`).
 *
 * - A pass is one checking of a field loop's body; the body itself is the root pass. Passes nest as
 *   field loops do.
 * - A record of a node, its type, its call or its pattern, goes to the pass being checked
 *   (`PassTable`); reading one sees that pass, then the passes around it, so a node outside the
 *   loop answers inside it, while a node inside it answers only in its own passes. Every unit's
 *   records of nodes are tables of the body's `Passes`, so no unit needs to know of loops.
 * - A fact every pass shares stays out of the tables: whether a `let` changes or lives in a cell,
 *   which loop a `break` leaves, what a function returns. Their units keep plain sets.
 * - What reads a body whole, the calls it makes or the rules over every call, reads every pass's
 *   records (`entries`).
 * - Each pass checks the same text, so what passes report waits for the loop's passes to be checked
 *   (`hold`), then a diagnostic several made is reported once, and a case no value reaches only when
 *   no pass reaches it (`settled`).
 */

import type { Diagnostic } from '../../diagnostics/diagnostic.ts';
import { memo } from '../../structures/memo.ts';
import type { AnchoredSpan } from '../syntax/positions.ts';
import { checkerDiagnostics } from './diagnostics/index.ts';
import type { Type } from './types/type.ts';

/** One checking of a field loop's body, inside `outer`; the body itself has none. */
export interface Pass {
  readonly outer: Pass | undefined;
}

/** The passes of one body: the root, and the one being checked. */
export class Passes {
  readonly root: Pass = { outer: undefined };
  #current: Pass = this.root;
  readonly #held = new Map<Pass, Diagnostic<AnchoredSpan>[]>();

  get current(): Pass {
    return this.#current;
  }

  /** Runs `check` as a new pass inside the current one; that pass, whose records it made. */
  check(check: () => void): Pass {
    const outer = this.#current;
    const pass = { outer };
    this.#current = pass;
    try {
      check();
    } finally {
      this.#current = outer;
    }
    return pass;
  }

  /**
   * Checks each of `items` in a pass of its own (`check`), then reports what the passes settle on;
   * each item comes back with its pass, and `inEach` runs back in each pass what is decided of all
   * of them together, reporting what that settles on in turn.
   */
  checkEach<Item>(
    items: readonly Item[],
    check: (item: Item) => void,
    report: (diagnostic: Diagnostic<AnchoredSpan>) => void,
  ): {
    readonly checked: readonly (Item & { readonly pass: Pass })[];
    readonly inEach: (run: (item: Item, index: number) => void) => void;
  } {
    const checked = items.map((item) => ({ ...item, pass: this.check(() => check(item)) }));
    const settle = () => {
      for (const diagnostic of this.settled(checked.map(({ pass }) => pass))) {
        report(diagnostic);
      }
    };
    settle();
    const inEach = (run: (item: Item, index: number) => void) => {
      for (const [index, item] of items.entries()) {
        const pass = checked[index]?.pass ?? this.root;
        this.#within(pass, () => run(item, index));
      }
      settle();
    };
    return { checked, inEach };
  }

  /** Runs `run` back in `pass`, so what it records and reports belongs to that pass. */
  #within(pass: Pass, run: () => void): void {
    const outer = this.#current;
    this.#current = pass;
    try {
      run();
    } finally {
      this.#current = outer;
    }
  }

  /** A table of records by node, kept per pass. */
  table<Key, Value>(): PassTable<Key, Value> {
    return passTable(this);
  }

  /**
   * Whether `diagnostic` waits for the passes of its loop to be settled (`settled`): one reported
   * while a pass is checked.
   */
  hold(diagnostic: Diagnostic<AnchoredSpan>): boolean {
    if (this.#current === this.root) {
      return false;
    }
    memo(this.#held, this.#current, () => []).push(diagnostic);
    return true;
  }

  /**
   * What the passes of one loop report, once each: every diagnostic a pass made since they were
   * last settled, except one about a case no value reaches, which holds of the loop only when every
   * pass made it (§4): a case one field's pass never reaches, another's may.
   */
  settled(passes: readonly Pass[]): readonly Diagnostic<AnchoredSpan>[] {
    const made = passes.map((pass) => this.#held.get(pass) ?? []);
    for (const pass of passes) {
      this.#held.delete(pass);
    }
    const kept: Diagnostic<AnchoredSpan>[] = [];
    for (const diagnostic of made.flat()) {
      const holds =
        diagnostic.code !== unreachableCase ||
        made.every((each) => each.some((other) => sameDiagnostic(other, diagnostic)));
      if (holds && !kept.some((other) => sameDiagnostic(other, diagnostic))) {
        kept.push(diagnostic);
      }
    }
    return kept;
  }
}

/** The code of a case no value reaches, which a loop reports only when every pass does. */
const unreachableCase = checkerDiagnostics.unreachableCase.code;

/** Whether two diagnostics say one thing: their code and message, at one place. */
function sameDiagnostic(one: Diagnostic<AnchoredSpan>, other: Diagnostic<AnchoredSpan>): boolean {
  return (
    one.code === other.code &&
    one.message === other.message &&
    one.span.segment === other.span.segment &&
    one.span.from === other.span.from &&
    one.span.to === other.span.to
  );
}

/** What a table answers at one pass: its records there and in the passes around it. */
export interface PassRecords<Key, Value> {
  readonly get: (key: Key) => Value | undefined;
  readonly has: (key: Key) => boolean;
}

/** Records by node, each kept in the pass that made it (the module's banner). */
export interface PassTable<Key, Value> {
  /** The record of `key` at `pass`, the current one unless given, or in a pass around it. */
  readonly get: (key: Key, pass?: Pass) => Value | undefined;
  readonly has: (key: Key, pass?: Pass) => boolean;
  /** Records `value` for `key` in the pass being checked. */
  readonly set: (key: Key, value: Value) => void;
  /** The table as `pass` sees it. */
  readonly at: (pass: Pass) => PassRecords<Key, Value>;
  /** Every record of every pass, for what reads a body whole. */
  readonly entries: () => readonly (readonly [Key, Value])[];
}

/** A table of records by node kept per pass of `passes`. */
function passTable<Key, Value>(passes: Passes): PassTable<Key, Value> {
  const records = new Map<Pass, Map<Key, Value>>();
  const get = (key: Key, pass: Pass = passes.current): Value | undefined => {
    for (let at: Pass | undefined = pass; at !== undefined; at = at.outer) {
      const value = records.get(at)?.get(key);
      if (value !== undefined) {
        return value;
      }
    }
    return undefined;
  };
  const has = (key: Key, pass?: Pass) => get(key, pass) !== undefined;
  return {
    get,
    has,
    set: (key, value) => {
      memo(records, passes.current, () => new Map<Key, Value>()).set(key, value);
    },
    at: (pass) => ({ get: (key) => get(key, pass), has: (key) => has(key, pass) }),
    entries: () => [...records.values()].flatMap((each) => [...each]),
  };
}

/**
 * One checking of a field loop's body (§4): for the field `field` names, its key that field's name
 * as a literal type and its value that field's type; or, with no `field`, for every field a struct
 * constraint leaves unnamed at once, its key a member parameter keyed by the loop's header, which
 * each instantiated field gives its own literal, and its value the field that key names.
 */
export interface FieldPassType {
  readonly field: string | undefined;
  readonly key: Type;
  readonly value: Type;
}
