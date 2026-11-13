/**
 * Enum values by their variant's name (§3.11): what `?` tests a `Result` for and the `Err` it
 * returns, what a loop tests a cursor's step for, and a variant without fields named or called.
 * Each is the variant at its position among the enum's variants (`variantNamedIn`); in code
 * checking found a mistake in, where the type is no such enum, the test may go either way and the
 * value is unknown.
 */

import type { NodeOf } from '../../../../syntax/tree/node.ts';
import type { BranchTest, ValueId } from '../../../surface/flow-ir.ts';
import { variantNamedIn } from '../../../surface/named-variants.ts';
import type { Type } from '../../../types/type/index.ts';
import type { FlowBuilder } from './flow-builder.ts';

/** The test that `value` holds the variant `name` of its enum type. */
export function variantTest(builder: FlowBuilder, value: ValueId, name: string): BranchTest {
  const { type } = builder.valueOf(value);
  const found = type && variantNamedIn(builder.inputs.checker, type, name);
  return found === undefined
    ? { kind: 'unknown' }
    : { kind: 'is', value, test: { kind: 'variant', variant: found.index } };
}

/** The variant `name` of the enum `type`, holding `fields`, made at `site` into `into`. */
export function madeVariant(
  builder: FlowBuilder,
  {
    site,
    type,
    name,
  }: { readonly site: NodeOf<string>; readonly type: Type | undefined; readonly name: string },
  fields: readonly ValueId[],
  into: ValueId = builder.temporary(site, type),
): ValueId {
  const found = type && variantNamedIn(builder.inputs.checker, type, name);
  if (type === undefined || found === undefined) {
    builder.emit({ op: 'unknown', site, into, operands: fields });
  } else {
    const made = { kind: 'variant', type, variant: found.index } as const;
    builder.emit({ op: 'make', site, into, made, parts: fields });
  }
  return into;
}
