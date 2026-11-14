/**
 * A getter's read (§3.1): the call checking resolved at the member access, which a function named
 * as a value is never recorded at (§3.14), on the value the access's step works on, so a read
 * inside an optional chain calls the getter on the value inside. Read alone (`x.g`) or as the
 * function a call calls (`x.g(…)`), it is one call, its value typed by what the getter gives.
 */

import type { Expression, MemberAccess } from '../../../../syntax/expressions/index.ts';
import type { ValueId } from '../../../surface/flow-ir.ts';
import { stepTarget } from './chains.ts';
import type { FlowBuilder } from './flow-builder.ts';
import { resolvedCall } from './implicit-calls.ts';

/** Whether `access` reads a getter, a call checking resolved at it. */
export function readsGetter(builder: FlowBuilder, access: MemberAccess): boolean {
  return builder.body.resolved.has(access);
}

/** The getter `access` reads, called on what `link`'s step works on: `access`'s or its call's. */
export function getterRead(builder: FlowBuilder, link: Expression, access: MemberAccess): ValueId {
  const receiver = stepTarget(builder, link, access.target);
  return resolvedCall(builder, builder.body.resolved.get(access), {
    site: access,
    passed: [receiver],
  });
}
