/**
 * What a witness search finds, and the state it carries down the active stack (conformance.ts,
 * §3.5, §3.10): a witness, or why there is none. A search that fails has reported why at its use
 * site already; one reaching the depth bound counts as endless, which the root reports as such.
 *
 * - A search judges each goal once (`SearchGoals`): wrappers meeting a trait through the same
 *   constraint on what they wrap ask the same goals at every level, which would cost exponentially
 *   in their nesting. A search lives for one root check, so what it keeps is read inside the entry
 *   that asked (structures/entries), never across entries.
 * - A struct-constraint or union-member goal reached again while it runs counts as met
 *   (coinductive): a hypothesis. What a goal finds while a hypothesis holds is provisional until the
 *   goal holding it ends. Ended met, what rested on it rests on what that goal rested on, or on
 *   nothing; ended unmet, everything found while it ran is dropped, being found under a falsehood.
 *   A goal is kept by the lowest hypothesis it rests on, as Tarjan's lowlink.
 * - A goal running when the search reaches the depth bound keeps nothing: what it found depends on
 *   how deep it was asked. Otherwise an answer doesn't, so a goal's answer serves it at any depth.
 */

import { unreachable } from '../../../structures/unreachable.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import type { ResolvedCall } from '../surface/resolved-call.ts';
import type { TypeKeys } from '../types/identity/type-keys.ts';
import type { EntryRule, StructConstraintModel } from '../types/struct-constraint.ts';
import type { Constraint, Type } from '../types/type/index.ts';
import { typeText } from '../types/type-text.ts';
import type { UseSite } from '../use-site.ts';
import type { Meets } from './shortfalls.ts';

/** How deeply witness searches nest before one counts as endless. */
export const maximumDepth = 16;

/**
 * Why a search failed, after reporting it at its use site: `endless` when a witness search reached
 * the depth bound, which every level up reports as such, and `failed` for any other cause.
 */
export type Failure = 'failed' | 'endless';

export function isFailure<Found>(outcome: Found | Failure): outcome is Failure {
  return outcome === 'failed' || outcome === 'endless';
}

/**
 * What searching for a single required function's witness found: the call, nothing declared
 * (`none`), several candidates tying (`ambiguous`), a declared function giving another result
 * (`wrongResult`), or a declared function whose own instantiation failed (`failed` / `endless`).
 */
export type WitnessOutcome =
  | { readonly kind: 'call'; readonly call: ResolvedCall }
  | { readonly kind: 'none' }
  | { readonly kind: 'ambiguous' }
  | { readonly kind: 'wrongResult'; readonly required: Type; readonly given: Type }
  | { readonly kind: 'failed' }
  | { readonly kind: 'endless' };

/** What searching for a constraint's witnesses found, distinguishing an undeclared function from a failure. */
export type ConformanceOutcome =
  | { readonly kind: 'met'; readonly witnesses: readonly ResolvedCall[] }
  | { readonly kind: 'undeclared' }
  | { readonly kind: 'failed' };

/**
 * The state threaded down one conformance search: how deep it is, the goals it judges, and the
 * first trait search that hit `maximumDepth`.
 */
export interface Search {
  readonly depth: number;
  readonly goals: SearchGoals;
  endless?: { readonly type: Type; readonly constraint: Constraint } | undefined;
}

/** A fresh search at the root of a conformance check. */
export function startSearch(): Search {
  return { depth: 0, goals: new SearchGoals() };
}

/** `search` one level deeper, sharing its goals. */
export function deeper(search: Search): Search {
  return { depth: search.depth + 1, goals: search.goals };
}

/** What a search finds at the depth bound: endless, keeping nothing the goals running found. */
export function boundReached(search: Search): WitnessOutcome {
  search.goals.reachedBound();
  return { kind: 'endless' };
}

/** What a goal found: a trait's witnesses, or what a type lacks for a struct constraint or member trait. */
type Answer =
  | { readonly kind: 'witnesses'; readonly witnesses: readonly ResolvedCall[] | Failure }
  | { readonly kind: 'shortfall'; readonly shortfall: string | undefined };

/** An answer a search keeps, with the index of the running goal whose hypothesis it rests on. */
interface Kept {
  readonly answer: Answer;
  readonly restsOn: number | undefined;
}

