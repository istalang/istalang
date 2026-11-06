/**
 * What checking one body records of its nodes (body-checker.ts), each record kept per pass of a
 * field loop (passes.ts), so the body reads as each pass checked it, and the passes nested in it
 * the same way. The facts a CheckedBody answers are read from these records and from the body's
 * units (body-facts.ts).
 */

import type { VariantEntity } from '../binder/entities.ts';
import type { FunctionDeclaration } from '../syntax/declarations.ts';
import type { BuiltLiteral } from '../syntax/expressions/indented-values.ts';
import type { Call, Expression, FieldHeader, IndentedValue } from '../syntax/expressions/index.ts';
import type { StringLiteral } from '../syntax/expressions/literals.ts';
import type { Identifier } from '../syntax/node.ts';
import type { Assignment, Block } from '../syntax/statements.ts';
import type { ValueSite } from './check.ts';
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
import type { Fit } from './types/fit.ts';
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
    builtLiterals: passes.table<IndentedValue, BuiltLiteral>(),
    chosenVariants: passes.table<Identifier, VariantEntity>(),
    ruledOut: passes.table<Block, true>(),
    stops: passes.table<Expression | Assignment, readonly Expression[]>(),
    decided: passes.table<Expression, boolean>(),
    fits: passes.table<ValueSite, Fit>(),
    fieldPasses: passes.table<FieldHeader, readonly CheckedPass[]>(),
  };
}

type BodyRecords = ReturnType<typeof bodyRecords>;

/** The units of a body whose records its CheckedBody reads beside its own. */
interface BodyUnits {
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

/** What checking a body recorded: its own records, its units', and what it produces. */
export interface RecordedBody {
  readonly records: BodyRecords;
  readonly units: BodyUnits;
  readonly result: Type;
}
