/**
 * What checking a body recorded, as its facts are read from it (index.ts): the body's own records
 * (body-records.ts), the units that keep records of their own constructs, and what it produces.
 * The body checker is all of its units (body-checker.ts).
 */

import type { FunctionScopes } from '../../../constructs/closures/functions.ts';
import type { FieldReads } from '../../../constructs/expressions/access/member-access.ts';
import type { OptionalChains } from '../../../constructs/expressions/access/optionals.ts';
import type { CollectionForms } from '../../../constructs/expressions/collections/collections.ts';
import type { StructLiterals } from '../../../constructs/expressions/structs/literal-sources.ts';
import type { Iterations } from '../../../constructs/loops/iteration.ts';
import type { CheckedPatterns } from '../../../constructs/patterns/matching.ts';
import type { LabelTargets } from '../../../constructs/statements/loops.ts';
import type { VariableScope } from '../../../constructs/statements/variables.ts';
import type { ImplicitCalls } from '../../../resolution/implicit.ts';
import type { Type } from '../../../types/type/index.ts';
import type { bodyRecords } from '../body-records.ts';

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
