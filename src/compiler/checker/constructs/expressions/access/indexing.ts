/**
 * Indexing and slicing (§3.9): `x[k]` calls `index(x, k)`, found like an operator's function, so
 * any type with an `index` can be indexed, and slicing is indexing with a `Range`. Writing an
 * element is the rule of places (resolution/calls/places.ts). An index can be a link of an optional
 * chain (constructs/expressions/access/optionals.ts), as in `a?.items[0]`.
 *
 * A struct is indexed by its keys first (§3.1, §3.9): `s[k]` with `k` within `keyof S` reads the
 * field `k` names, typed `S[K]`, before any `index`. Where `S` declares no `index` of its own, the
 * brackets expect a key, so a literal there is one (`s["region"]`); where it does, a key is what
 * a key's type makes one, and anything else calls `index`, chosen as its call is: a literal key
 * has its literal type where `index` takes one, as `K in keyof S` does.
 */

import { collectionFunctions } from '../../../../../foundation/language/well-known/implicit-calls.ts';
import type { Index } from '../../../../syntax/expressions/index.ts';
import { unparenthesized } from '../../../../syntax/expressions/readings.ts';
import type { BodyContext } from '../../../contexts/body-context.ts';
import { resolveCall } from '../../../resolution/calls/resolve/index.ts';
import { stoppedOperation } from '../../../resolution/calls/stopped-operations.ts';
import { topLevelCandidates } from '../../../resolution/choosing/candidates.ts';
import { takesAsSelf } from '../../../resolution/choosing/receivers.ts';
import { keyedFieldRead } from '../../../surface/checked-field.ts';
import type { Type } from '../../../types/type/index.ts';
import { errorType } from '../../../types/type/primitives.ts';
import { insideOptional } from '../../../types/unions/inside-optional.ts';
import { writtenLiteral } from '../../../types/unions/unions.ts';

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
  const key = context.settled(node.index, byKey && !indexed ? keys : undefined);
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
  const literal = writtenLiteral(unparenthesized(node.index));
  const resolve = () =>
    resolveCall(context, {
      site: node,
      name: '[]',
      candidates: topLevelCandidates(context.checker, context.module, collectionFunctions.index, [
        container,
        key,
      ]),
      arguments: [
        { node: node.target, type: container, passing: 'value' },
        { node: node.index, type: key, passing: 'value', literal },
      ],
      typeArguments: undefined,
      expected,
      form: 'operator',
      hint: () => insideOptional(node.target.span, container, '['),
    });
  // A link continuing an optional chain is called in a scope of its own, as a call continuing one is.
  return context.chains.continues(node) ? context.scopes.isolated(resolve) : resolve();
}

/** Whether a struct type declares an `index` taking its value, which a key gives way to (§3.9). */
function declaresIndex(context: BodyContext, container: Type): boolean {
  const { checker, module } = context;
  return topLevelCandidates(checker, module, collectionFunctions.index, [container]).some(
    (candidate) => takesAsSelf(checker, candidate, container),
  );
}
