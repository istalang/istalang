/**
 * What a member access `x.f` reads on a receiver, read alone or as the function a call calls
 * (`x.f(…)`): the field the checker found, a part of the value the access's step works on, or a
 * getter's or a keyed index's read (§5.2, §10.2), the call checking resolved at the access, on that
 * value; so a read inside an optional chain reads, or calls the getter, on the value inside. Such a
 * read is one call, its value typed by what the function gives: a getter is passed the receiver
 * alone, a keyed index the member's name after it, as the key its call takes.
 */

import type { Expression, MemberAccess } from '../../../../syntax/expressions/index.ts';
import type { ValueId } from '../../../surface/flow-ir.ts';
import type { ResolvedCall } from '../../../surface/resolved-call.ts';
import { stringType } from '../../../types/type/primitives.ts';
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
  const call = builder.body.resolved.get(access);
  if (call !== undefined) {
    const receiver = stepTarget(builder, link, access.target);
    const passed = takesKey(call) ? [receiver, keyNamed(builder, access)] : [receiver];
    return resolvedCall(builder, call, { site: access, passed });
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

/** Whether a member read's call takes an argument after its receiver: a keyed index's key. */
function takesKey(call: ResolvedCall): boolean {
  return call.binding.some((source) => source.kind === 'argument' && source.index === 1);
}

/** The key `access`'s name is, a String constant (§10.2). */
function keyNamed(builder: FlowBuilder, access: MemberAccess): ValueId {
  const { member } = access;
  const key = builder.temporary(member, stringType);
  const form = { kind: 'primitive', value: member.text } as const;
  return builder.compute(key, member, { kind: 'constant', form });
}
