/**
 * Reading expression nodes as the language means them: what a struct literal's item gives, a
 * qualified name written as member accesses, an expression without its parentheses, what a call
 * calls by name and the type arguments and arguments it gives it, and the cases a `match` or a
 * `select` holds without the ones the parser refused. The nodes themselves are in index.ts and
 * calls.ts, which these reads build on.
 *
 * A deferred call calls its taker as a call calls its callee (§3.14), so every read of what a call
 * calls takes either, and a taker written as a call is read as the deferred call's parts.
 */

import type { SyntaxNode } from '../tree/index.ts';
import type { Identifier, QualifiedName } from '../tree/node.ts';
import type { TypeNode } from '../types/index.ts';
import type { Call, CallArgument, CallingNode, DeferredCall } from './calls.ts';
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

/**
 * Whether `expression` has a deferred call's taker's shape (§3.14): a path of names, or a call of
 * one with its arguments in parentheses, `retry(times: 5)`.
 */
export function isTakerShaped(expression: Expression): boolean {
  const named =
    expression.kind === 'Call' && !expression.isOptional ? expression.callee : expression;
  return qualifiedPath(named) !== undefined;
}

/** A deferred call's taker where it is written as a call, `g(opts)` of `g(opts) f(x)`. */
function takerCallOf(node: DeferredCall): Call | undefined {
  return node.taker.kind === 'Call' ? node.taker : undefined;
}

/**
 * What `node` calls by name, without the type arguments written after it, which are the call's
 * (§3.5): `f` of `f<Int>(x)`; a deferred call's taker's path, which writes none (`isTakerShaped`).
 * An optional call's callee is a value, type arguments and all (§4).
 */
export function calledName(node: CallingNode): Expression {
  if (node.kind === 'DeferredCall') {
    return takerCallOf(node)?.callee ?? node.taker;
  }
  const { callee } = node;
  return callee.kind === 'TypeApplication' && !node.isOptional ? callee.target : callee;
}

/** The type arguments `node` gives the function it calls (`calledName`), if any. */
export function callTypeArguments(node: CallingNode): readonly TypeNode[] | undefined {
  if (node.kind === 'DeferredCall') {
    return undefined;
  }
  const { callee } = node;
  return callee.kind === 'TypeApplication' && !node.isOptional ? callee.typeArguments : undefined;
}

/**
 * The arguments `node` passes: those in its parentheses, a deferred call's taker's, none where the
 * taker is a path alone; then the function a call gives after them (`Call.given`), if any.
 */
export function writtenArgumentsOf(node: CallingNode): readonly CallArgument[] {
  if (node.kind === 'DeferredCall') {
    return takerCallOf(node)?.arguments ?? [];
  }
  return node.given === undefined ? node.arguments : [...node.arguments, node.given];
}

/** Whether `node` calls the function inside an optional, `f?.(…)` (§4); a taker never does. */
export function callsThroughOptional(node: CallingNode): boolean {
  return node.kind === 'Call' && node.isOptional;
}

/**
 * The node making the call `node` is the callee of, among `holders`, the nodes holding it
 * innermost first: as written, or by name before type arguments that are the call's
 * (`calledName`), which no taker writes; a deferred call where it is its taker or its taker's
 * callee; undefined when it is no callee.
 */
export function callOfCallee(
  node: SyntaxNode,
  holders: readonly SyntaxNode[],
): CallingNode | undefined {
  const [holder, ...outer] = holders;
  if (holder?.kind === 'TypeApplication' && holder.target === node) {
    const [call] = outer;
    return call?.kind === 'Call' && calledName(call) === node ? call : undefined;
  }
  if (holder?.kind === 'DeferredCall') {
    return holder.taker === node ? holder : undefined;
  }
  return holder?.kind === 'Call' && holder.callee === node ? makerOf(holder, outer) : undefined;
}

/**
 * The node making the call `call` writes: the deferred call whose taker it is, among `holders`,
 * the nodes holding it innermost first, else itself.
 */
export function makerOf(call: Call, holders: readonly SyntaxNode[]): CallingNode {
  const [holder] = holders;
  return holder?.kind === 'DeferredCall' && holder.taker === call ? holder : call;
}

/**
 * The call a deferred call makes later, without parentheses, a call or another deferred call;
 * undefined where it is neither, which the checker refuses (§3.14).
 */
export function deferredOf(node: DeferredCall): CallingNode | undefined {
  const call = unparenthesized(node.call);
  return call.kind === 'Call' || call.kind === 'DeferredCall' ? call : undefined;
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
