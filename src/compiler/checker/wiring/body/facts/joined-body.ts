/**
 * A body's facts as tools read them across the passes of the field loops around a node
 * (surface/denotation.ts `JoinedBody`): each fact tools read joined as its entry in the facts table
 * (index.ts) says, under the name tools read it by, as it is or listed.
 */

import type { PassAnswers } from '../../../contexts/pass-views.ts';
import type { BodyFacts, CheckedBody } from '../../../surface/checked-body.ts';
import {
  type JoinedBody,
  joinedFacts,
  type ListedFacts,
  listedFacts,
} from '../../../surface/denotation.ts';
import type { TypeRules } from '../../../types/type/type-rules.ts';

/** How tools read a fact across the passes of the field loops around a node. */
export interface JoinedFact<Fact, Joined> {
  readonly joined: (answers: PassAnswers<Fact>, rules: TypeRules) => Joined;
}

type ListedName = keyof typeof listedFacts;

/** A fact tools read (`JoinedBody`): joined as it is, or listed. */
export type ToolName = (typeof joinedFacts)[number] | ListedName;

/**
 * What a fact is across passes: as a pass answers it, or the list tools read (check.ts
 * `ListedFacts`).
 */
export type AcrossPasses<Name extends keyof BodyFacts> = Name extends ListedName
  ? ListedFacts[(typeof listedFacts)[Name]]
  : BodyFacts[Name];

/** How each fact tools read is joined. */
export type Joins = {
  readonly [Name in ToolName]: JoinedFact<BodyFacts[Name], AcrossPasses<Name>>;
};

const toolNames: readonly ToolName[] = [
  ...joinedFacts,
  ...(Object.keys(listedFacts) as ListedName[]),
];

/** `bodies`, the passes of one text, read as one: each fact joined as `joins` says. */
export function joinedOf(
  bodies: PassAnswers<CheckedBody>,
  rules: TypeRules,
  joins: Joins,
): JoinedBody {
  const [first, ...others] = bodies;
  const answered: Partial<Record<keyof JoinedBody, unknown>> = {};
  const joinedFact = <Name extends ToolName>(name: Name): AcrossPasses<Name> =>
    joins[name].joined([first[name], ...others.map((each) => each[name])], rules);
  for (const name of toolNames) {
    answered[isListed(name) ? listedFacts[name] : name] = joinedFact(name);
  }
  // Each fact was joined by its own entry, under the name tools read it by, so the record is whole.
  return answered as JoinedBody;
}

function isListed(name: ToolName): name is ListedName {
  return Object.hasOwn(listedFacts, name);
}
