/**
 * The facts a checked body answers (surface/checked-body.ts `BodyFacts`), each one entry of
 * `bodyFacts`: how it is read as a pass checked it, from what checking recorded (recorded-body.ts);
 * how an instantiation reads it, from the parts its answers are made of (instantiation.ts); and, for
 * a fact tools read (surface/denotation.ts `JoinedBody`), how the passes of the field loops around
 * a node join it (pass-joins.ts). The body and its views are derived from the table, so a fact
 * added to the contract fails to typecheck until its entry says how each view reads it, and no
 * view passes a fact through unread.
 */

import type { PassAnswers } from '../../../contexts/pass-views.ts';
import type { Pass } from '../../../contexts/passes.ts';
import { type FlowSource, flowsOf } from '../../../rules/flow/build/index.ts';
import type { BodyFacts, CheckedBody } from '../../../surface/checked-body.ts';
import {
  type JoinedBody,
  joinedFacts,
  type ListedFacts,
  listedFacts,
} from '../../../surface/denotation.ts';
import { exactFit } from '../../../types/fitting/fit/index.ts';
import { sameType } from '../../../types/identity/identity.ts';
import type { TypeRules } from '../../../types/type/type-rules.ts';
import { type Instantiation, instantiationBy } from './instantiation.ts';
import {
  distinctCallees,
  everyDistinct,
  everyListed,
  firstFound,
  firstPass,
  firstRecorded,
  typesJoined,
} from './pass-joins.ts';
import { coreAt, type RecordedBody, throughCore } from './recorded-body.ts';

/**
 * How a body answers one fact: read as `pass` checked it, from what it recorded (`bodyAt` reads
 * the passes nested in it); and read through an instantiation.
 */
interface BodyFact<Fact> {
  readonly at: (recorded: RecordedBody, pass: Pass, bodyAt: (pass: Pass) => CheckedBody) => Fact;
  readonly instantiated: (fact: Fact, by: Instantiation) => Fact;
}

/** How tools read a fact across the passes of the field loops around a node. */
interface JoinedFact<Fact, Joined> {
  readonly joined: (answers: PassAnswers<Fact>, rules: TypeRules) => Joined;
}

type FactName = keyof BodyFacts;

type ListedName = keyof typeof listedFacts;

/** A fact tools read (`JoinedBody`): joined as it is, or listed. */
type ToolName = (typeof joinedFacts)[number] | ListedName;

/**
 * What a fact is across passes: as a pass answers it, or the list tools read (check.ts
 * `ListedFacts`).
 */
type AcrossPasses<Name extends FactName> = Name extends ListedName
  ? ListedFacts[(typeof listedFacts)[Name]]
  : BodyFacts[Name];

/** How a body answers one fact, and how tools read it across passes if they do. */
type FactEntry<Name extends FactName> = BodyFact<BodyFacts[Name]> &
  (Name extends ToolName ? JoinedFact<BodyFacts[Name], AcrossPasses<Name>> : unknown);

/**
 * How a body answers each fact of the contract: an entry per `BodyFacts` member, none missing, and
 * a join for exactly the facts tools read.
 */
