/**
 * How a function reads in an editor: a signature as source would declare it, built from its
 * checked parameters and result (`fn Pair.swap<A, B>(self: Pair<A, B>) -> Pair<B, A>`), with
 * where each parameter's text stands in it, for signature help to mark. Hover, signature help and
 * completion all show a function through this, so they never disagree on how one reads.
 *
 * Types read as messages spell them (checker types/type-text.ts). A default value reads as `…`,
 * since its text may span lines; type parameters read by name, as a call site names them. A
 * parameter's pattern reads as written, on one line, with its `as` name (§3.3); one naming its
 * type (`Point{x, y}`) shows no type beside it, as source writes none.
 */

import type { Checker, SignatureParameter } from '../../compiler/checker/check.ts';
import type { FunctionType } from '../../compiler/checker/types/type/index.ts';
import { functionTypeParts, slotText, typeText } from '../../compiler/checker/types/type-text.ts';
import { programModule } from '../../compiler/program/program.ts';
import {
  type FunctionDeclaration,
  typeParametersOf,
} from '../../compiler/syntax/declarations/index.ts';
import { patternNamedType } from '../../compiler/syntax/expressions/parameters.ts';
import type { Pattern } from '../../compiler/syntax/patterns.ts';
import { spanIn } from '../../compiler/syntax/positions.ts';
import type { SyntaxTree } from '../../compiler/syntax/tree.ts';
import { staticName } from '../../language/static-names.ts';
import { textOf } from '../../text/span.ts';

/** A signature's text, and where each parameter's text stands in it. */
export interface Signature {
  readonly label: string;
  readonly parameters: readonly ParameterLabel[];
}

/** Offsets into a signature's label, the end excluded. */
type ParameterLabel = readonly [start: number, end: number];

/** The signature `declaration` declares. */
export function signatureOf(checker: Checker, declaration: FunctionDeclaration): Signature {
  const { isAsync, owner, name, typeParameters } = declaration;
  const generics = typeParametersOf(typeParameters).map(
    (parameter) => `${parameter.isPack ? '...' : ''}${parameter.name.text}`,
  );
  const head = [
    isAsync ? 'async ' : '',
    'fn ',
    owner === undefined ? name.text : staticName(owner.text, name.text),
    generics.length === 0 ? '' : `<${generics.join(', ')}>`,
  ].join('');
  const { tree } = programModule(checker.program, checker.moduleOf(declaration));
  const parameters = checker
    .parametersOf(declaration)
    .map((parameter) => parameterText(tree, parameter));
  return joined(head, parameters, ` -> ${typeText(checker.resultOf(declaration))}`);
}

/** The signature of a function value of `type`, whose parameters have types but no names. */
export function functionTypeSignature(type: FunctionType): Signature {
  const { head, parameters, tail } = functionTypeParts(type);
  return joined(head, parameters, tail);
}

function parameterText(tree: SyntaxTree, parameter: SignatureParameter): string {
  const { node } = parameter;
  const { isRest, name, pattern, defaultValue } = node;
  const bound =
    pattern === undefined
      ? (name?.text ?? '')
      : `${patternText(tree, pattern)}${name === undefined ? '' : ` as ${name.text}`}`;
  const typedByPattern = node.type === undefined && patternNamedType(node) !== undefined;
  const written = `${isRest ? '...' : ''}${bound}${typedByPattern ? '' : `: ${slotText(parameter)}`}`;
  return defaultValue === undefined ? written : `${written} = …`;
}

/** `pattern` as written, its line breaks and the indentation after them read as one space. */
function patternText(tree: SyntaxTree, pattern: Pattern): string {
  return textOf(tree.source, spanIn(tree, pattern.span)).replace(/\s*\n\s*/gu, ' ');
}

function joined(head: string, parameters: readonly string[], tail: string): Signature {
  const labels: ParameterLabel[] = [];
  let label = `${head}(`;
  for (const [index, parameter] of parameters.entries()) {
    label += index === 0 ? '' : ', ';
    labels.push([label.length, label.length + parameter.length]);
    label += parameter;
  }
  return { label: `${label})${tail}`, parameters: labels };
}
