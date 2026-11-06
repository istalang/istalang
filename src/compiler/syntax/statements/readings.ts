/**
 * Reading statements as the language means them (§4, §7): a block's tail, which gives its value,
 * the name a `drop` releases, and what a construct running over a struct's fields checks once per
 * field.
 */

import type { Expression, FieldComprehension, StructComprehension } from '../expressions/index.ts';
import { unparenthesized } from '../expressions/readings.ts';
import type { Identifier, NodeOf } from '../node.ts';
import type { Block, Drop, FieldLoop } from './index.ts';

/** The name `drop` releases, parentheses seen through; undefined when it drops a value (§7). */
export function droppedName(node: Drop): Identifier | undefined {
  const value = unparenthesized(node.value);
  return value.kind === 'Identifier' ? value : undefined;
}

/**
 * A construct running over a struct's fields (§4): a field loop, an array or a struct
 * comprehension.
 */
export type OverFields = FieldLoop | FieldComprehension | StructComprehension;

export function isOverFields(node: { readonly kind: string }): node is OverFields {
  return overFieldsKinds.has(node.kind);
}

/**
 * What `node`'s passes check once per field, beside its header's key and value: a loop's or an
 * array comprehension's body, a struct comprehension's bracketed key and value.
 */
export function passedParts(node: OverFields): readonly (Block | Expression)[] {
  switch (node.kind) {
    case 'FieldLoop':
      return [node.body];
    case 'FieldComprehension':
      return [node.body];
    default:
      return [node.key, node.value];
  }
}

/**
 * The expression whose value is the block's (§4): its last statement's, when that is an
 * expression statement. A block ending in any other statement, or empty, has none, and is `Unit`
 * or `Never`.
 */
export function tailExpressionOf(block: Block): Expression | undefined {
  const last = block.statements.at(-1);
  return last?.kind === 'ExpressionStatement' ? last.expression : undefined;
}

/**
 * Where a block's value comes from, for a report about it: its tail expression, last statement, or
 * itself.
 */
export function tailNodeOf(block: Block): NodeOf<string> {
  return tailExpressionOf(block) ?? block.statements.at(-1) ?? block;
}

const overFieldsKinds: ReadonlySet<string> = new Set<OverFields['kind']>([
  'FieldLoop',
  'FieldComprehension',
  'StructComprehension',
]);
