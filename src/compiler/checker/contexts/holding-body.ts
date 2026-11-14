/**
 * The checked body holding a node, found from where the node stands in its module's item. Five
 * owners check bodies: a function (its body, and its parameters' defaults as one body), the
 * function a struct's or a variant's fields read as (their defaults), a top-level constant (its
 * initializer and targets), a context constant (its initializer), and an annotation, whose value is
 * checked on its own wherever it stands. A lambda or local function is checked in the body holding
 * it, so it owns none. Read at a node, the passes of the field loops around it read as one
 * (pass-views.ts).
 */

import type { ModuleId } from '../../program/program.ts';
import { type FieldsFunction, fieldsFunctionOf } from '../../syntax/declarations/field-defaults.ts';
import { type FunctionDeclaration, isDefaultOf } from '../../syntax/declarations/index.ts';
import type { Annotation } from '../../syntax/items.ts';
import { ancestorsOf, type SyntaxNode } from '../../syntax/tree/index.ts';
import type { CheckedBody } from '../surface/checked-body.ts';
import type { JoinedBody } from '../surface/denotation.ts';
import type { CheckerContext } from './context.ts';
import { passesAround } from './pass-views.ts';

/** What finding a holding body reads of the checker. */
type BodyOwners = Pick<
  CheckerContext,
  | 'inputs'
  | 'bodyOf'
  | 'defaultsOf'
  | 'constantBodyOf'
  | 'contextConstants'
  | 'annotations'
  | 'typeRules'
>;

/**
 * The checked body holding `node` of `module`, as the passes of the field loops around it read
 * it, joined (pass-views.ts); undefined outside every body.
 */
export function bodyHolding(
  checker: BodyOwners,
  module: ModuleId,
  node: SyntaxNode,
): JoinedBody | undefined {
  const body = checkedBodyHolding(checker, module, node);
  const path = ancestorsOf(checker.inputs.treeOf(module), node);
  return body === undefined ? undefined : passesAround(body, path, checker.typeRules);
}

/**
 * The checked body holding `node` of `module`, as checked: a field loop around it read as the body
 * holding the loop; undefined outside every body.
 */
function checkedBodyHolding(
  checker: BodyOwners,
  module: ModuleId,
  node: SyntaxNode,
): CheckedBody | undefined {
  const path = ancestorsOf(checker.inputs.treeOf(module), node);
  const annotation = path.find((each): each is Annotation => each.kind === 'Annotation');
  return annotation === undefined
    ? bodyInModule(checker, path)
    : checker.annotations.bodyOf(module, annotation);
}

/** The body holding the innermost of `path`, a node and the nodes holding it up to its module. */
function bodyInModule(checker: BodyOwners, path: readonly SyntaxNode[]): CheckedBody | undefined {
  const [root, ...inward] = path.toReversed();
  return root?.kind === 'Module' ? bodyInItem(checker, inward) : undefined;
}

/** The body holding the innermost of `inward`, an item and the nodes inside it down to a node. */
function bodyInItem(
  checker: BodyOwners,
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
    case 'ContextConstantDeclaration':
      return part === item.initializer ? checker.contextConstants.bodyOf(item) : undefined;
    case 'StructDeclaration':
    case 'SharedStructDeclaration':
      return isDefaultOf(part, inner)
        ? fieldDefaultsOf(checker, fieldsFunctionOf(item))
        : undefined;
    case 'EnumDeclaration':
      return part?.kind === 'Variant' && isDefaultOf(inner, innermost)
        ? fieldDefaultsOf(checker, fieldsFunctionOf(item, part))
        : undefined;
    default:
      return undefined;
  }
}

/**
 * The body holding `inner` inside `part` of the function `declaration`: its body, the one block a
 * function holds, where a parameter's pattern is declared too (§3.3), or its defaults.
 */
function bodyInFunction(
  checker: BodyOwners,
  declaration: FunctionDeclaration,
  part: SyntaxNode | undefined,
  inner: SyntaxNode | undefined,
): CheckedBody | undefined {
  if (part?.kind === 'Block' || (part?.kind === 'Parameter' && inner === part.pattern)) {
    return checker.bodyOf(declaration);
  }
  return isDefaultOf(part, inner) ? checker.defaultsOf(declaration) : undefined;
}

function fieldDefaultsOf(
  checker: BodyOwners,
  fields: FieldsFunction | undefined,
): CheckedBody | undefined {
  return fields === undefined ? undefined : checker.defaultsOf(fields);
}
