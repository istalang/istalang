/**
 * The facts a checked body answers (check.ts `BodyFacts`), each one entry of `bodyFacts`: how it
 * is read as a pass checked it, from what checking recorded (recorded-body.ts); how an
 * instantiation reads it, from the parts its answers are made of (instantiation.ts); and how the
 * passes of the field loops around a node join it, for tools (pass-joins.ts). The body and its
 * views are derived from the table, so a fact added to the contract fails to typecheck until its
 * entry says all three, and no view passes a fact through unread.
 */

import type { BodyFacts, CheckedBody } from '../check.ts';
import { type JoinedBody, type ListedFacts, listedFacts } from '../denotation.ts';
import type { PassAnswers } from '../lookup/pass-views.ts';
import type { Pass } from '../passes.ts';
import type { ResolvedCall } from '../resolved-call.ts';
import { exactFit } from '../types/fit.ts';
import { sameType } from '../types/identity.ts';
import type { TypeRules } from '../types/type-rules.ts';
import { type Instantiation, instantiationBy } from './instantiation.ts';
import {
  everyDistinct,
  everyListed,
  firstFound,
  firstListed,
  firstPass,
  firstRecorded,
  inEveryPass,
  typesJoined,
} from './pass-joins.ts';
import type { RecordedBody } from './recorded-body.ts';

/**
 * How a body answers one fact: read as `pass` checked it, from what it recorded (`bodyAt` reads
 * the passes nested in it); read through an instantiation; and read across the passes of the field
 * loops around a node, as tools read it.
 */
interface BodyFact<Fact, Joined> {
  readonly at: (recorded: RecordedBody, pass: Pass, bodyAt: (pass: Pass) => CheckedBody) => Fact;
  readonly instantiated: (fact: Fact, by: Instantiation) => Fact;
  readonly joined: (answers: PassAnswers<Fact>, rules: TypeRules) => Joined;
}

type FactName = keyof BodyFacts;

type ListedName = keyof typeof listedFacts;

/** What a fact is across passes: as a pass answers it, or the list tools read (check.ts `ListedFacts`). */
type AcrossPasses<Name extends FactName> = Name extends ListedName
  ? ListedFacts[(typeof listedFacts)[Name]]
  : BodyFacts[Name];