const bodyFacts: { readonly [Name in FactName]: FactEntry<Name> } = {
  typeOf: {
    at: (recorded, pass) => (expression) =>
      recorded.records.types.get(expression, pass) ??
      recorded.records.types.get(coreAt(recorded, pass, expression), pass),
    instantiated: (typeOf, by) => readThrough(typeOf, by.concrete),
    joined: typesJoined,
  },
  expectedOf: {
    at: (recorded, pass) => (site) =>
      recorded.records.expected.get(site, pass) ??
      recorded.records.expected.get(coreAt(recorded, pass, site), pass),
    instantiated: (expectedOf, by) => readThrough(expectedOf, by.concrete),
    joined: typesJoined,
  },
  resolved: {
    at: (recorded, pass) => throughCore(recorded, pass, recorded.units.calls.at(pass)),
    instantiated: asChecked,
    joined: distinctCallees,
  },
  functionValues: {
    at: (recorded, pass) => recorded.units.calls.valuesAt(pass),
    instantiated: asChecked,
    joined: distinctCallees,
  },
  valueCalls: {
    at: (recorded, pass) => throughCore(recorded, pass, recorded.units.valueCalls.at(pass)),
    instantiated: asChecked,
    joined: firstRecorded,
  },
  madeCalls: {
    at:
      ({ units }) =>
      () => [
        ...units.calls.entries().map(([site, call]) => ({ kind: 'call', site, call }) as const),
        ...units.calls
          .valueEntries()
          .map(([site, call]) => ({ kind: 'value', site, call }) as const),
        ...units.implicit.made(),
        ...units.literals.made(),
      ],
    instantiated: asChecked,
    joined: firstPass,
  },
  madeTypes: {
    at:
      ({ records }) =>
      () =>
        records.types.entries().map(([site, type]) => ({ site, type })),
    instantiated: asChecked,
  },
  implicitCallOf: {
    at:
      ({ units }, pass) =>
      (node, role) =>
        units.implicit.of(node, role, pass),
    instantiated: asChecked,
  },
  collectionFormOf: {
    at:
      ({ units }, pass) =>
      (literal) =>
        units.collections.of(literal, pass),
    instantiated: asChecked,
  },
  iterationOf: {
    at:
      ({ units }, pass) =>
      (iteration) =>
        units.iterations.formOf(iteration, pass),
    instantiated: (iterationOf, by) => readThrough(iterationOf, by.iteration),
  },
  fitAt: {
    at:
      ({ records }, pass) =>
      (site) =>
        records.fits.get(site, pass) ?? exactFit,
    instantiated: (fitAt, by) => (site) => by.fit(fitAt(site)),
  },
  targetsOf: {
    at:
      ({ units }, pass) =>
      (owner) =>
        units.variables.targetsOf(owner, pass),
    instantiated: (targetsOf, by) => (owner) => targetsOf(owner).map(by.target),
  },
  assignedOf: {
    at:
      ({ units }, pass) =>
      (assignment) =>
        units.variables.assignedOf(assignment, pass),
    instantiated: (assignedOf, by) => (assignment) => assignedOf(assignment).map(by.assigned),
  },
  inCell: {
    at:
      ({ units }) =>
      (name) =>
        units.variables.inCell(name),
    instantiated: asChecked,
  },
  functionOf: {
    at:
      ({ units }, pass) =>
      (node) =>
        units.functions.checkedOf(node, pass),
    instantiated: (functionOf, by) => readThrough(functionOf, by.function),
    joined: (answers) => everyDistinct(answers, (one, other) => sameType(one.type, other.type)),
  },
  sourcesOf: {
    at:
      ({ units }, pass) =>
      (literal) =>
        units.literals.sourcesOf(literal, pass),
    instantiated: asChecked,
  },
  literalFieldsOf: {
    at:
      ({ units }, pass) =>
      (literal) =>
        units.literals.fieldsOf(literal, pass),
    instantiated: (fieldsOf, by) => readThrough(fieldsOf, (fields) => fields.map(by.field)),
    joined: firstFound,
  },
  patternOf: {
    at:
      ({ units }, pass) =>
      (pattern) =>
        units.patterns.patternOf(pattern, pass),
    instantiated: (patternOf, by) => readThrough(patternOf, by.pattern),
    joined: firstFound,
  },
  matchedTypeOf: {
    at:
      ({ units }, pass) =>
      (node) =>
        units.patterns.matchedTypeOf(node, pass),
    instantiated: (matchedTypeOf, by) => readThrough(matchedTypeOf, by.concrete),
    joined: typesJoined,
  },
  patternFieldsOf: {
    at:
      ({ units }, pass) =>
      (pattern) =>
        units.patterns.fieldsOf(pattern, pass),
    instantiated: (fieldsOf, by) => readThrough(fieldsOf, (fields) => fields.map(by.field)),
    joined: firstFound,
  },
  chainOf: {
    at:
      ({ units }, pass) =>
      (link) =>
        units.chains.chainOf(link, pass),
    instantiated: (chainOf, by) => readThrough(chainOf, by.chain),
    joined: firstFound,
  },
  fieldReadOf: {
    at:
      ({ units }, pass) =>
      (reading) =>
        units.fieldReads.of(reading, pass),
    instantiated: (fieldReadOf, by) => readThrough(fieldReadOf, by.fieldRead),
    joined: firstFound,
  },
  declaredTypeOf: {
    at:
      ({ units }, pass) =>
      (name) =>
        units.variables.declaredTypeOf(name, pass),
    instantiated: (declaredTypeOf, by) => readThrough(declaredTypeOf, by.concrete),
    joined: typesJoined,
  },
  fieldGivenBy: {
    at:
      ({ records }, pass) =>
      (giver) =>
        records.givenFields.get(giver, pass),
    instantiated: (fieldGivenBy, by) => readThrough(fieldGivenBy, by.field),
    joined: firstFound,
  },
  keyOwnerOf: {
    at:
      ({ records }, pass) =>
      (literal) =>
        records.keyOwners.get(literal, pass),
    instantiated: (keyOwnerOf, by) => readThrough(keyOwnerOf, by.concrete),
    joined: firstFound,
  },
  coreOf: {
    at:
      ({ units }, pass) =>
      (node) =>
        units.sugars.coreOf(node, pass),
    instantiated: asChecked,
    joined: firstFound,
  },
  chosenVariantOf: {
    at:
      ({ records }, pass) =>
      (name) =>
        records.chosenVariants.get(name, pass),
    instantiated: asChecked,
    joined: firstFound,
  },
  candidatesAt: {
    at: (recorded, pass) => (site) =>
      recorded.units.calls.candidatesAt(coreAt(recorded, pass, site), pass),
    instantiated: asChecked,
    joined: everyListed,
  },
  labels: {
    at: ({ units }) => units.labels,
    instantiated: asChecked,
    joined: firstPass,
  },
  passesOf: {
    at:
      ({ records }, pass, bodyAt) =>
      (header) =>
        (records.fieldPasses.get(header, pass) ?? []).map(({ pass: inner, ...each }) => ({
          ...each,
          body: bodyAt(inner),
        })),
    instantiated: (passesOf, by) => (header) => by.passes(passesOf(header)),
  },
  isRuledOut: {
    at:
      ({ units }, pass) =>
      (block) =>
        units.decisions.isRuledOut(block, pass),
    instantiated: asChecked,
  },
  stopsAt: {
    at:
      ({ units }, pass) =>
      (operation) =>
        units.decisions.stopsAt(operation, pass),
    instantiated: asChecked,
  },
  decidedOf: {
    at:
      ({ units }, pass) =>
      (condition) =>
        units.decisions.decidedAt(condition, pass),
    instantiated: asChecked,
  },
  result: {
    at: ({ result }) => result,
    instantiated: (result, by) => by.concrete(result),
  },
};

