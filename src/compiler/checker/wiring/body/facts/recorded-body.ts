/**
 * What checking a body recorded, as its facts are read from it (index.ts): the body's own records
 * (body-records.ts), the units that keep records of their own constructs, what it produces, and
 * the roots it was checked from; and how a written node a desugaring rebuilt reads at its core.
 * The body checker is all of its units (body-checker.ts).
 */

import type { NodeOf } from '../../../../syntax/tree/node.ts';
import type { FunctionScopes } from '../../../constructs/closures/functions.ts';
import type { ValueCalls } from '../../../constructs/closures/value-calls.ts';
import type { FieldReads } from '../../../constructs/expressions/access/member-access.ts';
import type { OptionalChains } from '../../../constructs/expressions/access/optionals.ts';
import type { CollectionForms } from '../../../constructs/expressions/collections/collections.ts';
import type { StructLiterals } from '../../../constructs/expressions/structs/literal-sources.ts';
import type { Iterations } from '../../../constructs/loops/iteration.ts';
import type { CheckedPatterns } from '../../../constructs/patterns/matching.ts';
import type { LabelTargets } from '../../../constructs/statements/loops.ts';
import type { VariableScope } from '../../../constructs/statements/variables.ts';
import type { Pass, PassRecords } from '../../../contexts/passes.ts';
import type { Desugarings } from '../../../desugaring/index.ts';
import type { ImplicitCalls } from '../../../resolution/applying/implicit.ts';
import type { CallRecords } from '../../../resolution/calls/call-records.ts';
import type { FlowSource } from '../../../rules/flow/build/index.ts';
import type { FlowDecisions } from '../../../rules/flow/flow-decisions.ts';
import type { Type } from '../../../types/type/index.ts';
import type { bodyRecords } from '../body-records.ts';
import type { WrittenTypes } from '../written-types.ts';

type BodyRecords = ReturnType<typeof bodyRecords>;

/** The units of a body whose records its CheckedBody reads beside its own. */
interface BodyUnits {
  readonly variables: VariableScope;
  readonly writtenTypes: WrittenTypes;
  readonly functions: FunctionScopes;
  readonly literals: StructLiterals;
  readonly implicit: ImplicitCalls;
  readonly calls: CallRecords;
  readonly decisions: FlowDecisions;
  readonly collections: CollectionForms;
  readonly valueCalls: ValueCalls;
  readonly iterations: Iterations;
  readonly patterns: CheckedPatterns;
  readonly chains: OptionalChains;
  readonly fieldReads: FieldReads;
  readonly labels: LabelTargets;
  readonly sugars: Desugarings;
}

/** What checking a body recorded: its own records, its units', and what it produces. */
export interface RecordedBody {
  readonly records: BodyRecords;
  readonly units: BodyUnits;
  readonly result: Type;
  /** What its flows are built from: the roots it was checked from. */
  readonly flows: FlowSource;
}

/**
 * `site`, or what a desugaring rebuilt it as (checker/desugaring/), whose records answer for it: a
 * deferred call's call to its taker, and a call it makes later as rebuilt.
 */
export function coreAt<Key extends NodeOf<string>>(
  { units }: RecordedBody,
  pass: Pass,
  site: NodeOf<string>,
): Key {
  // A site's core is a call, a site of the same records.
  return (units.sugars.coreOf(site, pass) ?? site) as Key;
}

/** `records`, which a written node a desugaring rebuilt reads at its core (`coreAt`). */
export function throughCore<Written extends NodeOf<string>, Key extends Written, Record>(
  recorded: RecordedBody,
  pass: Pass,
  records: PassRecords<Key, Record>,
): PassRecords<Written, Record> {
  return {
    get: (site) => records.get(coreAt(recorded, pass, site)),
    has: (site) => records.has(coreAt(recorded, pass, site)),
  };
}
