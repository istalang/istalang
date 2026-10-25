/**
 * Indexing and slicing (§3.9): `x[k]` calls `index(x, k)`, found like an operator's function, so
 * any type with an `index` can be indexed, and slicing is indexing with a `Range`. Writing an
 * element is the rule of places (rules/places.ts).
 */

import { collectionFunctions } from '../../../language/well-known.ts';
import type { Index } from '../../syntax/expressions.ts';
import type { BodyContext } from '../context.ts';
import { topLevelCandidates } from '../overloads/candidates.ts';
import { resolveCall } from '../overloads/resolve.ts';
import type { Type } from '../types/type.ts';

export function checkIndex(context: BodyContext, node: Index, expected: Type | undefined): Type {
  const container = context.expression(node.target);
  const key = context.expression(node.index);
  return resolveCall(context, {
    site: node,
    name: '[]',
    candidates: topLevelCandidates(context.checker, context.module, collectionFunctions.index, [
      container,
      key,
    ]),
    arguments: [
      { node: node.target, type: container, passing: 'value' },
      { node: node.index, type: key, passing: 'value' },
    ],
    typeArguments: undefined,
    expected,
    form: 'operator',
  });
}
