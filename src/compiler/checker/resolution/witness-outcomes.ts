/**
 * What a witness search finds, and the state it carries down the active stack (conformance.ts,
 * §3.5, §3.10): a witness, or why there is none. A search that fails has reported why at its use
 * site already; one reaching the depth bound counts as endless, which the root reports as such.
 * Concrete struct-constraint and union-member goals active on the stack count as met (coinductive).
 */

import { checkerDiagnostics } from '../diagnostics/index.ts';
import type { ResolvedCall } from '../resolved-call.ts';
import type { EntryRule, StructConstraintModel } from '../types/struct-constraint.ts';
import type { Constraint, Type } from '../types/type.ts';
import type { TypeKeys } from '../types/type-keys.ts';
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
 * The state threaded down one conformance search: how deep it is, the concrete struct-constraint
 * and union-member goals active on the stack, and the first trait search that hit `maximumDepth`.
 */
export interface Search {
  readonly depth: number;
  readonly active: Set<string>;
  endless?: { readonly type: Type; readonly constraint: Constraint } | undefined;
}

/** A fresh search at the root of a conformance check. */
export function startSearch(): Search {
  return { depth: 0, active: new Set() };
}

/** `search` one level deeper, sharing its active coinductive goals. */
export function deeper(search: Search): Search {
  return { depth: search.depth + 1, active: search.active };
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
    enter: (
      type: Type,
      goal: Constraint | StructConstraintModel,
      step: () => string | undefined,
    ) => {
      const goalText = 'trait' in goal ? constraintKey(keys, goal) : structModelKey(keys, goal);
      const key = `${keys.typeKey(type)}:${goalText}`;
      if (search.active.has(key)) {
        return;
      }
      search.active.add(key);
      try {
        return step();
      } finally {
        search.active.delete(key);
      }
    },
    reportEndless: () => {
      if (search.endless === undefined) {
        return false;
      }
      endlessAt(site, search, search.endless.type, search.endless.constraint);
      return true;
    },
  });
}

function constraintKey(keys: TypeKeys, { trait, arguments: args }: Constraint): string {
  return `${keys.identityOf(trait)}<${args.map((arg) => keys.typeKey(arg)).join(',')}>`;
}

function structModelKey(keys: TypeKeys, model: StructConstraintModel): string {
  const entries = [
    ...model.named.map(({ name, rule }) => `${name}${entryRuleKey(keys, rule)}`),
    ...(model.others === undefined ? [] : [`[_]${entryRuleKey(keys, model.others)}`]),
  ];
  return `struct{${entries.join(',')}}`;
}

function entryRuleKey(keys: TypeKeys, rule: EntryRule): string {
  if (rule.kind === 'type') {
    return `:${keys.typeKey(rule.type)}`;
  }
  const parts = [
    ...rule.traits.map((trait) => constraintKey(keys, trait)),
    ...rule.structs.map((struct) => structModelKey(keys, struct)),
  ];
  return `is ${parts.join('&')}`;
}
