/**
 * Which variant a name or a call names (§3.11), as checking decided it: a qualified name's own
 * variant, or the one a bare name chose by the type expected of it. The checker, lowering and their
 * tests read it here, so none tells a call of a variant from a function's another way.
 */

import type { Entity, VariantEntity } from '../../binder/entities.ts';
import type { Call } from '../../syntax/expressions/calls.ts';
import { calledName } from '../../syntax/expressions/readings.ts';
import type { Identifier } from '../../syntax/tree/node.ts';

/** How a body's names read: what each binds, and the variant a bare one chose. */
interface VariantNames {
  readonly entityOf: (name: Identifier) => Entity | undefined;
  readonly chosenVariantOf: (name: Identifier) => VariantEntity | undefined;
}

/** The variant `name` names; undefined for a name of anything else, or a bare one nothing chose. */
function variantNamed(names: VariantNames, name: Identifier): VariantEntity | undefined {
  const entity = names.entityOf(name);
  if (entity?.kind === 'variant') {
    return entity;
  }
  return entity?.kind === 'variants' ? names.chosenVariantOf(name) : undefined;
}

/**
 * The variant `call` calls, bare or qualified (`Ok(v)`, `Verdict.Expired()`); undefined for any
 * other call, an optional one (`f?.()`) included, which calls a function value.
 */
export function calledVariant(names: VariantNames, call: Call): VariantEntity | undefined {
  const callee = calledName(call);
  const name = callee.kind === 'MemberAccess' ? callee.member : callee;
  return call.isOptional || name.kind !== 'Identifier' ? undefined : variantNamed(names, name);
}
