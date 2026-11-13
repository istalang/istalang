/**
 * Values a part is compared with (§3.11): a literal pattern, and a field compared by an operator.
 *
 * - A literal is compared with `==`, so it has the part's own type. On a union's value it first
 *   selects its member (../members.ts), so `case 1` against an `Int?` compares the `Int` held, and
 *   `case none` selects `None`. One the part's type can't hold is ruled out (§3.11), a `never` test
 *   (surface/checked-pattern.ts), and so is a field's `==` its type fixes to fail.
 * - A field compared with `==` or `!=` follows `==`'s rule (types/unions/equality.ts); any other
 *   comparison calls `compare`. Compared with `==` with a value fitting the field's type, it
 *   counts as a pattern for exhaustiveness (`opt == none` takes an optional's `None`).
 */

import type { Expression } from '../../../../../syntax/expressions/index.ts';
import {
  binaryOperators,
  isImplicitOperator,
} from '../../../../../syntax/expressions/operators.ts';
import type { CompareFieldPattern, LiteralPattern } from '../../../../../syntax/patterns.ts';
import type { BodyContext } from '../../../../contexts/body-context.ts';
import { checkerDiagnostics } from '../../../../diagnostics/index.ts';
import { implicitOperatorCall } from '../../../../resolution/applying/implicit.ts';
import type { PatternTest } from '../../../../surface/checked-pattern.ts';
import { isPrimitive, noneType } from '../../../../types/type/primitives.ts';
import { typeText } from '../../../../types/type/type-text.ts';
import { decidedEquality, fitEqualSides, isKnown } from '../../../../types/unions/equality.ts';
import { optionalInner } from '../../../../types/unions/unions.ts';
import { nameNodeOf } from '../../../../types/written/named-types.ts';
import { anyShape } from '../../exhaustiveness/exhaustiveness.ts';
import { literalShape, memberShape, nullaryShape } from '../../exhaustiveness/shapes.ts';
import type { ValuePart } from '../parts.ts';
import { failed, type Leaf, ruledOutLeaf } from '../pattern-tests.ts';

/**
 * A literal compared with its part by `==`; ruled out where the part's type can't hold it
 * (types/unions/equality.ts): `none` where no value of a known type is `none`.
 */
export function literal(context: BodyContext, node: LiteralPattern, part: ValuePart): Leaf {
  const { value } = node;
  if (value.kind === 'NoneLiteral') {
    if (isKnown(part.type) && context.checker.fitOf(noneType, part.type) === undefined) {
      return ruledOutLeaf;
    }
    context.expect(value, part.type);
    return isPrimitive(part.type, 'None') ? { tests: [], shape: anyShape } : failed;
  }
  const compared = { type: context.expression(value, part.type), node: value };
  const whole = { type: part.type, node: undefined };
  const compare = fitEqualSides(context, whole, compared);
  const { memberUnionOf } = context.checker.fitting;
  if (decidedEquality(whole, compared, compare, memberUnionOf) === false) {
    return ruledOutLeaf;
  }
  if (!compare) {
    context.report(
      checkerDiagnostics.typeMismatch(node.span, typeText(part.type), typeText(compared.type)),
    );
  }
  return { tests: [equalTest(part, value, false)], shape: valueShape(context, value, part) };
}

/**
 * A field compared by an operator: an ordering through `compare`, `==` and `!=` built in, ruled
 * out where the part's type fixes it to fail, and testing nothing where it fixes it to pass.
 */
export function comparison(context: BodyContext, item: CompareFieldPattern, part: ValuePart): Leaf {
  const { operator, value } = item;
  if (isImplicitOperator(operator)) {
    implicitOperatorCall(context, {
      node: item,
      operator,
      arguments: [
        { type: part.type, node: undefined },
        { type: context.expression(value), node: value },
      ],
    });
    return {
      tests: [
        {
          kind: 'compare',
          path: part.path,
          site: item,
          value: { kind: 'expression', node: value },
          relation: binaryOperators[operator].meaning.relation,
        },
      ],
      shape: undefined,
    };
  }
  const { negated } = binaryOperators[operator].meaning;
  const type = context.expression(value, part.type);
  const whole = { type: part.type, node: undefined };
  const compare = fitEqualSides(context, whole, { type, node: value });
  const { memberUnionOf } = context.checker.fitting;
  const equal = decidedEquality(whole, { type, node: value }, compare, memberUnionOf);
  if (equal !== undefined) {
    return equal === negated ? ruledOutLeaf : { tests: [], shape: undefined };
  }
  if (!compare) {
    context.report(
      checkerDiagnostics.operatorTypes(item.span, operator, [typeText(part.type), typeText(type)]),
    );
  }
  const counts = !negated && context.checker.fitOf(type, part.type) !== undefined;
  return {
    tests: [equalTest(part, value, negated)],
    shape: counts ? valueShape(context, value, part) : undefined,
  };
}

/**
 * The shape of a value a part is compared with, by `==` or as a literal pattern: a variant
 * without fields is that variant, a literal is itself, and `none` an optional's `None` member
 * (§3.11). Any other value acts as a guard.
 */
function valueShape(context: BodyContext, value: Expression, part: ValuePart) {
  if (value.kind === 'NoneLiteral') {
    return optionalInner(part.type) === undefined ? undefined : memberShape(noneType, anyShape);
  }
  const named = nameNodeOf(value);
  const entity = named === undefined ? undefined : context.entityOf(named);
  const isVariant = entity?.kind === 'variant' || entity?.kind === 'variants';
  return named !== undefined && isVariant ? nullaryShape(named.text) : literalShape(value);
}

function equalTest(part: ValuePart, value: Expression, negated: boolean): PatternTest {
  return { kind: 'equal', path: part.path, value: { kind: 'expression', node: value }, negated };
}
