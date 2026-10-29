/**
 * The checked body holding a node, found from where the node stands in its module's item. Five
 * owners check bodies: a function (its body, and its parameters' defaults as one body), the
 * function a struct's or a variant's fields read as (their defaults), a top-level constant (its
 * initializer and targets), and an annotation, whose value is checked on its own wherever it
 * stands. A lambda or local function is checked in the body holding it, so it owns none.
 */

import { type ModuleId, programModule } from '../../program/program.ts';
import type { Annotation } from '../../syntax/annotations.ts';
import type { FunctionDeclaration } from '../../syntax/declarations.ts';
import { type FieldsFunction, fieldsFunctionOf } from '../../syntax/field-defaults.ts';
import { parentOf, type SyntaxNode, type SyntaxTree } from '../../syntax/tree.ts';
import type { CheckedBody } from '../check.ts';
import type { CheckerContext } from '../context.ts';

/** What finding a holding body reads of the checker. */
export type Holders = Pick<
  CheckerContext,
  'program' | 'bodyOf' | 'defaultsOf' | 'constantBodyOf' | 'annotations'
>;

/** `node` and the nodes holding it, innermost first, up to its module's root. */
export function ancestorsOf(tree: SyntaxTree, node: SyntaxNode): readonly SyntaxNode[] {
  const path = [node];
  for (let parent = parentOf(tree, node); parent !== undefined; parent = parentOf(tree, parent)) {
    path.push(parent);
  }
  return path;
}

/** The checked body holding `node` of `module`; undefined outside every body. */
export function bodyHolding(
  checker: Holders,
  module: ModuleId,
  node: SyntaxNode,
): CheckedBody | undefined {
  const path = ancestorsOf(programModule(checker.program, module).tree, node);
  const annotation = path.find((each): each is Annotation => each.kind === 'Annotation');
  if (annotation !== undefined) {
    return checker.annotations.bodyOf(annotation);
  }
  const [root, ...inward] = path.toReversed();
  return root?.kind === 'Module' ? bodyInItem(checker, inward) : undefined;
}

/** The body holding the innermost of `inward`, an item and the nodes inside it down to a node. */
function bodyInItem(
  checker: Holders,
  [item, part, inner, innermost]: readonly SyntaxNode[],
): CheckedBody | undefined {
  switch (item?.kind) {
    case 'FunctionDeclaration':
      return bodyInFunction(checker, item, part, inner);
    case 'TraitDeclaration':
      return part?.kind === 'FunctionDeclaration'
        ? bodyInFunction(checker, part, inner, innermost)
        : undefined;
    case 'VariableDeclaration':
      return part !== undefined && part !== item.type ? checker.constantBodyOf(item) : undefined;
    case 'StructDeclaration':
    case 'SharedStructDeclaration':
      return isDefault(part, inner) ? fieldDefaultsOf(checker, fieldsFunctionOf(item)) : undefined;
    case 'EnumDeclaration':
      return part?.kind === 'Variant' && isDefault(inner, innermost)
        ? fieldDefaultsOf(checker, fieldsFunctionOf(item, part))
        : undefined;
    default:
      return undefined;
  }
}

/** The body holding `inner` inside `part` of the function `declaration`: its body or defaults. */
function bodyInFunction(
  checker: Holders,
  declaration: FunctionDeclaration,
  part: SyntaxNode | undefined,
  inner: SyntaxNode | undefined,
): CheckedBody | undefined {
  if (part !== undefined && part === declaration.body) {
    return checker.bodyOf(declaration);
  }
  return isDefault(part, inner) ? checker.defaultsOf(declaration) : undefined;
}

/** Whether `value` is the default of `holder`, a parameter or a struct's or variant's field. */
function isDefault(holder: SyntaxNode | undefined, value: SyntaxNode | undefined): boolean {
  return (
    (holder?.kind === 'Parameter' || holder?.kind === 'DeclaredField') &&
    value !== undefined &&
    value === holder.defaultValue
  );
}

function fieldDefaultsOf(
  checker: Holders,
  fields: FieldsFunction | undefined,
): CheckedBody | undefined {
  return fields === undefined ? undefined : checker.defaultsOf(fields);
}
