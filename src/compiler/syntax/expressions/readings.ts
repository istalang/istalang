/**
 * Reading expression nodes as the language means them: what a struct literal's item gives, a
 * qualified name written as member accesses, an expression without its parentheses, what a call
 * calls by name and the type arguments it gives it, and the cases a `match` or a `select` holds
 * without the ones the parser refused. The nodes themselves are in
 * index.ts, which these reads build on.
 */

import type { SyntaxNode } from '../tree/index.ts';
import type { Identifier, QualifiedName } from '../tree/node.ts';
import type { TypeNode } from '../types/index.ts';
import type { Call, Expression, FieldItem, Match, MatchCase, Select, SelectCase } from './index.ts';

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

/**
 * What `call` calls by name, without the type arguments written after it, which are the call's
 * (§3.5): `f` of `f<Int>(x)`. An optional call's callee is a value, type arguments and all (§4).
 */
export function calledName(call: Call): Expression {
  const { callee } = call;
  return callee.kind === 'TypeApplication' && !call.isOptional ? callee.target : callee;
}

/** The type arguments `call` gives the function it calls (`calledName`), if any. */
export function callTypeArguments(call: Call): readonly TypeNode[] | undefined {
  const { callee } = call;
  return callee.kind === 'TypeApplication' && !call.isOptional ? callee.typeArguments : undefined;
}

/**
 * The call `node` is the callee of, among `holders`, the nodes holding it innermost first: as
 * written, or by name before type arguments that are the call's (`calledName`); undefined when it
 * is no callee.
 */
export function callOfCallee(node: SyntaxNode, holders: readonly SyntaxNode[]): Call | undefined {
  const [holder, outer] = holders;
  if (holder?.kind === 'TypeApplication' && holder.target === node) {
    return outer?.kind === 'Call' && calledName(outer) === node ? outer : undefined;
  }
  return holder?.kind === 'Call' && holder.callee === node ? holder : undefined;
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

/**
 * Whether `node` is a literal of items naming no type: a tuple, an array or map literal, a
 * `struct{…}` or an indented value naming no type, maybe parenthesized. Its type is its items',
 * so it converts as they do (§3.5); a literal naming its type is that type.
 */
export function isItemsLiteral(node: Expression): boolean {
  switch (node.kind) {
    case 'Tuple':
    case 'ArrayLiteral':
    case 'MapLiteral':
      return true;
    case 'StructLiteral':
    case 'IndentedValue':
      return node.type === undefined;
    case 'Parenthesized':
      return isItemsLiteral(node.expression);
    default:
      return false;
  }
}