const factNames = Object.keys(bodyFacts) as readonly FactName[];

const joins: { readonly [Name in ToolName]: JoinedFact<BodyFacts[Name], AcrossPasses<Name>> } =
  bodyFacts;

const toolNames: readonly ToolName[] = [
  ...joinedFacts,
  ...(Object.keys(listedFacts) as ListedName[]),
];

/** The CheckedBody of what was checked as `pass` sees it. */
export function checkedAt(recorded: RecordedBody, pass: Pass): CheckedBody {
  const bodyAt = (inner: Pass) => checkedAt(recorded, inner);
  return bodyOf((name) => bodyFacts[name].at(recorded, pass, bodyAt), recorded.flows);
}

/**
 * The body whose every fact `factOf` answers, its views read through the same table, its flows
 * built from `flows`.
 */
function bodyOf(
  factOf: <Name extends FactName>(name: Name) => BodyFacts[Name],
  flows: FlowSource,
): CheckedBody {
  const answered: Partial<Record<FactName, unknown>> = {};
  for (const name of factNames) {
    answered[name] = factOf(name);
  }
  // Each fact was answered by its own entry above, so the record is whole.
  const facts = answered as BodyFacts;
  const body: CheckedBody = {
    ...facts,
    instantiated: (substitution, checker) => {
      const by = instantiationBy(substitution, checker);
      return bodyOf((name) => bodyFacts[name].instantiated(facts[name], by), by.flows(flows));
    },
    joinedWith: (others, rules) => joinedOf([body, ...others], rules),
    ...flowsOf(flows, () => body),
  };
  return body;
}

/** `bodies`, the passes of one text, read as one: each fact joined as its entry says. */
function joinedOf(bodies: PassAnswers<CheckedBody>, rules: TypeRules): JoinedBody {
  const [first, ...others] = bodies;
  const answered: Partial<Record<keyof JoinedBody, unknown>> = {};
  for (const name of toolNames) {
    const joined = joinedFact(name, [first[name], ...others.map((each) => each[name])], rules);
    answered[isListed(name) ? listedFacts[name] : name] = joined;
  }
  // Each fact was joined by its own entry, under the name tools read it by, so the record is whole.
  return answered as JoinedBody;
}

function joinedFact<Name extends ToolName>(
  name: Name,
  answers: PassAnswers<BodyFacts[Name]>,
  rules: TypeRules,
): AcrossPasses<Name> {
  return joins[name].joined(answers, rules);
}

function isListed(name: ToolName): name is ListedName {
  return Object.hasOwn(listedFacts, name);
}

/** A fact by node with each answer read through `part`, the answer of none staying none. */
function readThrough<Args extends unknown[], Answer>(
  read: (...args: Args) => Answer | undefined,
  part: (answer: Answer) => Answer,
): (...args: Args) => Answer | undefined {
  return (...args) => {
    const answer = read(...args);
    return answer === undefined ? undefined : part(answer);
  };
}

/** A fact an instantiation reads as checked: nothing it answers holds a type. */
function asChecked<Fact>(fact: Fact): Fact {
  return fact;
}
