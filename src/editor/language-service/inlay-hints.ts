/**
 * The types an editor shows inline where source leaves them out (§7.1, §8.2, §6.4): after each
 * name a `let` or `const` declares with no written type, destructured ones included; after each
 * name a `for` binds; and after each parameter of a lambda written without its type. Each is the
 * type the identifier query gives the declaring name, the one a hover there shows.
 */

import { typeText } from '../../compiler/checker/types/type/type-text.ts';
import type { ModuleId, Program } from '../../compiler/program/program.ts';
import { parameterNames } from '../../compiler/syntax/expressions/parameters.ts';
import { targetNames } from '../../compiler/syntax/patterns.ts';
import { declaredTargets } from '../../compiler/syntax/statements/targets.ts';
import {
  childrenOf,
  extentIn,
  type SyntaxNode,
  type SyntaxTree,
} from '../../compiler/syntax/tree/index.ts';
import { type Identifier, isMissingName } from '../../compiler/syntax/tree/node.ts';
import { spanIn } from '../../compiler/syntax/tree/positions.ts';
import type { Span } from '../../foundation/text/span.ts';
import { type CheckedModule, checkedModule } from './reading/checked-module.ts';

interface InlayHint {
  /** Where the hint stands: right after the name it types. */
  readonly offset: number;
  /** `: T`. */
  readonly label: string;
}

/** The hints standing within `span` of `module`. */
export function inlayHintsIn(program: Program, module: ModuleId, span: Span): readonly InlayHint[] {
  const checked = checkedModule(program, module);
  if (checked === undefined) {
    return [];
  }
  return untypedNames(checked.tree, checked.tree.root, span).flatMap((name) => {
    const type = declaredType(checked, name);
    const { end } = spanIn(checked.tree, name.span);
    const stands = span.start <= end && end <= span.end;
    return stands && type !== undefined && type.kind !== 'error'
      ? [{ offset: end, label: `: ${typeText(type)}` }]
      : [];
  });
}

/** The names declared with no written type in the nodes `span` reaches, in source order. */
function untypedNames(tree: SyntaxTree, node: SyntaxNode, span: Span): readonly Identifier[] {
  const extent = extentIn(tree, node);
  if (extent.end < span.start || span.end < extent.start) {
    return [];
  }
  return [
    ...ownUntypedNames(node).filter((name) => !isMissingName(name)),
    ...childrenOf(tree, node).flatMap((child) => untypedNames(tree, child, span)),
  ];
}

function ownUntypedNames(node: SyntaxNode): readonly Identifier[] {
  switch (node.kind) {
    case 'VariableDeclaration':
      return node.type === undefined ? node.targets.flatMap(targetNames) : [];
    case 'ContextConstantDeclaration':
      return node.type === undefined ? [node.name] : [];
    case 'For':
      return node.targets.flatMap(targetNames);
    case 'FieldHeader':
      return declaredTargets(node).flatMap(targetNames);
    case 'Lambda':
      return node.parameters.flatMap((parameter) =>
        parameter.kind === 'Parameter' && parameter.type === undefined
          ? parameterNames(parameter)
          : [],
      );
    default:
      return [];
  }
}

function declaredType({ checker, module }: CheckedModule, name: Identifier) {
  return checker.lookup
    .denotationsOf(module, name)
    .find(({ declared }) => declared.kind === 'variable')?.type;
}