/** How a body answers each fact of the contract: an entry per `BodyFacts` member, none missing. */
const bodyFacts: { readonly [Name in FactName]: BodyFact<BodyFacts[Name], AcrossPasses<Name>> } = {
  typeOf: {
    at:
      ({ records }, pass) =>
      (expression) =>
        records.types.get(expression, pass),
    instantiated: (typeOf, by) => readThrough(typeOf, by.concrete),
    joined: typesJoined,
  },
  expectedOf: {
    at:
      ({ records }, pass) =>
      (site) =>
        records.expected.get(site, pass),
    instantiated: (expectedOf, by) => readThrough(expectedOf, by.concrete),
    joined: typesJoined,
  },
  resolved: {
    at: ({ records }, pass) => records.resolved.at(pass),
    instantiated: asChecked,
    joined: (answers) =>
      everyDistinct(
        answers.map((records) => records.get),
        sameCallee,
      ),
  },
  valueCalls: {
    at: ({ records }, pass) => records.valueCalls.at(pass),
    instantiated: asChecked,
    joined: firstRecorded,
  },
  madeCalls: {
    at:
      ({ records, units }) =>
      () => [
        ...records.resolved.entries().map(([site, call]) => ({ site, call })),
        ...units.implicit.made(),
        ...units.literals.made(),
      ],
    instantiated: asChecked,
    joined: firstPass,
  },
  implicitCallOf: {
    at:
      ({ units }, pass) =>
      (node, role) =>
        units.implicit.of(node, role, pass),
    instantiated: asChecked,
    joined: (answers) => everyDistinct(answers, sameCallee),
  },
  collectionFormOf: {
    at:
      ({ units }, pass) =>
      (literal) =>
        units.collections.of(literal, pass),
    instantiated: asChecked,
    joined: firstPass,
  },
  iterationOf: {
    at:
      ({ units }, pass) =>
      (iteration) =>
        units.iterations.of(iteration, pass),
    instantiated: (iterationOf, by) => (iteration) => by.iteration(iterationOf(iteration)),
    joined: firstPass,
  },
  fitAt: {
    at:
      ({ records }, pass) =>
      (site) =>
        records.fits.get(site, pass) ?? exactFit,
    instantiated: (fitAt, by) => (site) => by.fit(fitAt(site)),
    joined: firstPass,
  },
  targetsOf: {
    at:
      ({ units }, pass) =>
      (owner) =>
        units.variables.targetsOf(owner, pass),
    instantiated: (targetsOf, by) => (owner) => targetsOf(owner).map(by.target),
    joined: firstListed,
  },
  assignedOf: {
    at:
      ({ units }, pass) =>
      (assignment) =>
        units.variables.assignedOf(assignment, pass),
    instantiated: (assignedOf, by) => (assignment) => assignedOf(assignment).map(by.assigned),
    joined: firstListed,
  },
  inCell: {
    at:
      ({ units }) =>
      (name) =>
        units.variables.inCell(name),
    instantiated: asChecked,
    joined: firstPass,
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
    joined: firstFound,
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
  namedFieldOf: {
    at:
      ({ records }, pass) =>
      (name) =>
        records.namedFields.get(name, pass),
    instantiated: (namedFieldOf, by) => readThrough(namedFieldOf, by.field),
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
  builtLiteralOf: {
    at:
      ({ records }, pass) =>
      (value) =>
        records.builtLiterals.get(value, pass),
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
    at:
      ({ records }, pass) =>
      (site) =>
        records.candidates.get(site, pass) ?? [],
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
    instantiated: (passesOf, by) => (header) => passesOf(header).map(by.pass),
    joined: everyListed,
  },
  isRuledOut: {
    at:
      ({ records }, pass) =>
      (block) =>
        records.ruledOut.has(block, pass),
    instantiated: asChecked,
    joined: inEveryPass,
  },
  stopsAt: {
    at:
      ({ records }, pass) =>
      (operation) =>
        records.stops.get(operation, pass),
    instantiated: asChecked,
    joined: firstFound,
  },
  decidedOf: {
    at:
      ({ records }, pass) =>
      (condition) =>
        records.decided.get(condition, pass),
    instantiated: asChecked,
    joined: firstFound,
  },
  result: {
    at: ({ result }) => result,
    instantiated: (result, by) => by.concrete(result),
    joined: firstPass,
  },
};

const factNames = Object.keys(bodyFacts) as readonly FactName[];

/** The CheckedBody of what was checked as `pass` sees it. */
export function checkedAt(recorded: RecordedBody, pass: Pass): CheckedBody {
  const bodyAt = (inner: Pass) => checkedAt(recorded, inner);
  return bodyOf((name) => bodyFacts[name].at(recorded, pass, bodyAt));
}

/** The body whose every fact `factOf` answers, its views read through the same table. */
function bodyOf(factOf: <Name extends FactName>(name: Name) => BodyFacts[Name]): CheckedBody {
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
      return bodyOf((name) => bodyFacts[name].instantiated(facts[name], by));
    },
    joinedWith: (others, rules) => joinedOf([body, ...others], rules),
  };
  return body;
}

/** `bodies`, the passes of one text, read as one: each fact joined as its entry says. */
function joinedOf(bodies: PassAnswers<CheckedBody>, rules: TypeRules): JoinedBody {
  const [first, ...others] = bodies;
  const answered: Partial<Record<keyof JoinedBody, unknown>> = {};
  for (const name of factNames) {
    const joined = joinedFact(name, [first[name], ...others.map((each) => each[name])], rules);
    answered[isListed(name) ? listedFacts[name] : name] = joined;
  }
  // Each fact was joined by its own entry, under the name tools read it by, so the record is whole.
  return answered as JoinedBody;
}

function joinedFact<Name extends FactName>(
  name: Name,
  answers: PassAnswers<BodyFacts[Name]>,
  rules: TypeRules,
): AcrossPasses<Name> {
  return bodyFacts[name].joined(answers, rules);
}

function isListed(name: FactName): name is ListedName {
  return Object.hasOwn(listedFacts, name);
}

/** Whether two calls call one function: a call's target, as tools name it. */
function sameCallee(one: ResolvedCall, other: ResolvedCall): boolean {
  return one.function === other.function;
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
