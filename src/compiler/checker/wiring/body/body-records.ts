/**
 * What checking one body records of its nodes (body-checker.ts), each record kept per pass of a
 * field loop (passes.ts), so the body reads as each pass checked it, and the passes nested in it
 * the same way. The facts a CheckedBody answers are read from these records and from the body's
 * units (wiring/body/facts/recorded-body.ts).
 */

import type { VariantEntity } from '../../../binder/entities.ts';
import type { Expression, FieldLoopHeader } from '../../../syntax/expressions/index.ts';
import type { StringLiteral } from '../../../syntax/expressions/literals/literals.ts';
import type { Identifier } from '../../../syntax/tree/node.ts';
import type { TypeNode } from '../../../syntax/types/index.ts';
import type { FieldPassType, Pass, Passes } from '../../contexts/passes.ts';
import type { FieldGiver, ValueSite } from '../../surface/checked-body.ts';
import type { Fit } from '../../types/fitting/fit/index.ts';
import type { FieldMember, Type } from '../../types/type/index.ts';

/** A field loop's pass as checked: its key and value, and the pass its records are kept in. */
interface CheckedPass extends FieldPassType {
  readonly pass: Pass;
}

/** The records a body keeps of its nodes itself, beside those its units keep, each per pass. */
export function bodyRecords(passes: Passes) {
  return {
    types: passes.table<Expression, Type>(),
    writtenTypes: passes.table<TypeNode, Type>(),
    expected: passes.table<ValueSite, Type>(),
    givenFields: passes.table<FieldGiver, FieldMember>(),
    keyOwners: passes.table<StringLiteral, Type>(),
    chosenVariants: passes.table<Identifier, VariantEntity>(),
    fits: passes.table<ValueSite, Fit>(),
    fieldPasses: passes.table<FieldLoopHeader, readonly CheckedPass[]>(),
  };
}
