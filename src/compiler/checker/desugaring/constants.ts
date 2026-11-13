/**
 * The constants a core tree holds values in (§3.4): a `const` the desugaring declares and binds,
 * so a value computed once is read wherever the core needs it, and in the order the sugar computes
 * it.
 *
 * - Its name stands where the sugar says, so what sees it is decided by where names are declared
 *   (constructs/closures/functions.ts), as for a written one.
 * - Each read is a node of its own, at the span of the value it holds, so a report at it points
 *   at the code written.
 * - A core declaring constants is a block expression (§4), its value last.
 */

import { variableEntity } from '../../binder/entities.ts';
import type { Expression } from '../../syntax/expressions/index.ts';
import type { VariableDeclaration } from '../../syntax/statements/index.ts';
import type { Identifier } from '../../syntax/tree/node.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import { bound, type Origin, synthesized } from '../contexts/synthesized.ts';
import type { CoreExpression } from '../surface/checked-body.ts';

/** A constant built for a sugar: its declaration, and a read of it. */
export interface HeldConstant {
  readonly declaration: VariableDeclaration;
  /** A read of the constant, a node of its own, built as `origin` says. */
  readonly read: (origin: Origin) => Identifier;
}

/** A constant holding `value`, its name standing at `at`, declared as `origin` says. */
export function heldConstant(value: Expression, at: AnchoredSpan, origin: Origin): HeldConstant {
  const text = value.kind === 'Identifier' ? value.text : 'value';
  const name = synthesized(origin, { kind: 'Identifier', span: at, text } as const);
  const pattern = synthesized(origin, {
    kind: 'NamePattern',
    span: at,
    path: [name],
    typeArguments: [],
  } as const);
  const declaration = synthesized(origin, {
    kind: 'VariableDeclaration',
    span: value.span,
    hold: undefined,
    isMutable: false,
    targets: [pattern],
    type: undefined,
    initializer: value,
  } as const);
  const entity = variableEntity(name, declaration);
  bound(name, entity);
  return {
    declaration,
    read: (reading) =>
      bound(synthesized(reading, { kind: 'Identifier', span: value.span, text } as const), entity),
  };
}

/** `value` computed after `constants` are, as one block expression at `span`. */
export function afterConstants(
  constants: readonly VariableDeclaration[],
  value: Expression,
  span: AnchoredSpan,
  origin: Origin,
): CoreExpression {
  const tail = synthesized(origin, {
    kind: 'ExpressionStatement',
    span: value.span,
    expression: value,
  } as const);
  const block = synthesized(origin, { kind: 'Block', span, statements: [...constants, tail] });
  return synthesized(origin, { kind: 'BlockExpression', span, block } as const);
}
