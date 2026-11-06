/**
 * Goals asked at the root of a witness search (conformance.ts), kept program-wide: a type meets a
 * trait, or a struct constraint, the same wherever it is asked (§3.10), so one search answers
 * every site asking: lowering's trait objects, conversions, noted constraint checks, the host
 * boundary and codecs ask one goal at many sites.
 *
 * - A goal is an entry (structures/entries), so what its search read is logged once and every
 *   site asking reads the goal, which a later revision takes over or searches again as any entry.
 * - It is kept by the spellings of its type and constraint (witness-outcomes.ts `goalKey`, by
 *   spelled keys), as what it finds and reports is spelled through them, and by whether values
 *   cross to the host there, what a search depends on beyond the program (use-site.ts); a trait
 *   goal also by whether only calls on its values need it.
 * - A search reports only at its root site, so it searches through a site recording its reports,
 *   and each site asking makes them again at its own span: a silent one makes none.
 * - A goal reached again while its own entry runs, as deriving a codec asks of a type's parts, or
 *   as an entry its own read recomputes while it is taken over, is searched afresh there, outside
 *   its entry: an entry reached while it runs would answer a stand-in for its whole cycle, and no
 *   stand-in is what a search finds. The derived codec decided
 *   meanwhile (rules/boundary/json-forms.ts) is what ends that recursion.
 */

import type { Diagnostic } from '../../../../foundation/diagnostics/diagnostic.ts';
import type { EntryTable } from '../../../../foundation/structures/entries/index.ts';
import type { AnchoredSpan } from '../../../syntax/tree/positions.ts';
import type {
  CheckerContext,
  CheckerNote,
  RootGoals,
  StructGoal,
  TraitGoal,
} from '../../contexts/context.ts';
import { searchSite, type UseSite } from '../../contexts/use-site.ts';
import type { Type } from '../../types/type/index.ts';
import { goalKey } from './witness-outcomes.ts';

/** The root goals of `checker`'s program, each kept from what `searches` finds for it. */
export function programRootGoals(checker: CheckerContext, searches: RootGoals): RootGoals {
  const { typeKeys } = checker;
  const key = (type: Type) => typeKeys.spelledKey(type);
  const traits = new KeptGoals(checker, {
    name: 'root trait goals',
    search: searches.witnesses,
    keyOf: ({ type, constraint, onValues }: TraitGoal) =>
      `${onValues ? 'values ' : ''}${goalKey(typeKeys, type, constraint, key)}`,
  });
  const structs = new KeptGoals(checker, {
    name: 'root struct goals',
    search: searches.structMet,
    keyOf: ({ type, model }: StructGoal) => goalKey(typeKeys, type, model, key),
  });
  return {
    witnesses: (site, goal) => traits.found(site, goal),
    structMet: (site, goal) => structs.found(site, goal),
  };
}

type Report = (at: AnchoredSpan) => Diagnostic<AnchoredSpan>;

/** What a root search found, with the reports it made at its site, to make at each asker's. */
interface Searched<Found> {
  readonly found: Found;
  readonly reports: readonly Report[];
}

/** A goal as its entry is asked for: the goal, and whether values cross to the host there. */
interface Asked<Goal> {
  readonly goal: Goal;
  readonly toHost: boolean;
}

/** How one kind of goal is kept: its table's name, how it is searched, and its key. */
interface KindOfGoal<Goal, Found> {
  readonly name: string;
  readonly search: (site: UseSite, goal: Goal) => Found;
  readonly keyOf: (goal: Goal) => string;
}

/** One kind of root goal, each searched once in its entry (the banner). */
class KeptGoals<Goal, Found> {
  readonly #checker: CheckerContext;
  readonly #kind: KindOfGoal<Goal, Found>;
  readonly #goals: EntryTable<CheckerNote, string, Searched<Found>, Asked<Goal>>;

  constructor(checker: CheckerContext, kind: KindOfGoal<Goal, Found>) {
    this.#checker = checker;
    this.#kind = kind;
    this.#goals = checker.entries.table({
      name: kind.name,
      compute: (_key, asked) => this.#searched(asked),
    });
  }

  /** What `goal` finds, its reports made at `site`. */
  found(site: UseSite, goal: Goal): Found {
    const asked = { goal, toHost: site.toHost };
    const key = `${site.toHost ? 'host ' : ''}${this.#kind.keyOf(goal)}`;
    const searched = this.#goals.running(key) ? this.#searched(asked) : this.#goals.get(key, asked);
    for (const report of searched.reports) {
      site.report(report);
    }
    return searched.found;
  }

  /** `asked` searched through a site that records what it reports. */
  #searched({ goal, toHost }: Asked<Goal>): Searched<Found> {
    const reports: Report[] = [];
    const site: UseSite = {
      ...searchSite(this.#checker),
      toHost,
      report: (report) => {
        reports.push(report);
      },
    };
    return { found: this.#kind.search(site, goal), reports };
  }
}
