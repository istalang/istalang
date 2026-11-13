/**
 * The nodes a desugaring builds its core of, beside the written ones it reuses
 * (../contexts/synthesized.ts): each takes the span of the code it stands for and the origin it is
 * built as.
 *
 * - A name of the prelude's is bound to its declaration, whatever a local name shadows (§3.4).
 * - A value the core computes once is held in a `const` the desugaring declares and binds, read
 *   wherever the core needs it, in the order the sugar computes it. Its name stands where the sugar
 *   says, so what sees it is decided by where names are declared (constructs/closures/
 *   functions.ts), as for a written one; each read is a node of its own, at the span of the value
 *   it holds. A core declaring constants is a block expression (§4), its value last.
 */

import { languageModules } from '../../../foundation/language/well-known/index.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import { variableEntity } from '../../binder/entities.ts';
import type { Call, CallArgument } from '../../syntax/expressions/calls.ts';
import type { Expression } from '../../syntax/expressions/index.ts';
import type { StringLiteral } from '../../syntax/expressions/literals/literals.ts';
import type { VariableDeclaration } from '../../syntax/statements/index.ts';
import type { Identifier } from '../../syntax/tree/node.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import type { BodyContext } from '../contexts/body-context.ts';
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

/** `callee(args…)` at `span`. */
export function callOf(
  origin: Origin,
  span: AnchoredSpan,
  callee: Expression,
  args: readonly CallArgument[],
): Call {
  return synthesized(origin, { kind: 'Call', span, callee, isOptional: false, arguments: args });
}

/** The prelude's `name` at `span`, bound to its declaration. */
export function preludeName(
  context: BodyContext,
  origin: Origin,
  name: string,
  span: AnchoredSpan,
): Identifier {
  const entity =
    context.checker.wellKnownEntity({ module: languageModules.prelude, name }) ??
    unreachable(`The prelude declares '${name}'.`);
  return bound(synthesized(origin, { kind: 'Identifier', span, text: name } as const), entity);
}

/** The String `value` at `span`. */
export function stringOf(origin: Origin, span: AnchoredSpan, value: string): StringLiteral {
  return synthesized(origin, { kind: 'StringLiteral', span, value });
}