/** A goal running in a search. */
interface RunningGoal {
  readonly index: number;
  /** How many kept answers were provisional when it started. */
  readonly provisionalBefore: number;
  /** The lowest index of a running goal whose hypothesis what it found rests on; its own if none. */
  lowest: number;
  /** Whether a goal inside it took it as met. */
  assumed: boolean;
  /** Whether the search reached the depth bound while it ran. */
  bounded: boolean;
}

/** The goals one search judges: the answers it keeps, and the goals running, outermost first. */
export class SearchGoals {
  readonly #kept = new Map<string, Kept>();
  /** The keys of kept answers resting on a hypothesis, in the order found. */
  readonly #provisional: string[] = [];
  readonly #running: RunningGoal[] = [];
  /** The struct-constraint and member goals running, met when reached again. */
  readonly #hypotheses = new Map<string, RunningGoal>();

  /** The witnesses of the trait goal `key`: kept, or `find`'s with the goal running. */
  witnesses(
    key: string,
    find: () => readonly ResolvedCall[] | Failure,
  ): readonly ResolvedCall[] | Failure {
    return witnessesIn(this.#solve(`meets ${key}`, () => true, witnessesFound(find)));
  }

  /** `witnesses`, finding a failure again so that the site asking reports why. */
  witnessesReported(
    key: string,
    find: () => readonly ResolvedCall[] | Failure,
  ): readonly ResolvedCall[] | Failure {
    const met = (answer: Answer) => answer.kind === 'witnesses' && !isFailure(answer.witnesses);
    return witnessesIn(this.#solve(`meets ${key}`, met, witnessesFound(find)));
  }

  /** What a type lacks for the struct-constraint or member goal `key`; none while it runs. */
  shortfall(key: string, step: () => string | undefined): string | undefined {
    const lacking = `lacks ${key}`;
    const hypothesis = this.#hypotheses.get(lacking);
    if (hypothesis !== undefined) {
      hypothesis.assumed = true;
      this.#restOn(hypothesis.index);
      return undefined;
    }
    const answer = this.#solve(
      lacking,
      () => true,
      (goal) => {
        this.#hypotheses.set(lacking, goal);
        try {
          return { kind: 'shortfall', shortfall: step() };
        } finally {
          this.#hypotheses.delete(lacking);
        }
      },
    );
    return answer.kind === 'shortfall' ? answer.shortfall : unreachable(`${key} is no shortfall.`);
  }

  /** Marks every goal running as having reached the depth bound. */
  reachedBound(): void {
    for (const goal of this.#running) {
      goal.bounded = true;
    }
  }

  /** The kept answer of `key` that `reusable` accepts, or `run`'s with `key` running. */
  #solve(
    key: string,
    reusable: (answer: Answer) => boolean,
    run: (goal: RunningGoal) => Answer,
  ): Answer {
    const kept = this.#kept.get(key);
    if (kept !== undefined && reusable(kept.answer)) {
      if (kept.restsOn !== undefined) {
        this.#restOn(kept.restsOn);
      }
      return kept.answer;
    }
    const index = this.#running.length;
    const goal: RunningGoal = {
      index,
      provisionalBefore: this.#provisional.length,
      lowest: index,
      assumed: false,
      bounded: false,
    };
    this.#running.push(goal);
    let answer: Answer;
    try {
      answer = run(goal);
    } finally {
      this.#running.pop();
    }
    this.#end(key, goal, answer);
    return answer;
  }

  /** Makes what the goal running now found rest on the hypothesis of the goal at `index`. */
  #restOn(index: number): void {
    const top = this.#running.at(-1) ?? unreachable('A hypothesis held outside every goal.');
    top.lowest = Math.min(top.lowest, index);
  }

  /** Settles what `goal` found while it ran, and keeps its own answer unless the bound tainted it. */
  #end(key: string, goal: RunningGoal, answer: Answer): void {
    const parent = this.#running.at(-1);
    if (parent !== undefined) {
      parent.lowest = Math.min(parent.lowest, goal.lowest);
    }
    const met =
      answer.kind === 'witnesses' ? !isFailure(answer.witnesses) : answer.shortfall === undefined;
    const falsified = goal.assumed && (goal.bounded || !met);
    for (const [each, found, restsOn] of this.#provisionalSince(goal)) {
      if (falsified) {
        this.#kept.delete(each);
      } else if (restsOn < goal.index) {
        this.#provisional.push(each);
      } else {
        this.#keep(each, found, goal);
      }
    }
    if (!goal.bounded) {
      this.#keep(key, answer, goal);
    }
  }

  /** The answers found since `goal` started that still rest on a hypothesis, each once. */
  #provisionalSince(goal: RunningGoal): readonly (readonly [string, Answer, number])[] {
    return [...new Set(this.#provisional.splice(goal.provisionalBefore))].flatMap((each) => {
      const kept = this.#kept.get(each);
      return kept?.restsOn === undefined ? [] : [[each, kept.answer, kept.restsOn] as const];
    });
  }

  /** Keeps `answer` of `key` resting on what `goal`, ending, rested on below itself. */
  #keep(key: string, answer: Answer, goal: RunningGoal): void {
    const restsOn = goal.lowest < goal.index ? goal.lowest : undefined;
    this.#kept.set(key, { answer, restsOn });
    if (restsOn !== undefined) {
      this.#provisional.push(key);
    }
  }
}

