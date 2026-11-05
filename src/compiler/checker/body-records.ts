/**
 * What checking one body records of its nodes (body-checker.ts), and the CheckedBody lowering reads
 * them through. Every record is kept per pass of a field loop (passes.ts), so the CheckedBody of a
 * pass reads the body as that pass checked it, and the passes nested in it the same way.
 */

import type { VariantEntity } from '../binder/entities.ts';
import type { FunctionDeclaration } from '../syntax/declarations.ts';
import type { Call, Expression, FieldHeader } from '../syntax/expressions/index.ts';
import type { StringLiteral } from '../syntax/expressions/literals.ts';
import type { Identifier } from '../syntax/node.ts';
import type { Assignment, Block } from '../syntax/statements.ts';
import type { CheckedBody, ValueSite } from './check.ts';
import type { FunctionScopes } from './closures/functions.ts';
import type { CollectionForms } from './expressions/collections.ts';
import type { StructLiterals } from './expressions/literal-sources.ts';
import type { FieldReads } from './expressions/member-access.ts';
import type { OptionalChains } from './expressions/optionals.ts';
import type { FieldPassType, Pass, Passes } from './passes.ts';
import type { CheckedPatterns } from './patterns/matching.ts';
import type { ImplicitCalls } from './resolution/implicit.ts';
import type { ResolvedCall, ResolvedSite } from './resolved-call.ts';
import type { Iterations } from './rules/iteration.ts';
import type { LabelTargets } from './statements/loops.ts';
import type { VariableScope } from './statements/variables.ts';
import { exactFit, type Fit } from './types/fit.ts';
import type { FieldMember, Type } from './types/type.ts';

/** A field loop's pass as checked: its key and value, and the pass its records are kept in. */
export interface CheckedPass extends FieldPassType {
  readonly pass: Pass;
}

/** The records a body keeps of its nodes itself, beside those its units keep, each per pass. */
export function bodyRecords(passes: Passes) {
  return {
    types: passes.table<Expression, Type>(),
    expected: passes.table<ValueSite, Type>(),
    resolved: passes.table<ResolvedSite, ResolvedCall>(),
    valueCalls: passes.table<Call, true>(),
    candidates: passes.table<ResolvedSite, readonly FunctionDeclaration[]>(),
    namedFields: passes.table<Identifier, FieldMember>(),
    keyOwners: passes.table<StringLiteral, Type>(),
    chosenVariants: passes.table<Identifier, VariantEntity>(),
    ruledOut: passes.table<Block, true>(),
    stops: passes.table<Expression | Assignment, readonly Expression[]>(),
    decided: passes.table<Expression, boolean>(),
    fits: passes.table<ValueSite, Fit>(),
    fieldPasses: passes.table<FieldHeader, readonly CheckedPass[]>(),
  };
}

export type BodyRecords = ReturnType<typeof bodyRecords>;

/** The units of a body whose records its CheckedBody reads beside its own. */
export interface BodyUnits {
  readonly variables: VariableScope;
  readonly functions: FunctionScopes;
  readonly literals: StructLiterals;
  readonly implicit: ImplicitCalls;
  readonly collections: CollectionForms;
  readonly iterations: Iterations;
  readonly patterns: CheckedPatterns;
  readonly chains: OptionalChains;
  readonly fieldReads: FieldReads;
  readonly labels: LabelTargets;
}

/** The CheckedBody of what was checked as `pass` sees it, producing `result`. */
export function checkedAt(
  records: BodyRecords,
  units: BodyUnits,
  pass: Pass,
  result: Type,
): CheckedBody {
  const { variables, literals, implicit, functions, labels } = units;
  return {
    typeOf: (expression) => records.types.get(expression, pass),
    expectedOf: (site) => records.expected.get(site, pass),
    resolved: records.resolved.at(pass),
    valueCalls: records.valueCalls.at(pass),
    madeCalls: () => [
      ...records.resolved.entries().map(([site, call]) => ({ site, call })),
      ...implicit.made(),
      ...literals.made(),
    ],
    implicitCallOf: (node, role) => implicit.of(node, role, pass),
    collectionFormOf: (literal) => units.collections.of(literal, pass),
    iterationOf: (iteration) => units.iterations.of(iteration, pass),
    fitAt: (site) => records.fits.get(site, pass) ?? exactFit,
    targetsOf: (owner) => variables.targetsOf(owner, pass),
    assignedOf: (assignment) => variables.assignedOf(assignment, pass),
    inCell: (name) => variables.inCell(name),
    functionOf: (node) => functions.checkedOf(node, pass),
    sourcesOf: (literal) => literals.sourcesOf(literal, pass),
    literalFieldsOf: (literal) => literals.fieldsOf(literal, pass),
    patternOf: (pattern) => units.patterns.patternOf(pattern, pass),
    chainOf: (link) => units.chains.chainOf(link, pass),
    fieldReadOf: (access) => units.fieldReads.of(access, pass),
    declaredTypeOf: (name) => variables.declaredTypeOf(name, pass),
    namedFieldOf: (name) => records.namedFields.get(name, pass),
    keyOwnerOf: (literal) => records.keyOwners.get(literal, pass),
    chosenVariantOf: (name) => records.chosenVariants.get(name, pass),
    isRuledOut: (body) => records.ruledOut.has(body, pass),
    stopsAt: (operation) => records.stops.get(operation, pass),
    decidedOf: (condition) => records.decided.get(condition, pass),
    candidatesAt: (site) => records.candidates.get(site, pass) ?? [],
    labels,
    passesOf: (header) =>
      (records.fieldPasses.get(header, pass) ?? []).map(({ pass: inner, ...each }) => ({
        ...each,
        body: checkedAt(records, units, inner, result),
      })),
    result,
  };
}
