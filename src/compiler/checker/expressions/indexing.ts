/**
 * Indexing and slicing (§3.9): `x[k]` calls `index(x, k)`, found like an operator's function, so
 * any type with an `index` can be indexed, and slicing is indexing with a `Range`. Writing an
 * element is the rule of places (calls/places.ts). An index can be a link of an optional chain
 * (expressions/optionals.ts), as in `a?.items[0]`.
 *
 * A struct is indexed by its keys first (§3.1, §3.9): `s[k]` with `k` within `keyof S` reads the
 * field `k` names, typed `S[K]`, before any `index`. Where `S` declares no `index` of its own, the
 * brackets expect a key, so a literal there is one (`s["region"]`); where it does, a key is what
 * a key's type makes one, and anything else calls `index`.
 */

import { collectionFunctions } from '../../../language/well-known.ts';
import type { Index } from '../../syntax/expressions/index.ts';
import type { BodyContext } from '../body-context.ts';
import { resolveCall } from '../calls/resolve.ts';
import { stoppedOperation } from '../calls/stopped-operations.ts';
import { topLevelCandidates } from '../resolution/candidates.ts';
import { takesAsSelf } from '../resolution/receivers.ts';
import { keyedFieldRead } from '../surface/checked-field.ts';
import { errorType } from '../types/primitives.ts';
import type { Type } from '../types/type.ts';
import { insideOptional } from '../types/unions/inside-optional.ts';

export function checkIndex(context: BodyContext, node: Index, expected: Type | undefined): Type {
  const container = context.chains.target(context, node);
  const operands = [{ node: node.target, type: container }];
  const stopped = stoppedOperation(context, node, operands);
  if (stopped !== undefined) {
    return stopped;
  }
  const rules = context.checker.typeRules;
  const keys = rules.keysOf(container, []);
  const byKey = keys.kind !== 'error';
  const indexed = byKey && declaresIndex(context, container);
  const key = context.expression(node.index, byKey && !indexed ? keys : undefined);
  const stoppedByKey = stoppedOperation(context, node, [
    ...operands,
    { node: node.index, type: key },
  ]);
  if (stoppedByKey !== undefined) {
    return stoppedByKey;
  }
  if (byKey && rules.isKeyOf(key, container)) {
    context.fieldReads.record(node, keyedFieldRead(context.checker, container, key));
    return rules.fieldType(container, key);
  }
  if (byKey && !indexed) {
    context.fit(key, keys, node.index);
    return errorType;
  }
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
    hint: () => insideOptional(node.target.span, container, '['),
  });
}

/** Whether a struct type declares an `index` taking its value, which a key gives way to (§3.9). */
function declaresIndex(context: BodyContext, container: Type): boolean {
  const { checker, module } = context;
  return topLevelCandidates(checker, module, collectionFunctions.index, [container]).some(
    (candidate) => takesAsSelf(checker, candidate, container),
  );
}