function witnessesFound(find: () => readonly ResolvedCall[] | Failure): () => Answer {
  return () => ({ kind: 'witnesses', witnesses: find() });
}

function witnessesIn(answer: Answer): readonly ResolvedCall[] | Failure {
  return answer.kind === 'witnesses' ? answer.witnesses : unreachable('A goal found no witnesses.');
}

/** Reports an endless conformance search at `site` when `search` is at the root. */
export function endlessAt(
  site: UseSite,
  search: Search,
  type: Type,
  constraint: Constraint,
): Failure {
  if (search.depth === 0) {
    const trait = constraint.trait.name.text;
    site.report((at) => checkerDiagnostics.endlessConformance(at, typeText(type), trait));
  }
  return 'endless';
}

/**
 * Builds the `Meets` helper for `site` and `search` from `check`, which runs a deeper trait search
 * and returns its outcome.
 */
export function meetsWith(
  site: UseSite,
  search: Search,
  check: (type: Type, constraint: Constraint) => readonly ResolvedCall[] | Failure,
): Meets {
  const { typeKeys: keys } = site.checker;
  const judge = (type: Type, constraint: Constraint): boolean => {
    const outcome = check(type, constraint);
    if (outcome === 'endless') {
      search.endless ??= { type, constraint };
    }
    return !isFailure(outcome);
  };
  return Object.assign(judge, {
    enter: (type: Type, goal: Constraint | StructConstraintModel, step: () => string | undefined) =>
      search.goals.shortfall(goalKey(keys, type, goal), step),
    reportEndless: () => {
      if (search.endless === undefined) {
        return false;
      }
      endlessAt(site, search, search.endless.type, search.endless.constraint);
      return true;
    },
  });
}

/**
 * The key of `type` meeting `goal`, a trait or a struct constraint, each type in it keyed by `key`:
 * its key by default, its spelled key where what is kept is spelled through it (root-goals.ts).
 */
export function goalKey(
  keys: TypeKeys,
  type: Type,
  goal: Constraint | StructConstraintModel,
  key: (type: Type) => string = (each) => keys.typeKey(each),
): string {
  const goalKeys = { identityOf: keys.identityOf, key };
  const goalText = 'trait' in goal ? constraintKey(goalKeys, goal) : structModelKey(goalKeys, goal);
  return `${key(type)}:${goalText}`;
}

/** How a goal's parts are keyed: identities, and types by `key`. */
interface GoalKeys {
  readonly identityOf: (object: object) => number;
  readonly key: (type: Type) => string;
}

function constraintKey(keys: GoalKeys, { trait, arguments: args }: Constraint): string {
  return `${keys.identityOf(trait)}<${args.map(keys.key).join(',')}>`;
}

function structModelKey(keys: GoalKeys, model: StructConstraintModel): string {
  const entries = [
    ...model.named.map(({ name, rule }) => `${name}${entryRuleKey(keys, rule)}`),
    ...(model.others === undefined ? [] : [`[_]${entryRuleKey(keys, model.others)}`]),
  ];
  return `struct{${entries.join(',')}}`;
}

function entryRuleKey(keys: GoalKeys, rule: EntryRule): string {
  if (rule.kind === 'type') {
    return `:${keys.key(rule.type)}`;
  }
  const parts = [
    ...rule.traits.map((trait) => constraintKey(keys, trait)),
    ...rule.structs.map((struct) => structModelKey(keys, struct)),
  ];
  return `is ${parts.join('&')}`;
}
