/**
 * What checking a body recorded, as its facts are read from it (index.ts): the body's own records
 * (body-records.ts), the units that keep records of their own constructs, and what it produces.
 * The body checker is all of its units (body-checker.ts).
 */

import type { bodyRecords } from '../body-records.ts';
import type { FunctionScopes } from '../closures/functions.ts';
import type { CollectionForms } from '../expressions/collections.ts';
import type { StructLiterals } from '../expressions/literal-sources.ts';
import type { FieldReads } from '../expressions/member-access.ts';
import type { OptionalChains } from '../expressions/optionals.ts';
import type { CheckedPatterns } from '../patterns/matching.ts';
import type { ImplicitCalls } from '../resolution/implicit.ts';
import type { Iterations } from '../rules/loops/iteration.ts';
import type { LabelTargets } from '../statements/loops.ts';
import type { VariableScope } from '../statements/variables.ts';
import type { Type } from '../types/type.ts';

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
