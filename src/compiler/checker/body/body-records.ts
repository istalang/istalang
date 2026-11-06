/**
 * What checking one body records of its nodes (body-checker.ts), each record kept per pass of a
 * field loop (passes.ts), so the body reads as each pass checked it, and the passes nested in it
 * the same way. The facts a CheckedBody answers are read from these records and from the body's
 * units (body/facts/recorded-body.ts).
 */

import type { VariantEntity } from '../../binder/entities.ts';
import type { FunctionDeclaration } from '../../syntax/declarations/index.ts';
import type {
  Call,
  Expression,
  FieldHeader,
  IndentedValue,
} from '../../syntax/expressions/index.ts';
import type { BuiltLiteral } from '../../syntax/expressions/literals/indented-values.ts';
import type { StringLiteral } from '../../syntax/expressions/literals/literals.ts';
import type { Identifier } from '../../syntax/node.ts';
import type { Assignment, Block } from '../../syntax/statements.ts';
import type { FieldPassType, Pass, Passes } from '../passes.ts';
import type { ValueSite } from '../surface/checked-body.ts';
import type { ResolvedCall, ResolvedSite } from '../surface/resolved-call.ts';
import type { Fit } from '../types/fitting/fit.ts';
import type { FieldMember, Type } from '../types/type/index.ts';

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
