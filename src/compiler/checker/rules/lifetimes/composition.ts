/**
 * Summaries composed (design.md §5.4): one re-expressed over the inputs a binding gives it, as a
 * witness's is over the arguments of the call through the requirement it meets, and several
 * joined into what a call that may run any of them does.
 */

import type { Binding } from '../../surface/resolved-call.ts';
import type { Type } from '../../types/type/index.ts';
import type { Input } from './input.ts';
import { emptySummary, type GivenValue, mappedCycle, type Summary } from './summary.ts';

/**
 * `summary` over the inputs `binding` gives its parameters: each parameter the one its source
 * argument is, its types mapped by `substitute`. An input bound to none, a default, says nothing
 * of the call.
 */
export function boundBy(
  summary: Summary,
  binding: Binding,
  substitute: (type: Type) => Type,
): Summary {
  const mapped = (input: Input): Input | undefined => {
    if (input.kind === 'path') {
      const of = mapped(input.of);
      return of === undefined ? undefined : { ...input, of };
    }
    if (input.kind !== 'parameter') {
      return input;
    }
    const source = binding[input.index];
    return source?.kind === 'argument' ? { kind: 'parameter', index: source.index } : undefined;
  };
  const inputs = (list: readonly Input[]) => list.flatMap((input) => mapped(input) ?? []);
  const related = <Related extends { readonly input: Input }>(list: readonly Related[]) =>
    list.flatMap((each) => {
      const input = mapped(each.input);
      return input === undefined ? [] : [{ ...each, input }];
    });
  return {
    ...summary,
    effects: summary.effects.flatMap((effect) => {
      const from = mapped(effect.from);
      const to = mapped(effect.to);
      return from === undefined || to === undefined ? [] : [{ ...effect, from, to }];
    }),
    result: { ...summary.result, relations: related(summary.result.relations) },
    gives: { ...summary.gives, relations: related(summary.gives.relations) },
    requirements: summary.requirements.flatMap((requirement) => {
      const holder = mapped(requirement.holder);
      const value = mapped(requirement.value);
      return holder === undefined || value === undefined
        ? []
        : [
            {
              ...requirement,
              holder,
              value,
              holderType: substitute(requirement.holderType),
              valueType:
                requirement.valueType === undefined ? undefined : substitute(requirement.valueType),
            },
          ];
    }),
    always: summary.always.map((cycle) => mappedCycle(cycle, substitute)),
    callReach: inputs(summary.callReach),
    leaks: inputs(summary.leaks),
    calls: inputs(summary.calls),
    access: inputs(summary.access),
  };
}

/** What a call that may run any of `summaries`' functions does: what each may. */
export function joinedSummaries(summaries: readonly Summary[]): Summary {
  return summaries.reduce<Summary>(
    (joined, each) => ({
      effects: [...joined.effects, ...each.effects],
      result: joinedValues(joined.result, each.result),
      gives: joinedValues(joined.gives, each.gives),
      requirements: [...joined.requirements, ...each.requirements],
      always: [...joined.always, ...each.always],
      callReach: [...joined.callReach, ...each.callReach],
      leaks: [...joined.leaks, ...each.leaks],
      unseen: joined.unseen || each.unseen,
      calls: [...joined.calls, ...each.calls],
      access: [...joined.access, ...each.access],
    }),
    emptySummary,
  );
}

/** A value that may be either of two a call gives. */
function joinedValues(first: GivenValue, second: GivenValue): GivenValue {
  return {
    relations: [...first.relations, ...second.relations],
    reachesItself: first.reachesItself || second.reachesItself,
    watched: first.watched || second.watched,
  };
}
