/**
 * The types an editor shows inline where source leaves them out (§3.4, §3.10, §3.14): after each
 * name a `let` or `const` declares with no written type, destructured ones included; after each
 * name a `for` binds; and after each parameter of a lambda written without its type. Each is the
 * type the identifier query gives the declaring name, the one a hover there shows.
 */

import { typeText } from '../compiler/checker/types/type-text.ts';
import type { ModuleId, Program } from '../compiler/program/program.ts';
import { type Identifier, isMissingName } from '../compiler/syntax/node.ts';
import { targetNames } from '../compiler/syntax/patterns.ts';
import { childrenOf, type SyntaxNode } from '../compiler/syntax/tree.ts';
import type { Span } from '../text/span.ts';
import { type CheckedModule, checkedModule } from './checked-module.ts';

export interface InlayHint {
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
  return untypedNames(checked.tree.root, span).flatMap((name) => {
    const type = declaredType(checked, name);
    const stands = span.start <= name.span.end && name.span.end <= span.end;
    return stands && type !== undefined && type.kind !== 'error'
      ? [{ offset: name.span.end, label: `: ${typeText(type)}` }]
      : [];
  });
}

/** The names declared with no written type in the nodes `span` reaches, in source order. */
function untypedNames(node: SyntaxNode, span: Span): readonly Identifier[] {
  if (node.span.end < span.start || span.end < node.span.start) {
    return [];
  }
  return [
    ...ownUntypedNames(node).filter((name) => !isMissingName(name)),
    ...childrenOf(node).flatMap((child) => untypedNames(child, span)),
  ];
}

function ownUntypedNames(node: SyntaxNode): readonly Identifier[] {
  switch (node.kind) {
    case 'VariableDeclaration':
      return node.type === undefined ? node.targets.flatMap(targetNames) : [];
    case 'For':
      return node.targets.flatMap(targetNames);
    case 'Lambda':
      return node.parameters.flatMap((parameter) =>
        parameter.kind === 'Parameter' && parameter.type === undefined ? [parameter.name] : [],
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
