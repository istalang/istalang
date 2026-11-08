/**
 * Reading expression nodes as the language means them: what a struct literal's item gives, a
 * qualified name written as member accesses, an expression without its parentheses or the type
 * arguments after its name, and the cases a `match` or a `select` holds without the ones the
 * parser refused. The nodes themselves are in
 * index.ts, which these reads build on.
 */

import type { Identifier, QualifiedName } from '../tree/node.ts';
import type { Expression, FieldItem, Match, MatchCase, Select, SelectCase } from './index.ts';

/** The expression an item gives its field: its value, or for the shorthand, its own name. */
export function itemValue(item: FieldItem): Expression {
  return item.kind === 'FieldInitializer' ? (item.value ?? item.name) : item.value;
}

/** The field an item names; undefined for a positional item, which gives a struct's one field. */
export function itemName(item: FieldItem): Identifier | undefined {
  return item.kind === 'FieldInitializer' ? item.name : undefined;
}

/**
 * The names of a qualified name such as `m.Pair`, or undefined for any other expression. Until a
 * `{` or `<…>` follows, a qualified name parses as member accesses; this reads it back as the
 * names alone, whose spans the type or binder path keeps.
 */
export function qualifiedPath(expression: Expression): QualifiedName | undefined {
  const members: Identifier[] = [];
  let current: Expression = expression;
  while (current.kind === 'MemberAccess' && !current.isOptional) {
    members.unshift(current.member);
    current = current.target;
  }
  return current.kind === 'Identifier' ? [current, ...members] : undefined;
}

/** `node` without the type arguments written after its name (§3.5): `f` of `f<Int>`. */
export function withoutTypeArguments(node: Expression): Expression {
  return node.kind === 'TypeApplication' ? node.target : node;
}

/** `node` without the parentheses written around it, which change nothing about it. */
export function unparenthesized(node: Expression): Expression {
  return node.kind === 'Parenthesized' ? unparenthesized(node.expression) : node;
}

/** A `match`'s cases, without the invalid ones the parser reported. */
export function casesOf(node: Match): readonly MatchCase[] {
  return node.cases.filter((each) => each.kind === 'MatchCase');
}

/** A `select`'s cases, without the invalid ones the parser reported. */
export function selectCasesOf(node: Select): readonly SelectCase[] {
  return node.cases.filter((each) => each.kind === 'SelectCase');
}
