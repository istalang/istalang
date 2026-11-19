/**
 * Passes (§11.2): a field loop's body is checked once per field it visits, as the body written out
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
 *   (`hold`), then a diagnostic several made is reported once, and a case no value reaches only
 *   when no pass reaches it (`settled`).
 * - A loop over a type's keys declares its key as a type (§8.1), which each pass binds to its own
 *   (`keyBinding`): the body's types are resolved once for the whole program, so the body reads
 *   each through the bindings of the passes it is in (`Pass.binds`).
 */

import type { Diagnostic } from '../../../foundation/diagnostics/diagnostic.ts';
import { memo } from '../../../foundation/structures/memo.ts';
import type { FieldLoopHeader } from '../../syntax/expressions/index.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { type Substitution, substitute } from '../types/parts/substitution.ts';
import type { Type } from '../types/type/index.ts';
import type { TypeRules } from '../types/type/type-rules.ts';

/**
 * One checking of a field loop's body, inside `outer`; the body itself has none. What it and the
 * passes around it bind (`binds`).
 */
export interface Pass {
  readonly outer: Pass | undefined;
  readonly binds: Substitution;
}

/** The passes of one body: the root, and the one being checked. */
export class Passes {
  readonly root: Pass = { outer: undefined, binds: new Map() };
  #current: Pass = this.root;
  readonly #held = new Map<Pass, Diagnostic<AnchoredSpan>[]>();

  get current(): Pass {
    return this.#current;
  }

  /** `type` as the pass being checked reads it: what it and the passes around it bind, bound. */
  bound(type: Type, rules: TypeRules): Type {
    const { binds } = this.#current;
    return binds.size === 0 ? type : substitute(type, binds, rules);
  }

  /**
   * Runs `check` as a new pass inside the current one, binding what `binds` binds; that pass, whose
   * records it made.
   */
  check(check: () => void, binds: Substitution): Pass {
    const outer = this.#current;
    const pass = {
      outer,
      binds: binds.size === 0 ? outer.binds : new Map([...outer.binds, ...binds]),
    };
    this.#current = pass;
    try {
      check();
    } finally {
      this.#current = outer;
    }
    return pass;
  }

  /**
   * Checks each of `items` in a pass of its own (`check`), binding what `binds` says it binds, then
   * reports what the passes settle on; each item comes back with its pass, and `inEach` runs back in
   * each pass what is decided of all of them together, reporting what that settles on in turn.
   */
  checkEach<Item>(
    items: readonly Item[],
    check: (item: Item) => void,
    report: (diagnostic: Diagnostic<AnchoredSpan>) => void,
    binds: (item: Item) => Substitution,
  ): {
    readonly checked: readonly (Item & { readonly pass: Pass })[];
    readonly inEach: (run: (item: Item, index: number) => void) => void;
  } {
    const checked = items.map((item) => ({
      ...item,
      pass: this.check(() => check(item), binds(item)),
    }));
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
   * last settled, except one about code that never runs, which holds of the loop only when every
   * pass made it (§11.2): a case or a branch one field's pass never reaches, another's may.
   */
  settled(passes: readonly Pass[]): readonly Diagnostic<AnchoredSpan>[] {
    const made = passes.map((pass) => this.#held.get(pass) ?? []);
    for (const pass of passes) {
      this.#held.delete(pass);
    }
    const kept: Diagnostic<AnchoredSpan>[] = [];
    for (const diagnostic of made.flat()) {
      const holds =
        !neverRunCodes.has(diagnostic.code) ||
        made.every((each) => each.some((other) => sameDiagnostic(other, diagnostic)));
      if (holds && !kept.some((other) => sameDiagnostic(other, diagnostic))) {
        kept.push(diagnostic);
      }
    }
    return kept;
  }
}

/**
 * The codes of code that never runs, a case no value reaches or a branch a decided condition rules
 * out, which a loop reports only when every pass does.
 */
const neverRunCodes = new Set<number>([
  checkerDiagnostics.unreachableCase.code,
  checkerDiagnostics.decidedCondition.code,
  checkerDiagnostics.heldNoValue.code,
]);

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
 * Which fields one checking of a field loop's body is for (§11.2): the field `name` names, its key
 * that field's name as a literal type and its value that field's type; every field a struct
 * constraint leaves unnamed at once, its key a member parameter keyed by the loop's header, which
 * each instantiated field gives its own literal, and its value the field that key names; or none,
 * for a subject with no field to visit, whose body is checked once as code that never runs, so only
 * the mistakes that don't depend on a field are reported: over a struct with none or a value that
 * can't exist, its key and value of type `Never`; over a subject already reported, the error type.
 */
type PassVisits =
  | { readonly kind: 'field'; readonly name: string }
  | { readonly kind: 'others' }
  | { readonly kind: 'none' };

/** One checking of a field loop's body: the fields it is for, and its key and value there. */
export interface FieldPassType {
  readonly visits: PassVisits;
  readonly key: Type;
  readonly value: Type;
}

/**
 * What a pass of the loop `header` heads binds: over a type's keys, the key it declares to the
 * pass's (§11.2); over a value's fields nothing, its key a variable.
 */
export function keyBinding(header: FieldLoopHeader, pass: FieldPassType): Substitution {
  return header.kind === 'TypeParameter' ? new Map([[header, pass.key]]) : new Map();
}
