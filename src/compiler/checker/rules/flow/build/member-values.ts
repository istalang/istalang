/**
 * What a member access `x.f` reads on a receiver, read alone or as the function a call calls
 * (`x.f(…)`): the field the checker found, a part of the value the access's step works on, or a
 * getter's read (§3.1), the call checking resolved at the access, on that value; so a read inside
 * an optional chain reads, or calls the getter, on the value inside. A getter's read is one call,
 * its value typed by what the getter gives.
 */

import type { Expression, MemberAccess } from '../../../../syntax/expressions/index.ts';
import type { ValueId } from '../../../surface/flow-ir.ts';
import { stepTarget } from './chains.ts';
import type { FlowBuilder } from './flow-builder.ts';
import { resolvedCall } from './implicit-calls.ts';
import { partOfField } from './places.ts';

/**
 * The value `access` reads on what `link`'s step works on (`access`'s own, or its call's): a
 * getter's, or its field's, read into the value `into` makes; undefined where it reads neither.
 */
export function memberValue(
  builder: FlowBuilder,
  { link, access }: { readonly link: Expression; readonly access: MemberAccess },
  into: () => ValueId,
): ValueId | undefined {
  const getter = builder.body.resolved.get(access);
  if (getter !== undefined) {
    const receiver = stepTarget(builder, link, access.target);
    return resolvedCall(builder, getter, { site: access, passed: [receiver] });
  }
  const read = builder.body.fieldReadOf(access);
  if (read === undefined) {
    return undefined;
  }
  const from = stepTarget(builder, link, access.target);
  const value = into();
  builder.emit({ op: 'read', site: access, into: value, from, part: partOfField(read) });
  return value;
}
