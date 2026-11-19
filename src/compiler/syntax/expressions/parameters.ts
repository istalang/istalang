/**
 * How a parameter reads as written (§6.1): what a diagnostic about it points at, and the type its
 * pattern names. A parameter binds a name, a pattern, or both (expressions/index.ts); the checker,
 * the binder and the tools all read those two through here, so a pattern parameter has one reading.
 *
 * A pattern names its parameter's type when it is a struct pattern written with its type,
 * `Point{x, y}` or `Pair<Int, String>{first, second}`, parentheses aside. A `struct{…}` or tuple
 * pattern names none, so its parameter takes its type from an annotation, a default or the
 * function type a lambda is expected as.
 */

import { type Pattern, type StructPattern, targetNames } from '../patterns.ts';
import type { Identifier, Invalid } from '../tree/node.ts';
import { type NamedType, unparenthesizedType } from '../types/index.ts';
import type { Expression, Parameter } from './index.ts';

/** What a diagnostic about `parameter` points at: its name, or else the pattern it is instead. */
export function parameterSite(parameter: Parameter): Identifier | Pattern {
  return parameter.name === undefined ? parameter.pattern : parameter.name;
}

/** The names `parameter` binds: its pattern's, then its own, which names the whole argument. */
export function parameterNames(parameter: Parameter): readonly Identifier[] {
  const parts = parameter.pattern === undefined ? [] : targetNames(parameter.pattern);
  return parameter.name === undefined ? parts : [...parts, parameter.name];
}

/**
 * The type `parameter`'s pattern names, as written; undefined for a name or a pattern naming none.
 */
export function patternNamedType(parameter: Parameter): NamedType | undefined {
  return typingPattern(parameter)?.type;
}

/** The default values `parameters` write, in order. */
export function defaultValuesOf(
  parameters: readonly (Parameter | Invalid)[],
): readonly Expression[] {
  return parameters.flatMap((parameter) =>
    parameter.kind === 'Parameter' && parameter.defaultValue !== undefined
      ? [parameter.defaultValue]
      : [],
  );
}

/** Whether `parameter` writes its type: an annotation, or a pattern naming one. */
export function writesType(parameter: Parameter): boolean {
  return parameter.type !== undefined || patternNamedType(parameter) !== undefined;
}

/**
 * The struct pattern heading `parameter`'s pattern, parentheses aside, which names the parameter's
 * type when it is written with one.
 */
export function typingPattern(parameter: Parameter): StructPattern | undefined {
  let { pattern } = parameter;
  while (pattern?.kind === 'ParenthesizedPattern') {
    ({ pattern } = pattern);
  }
  return pattern?.kind === 'StructPattern' ? pattern : undefined;
}

/** Whether `node` is written as taking a reference, `&T` (§7.3), parentheses aside. */
export function writtenByReference(node: Parameter): boolean {
  return node.type !== undefined && unparenthesizedType(node.type).kind === 'ReferenceType';
}
