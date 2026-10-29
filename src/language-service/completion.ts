/**
 * What an editor offers to complete the name a cursor is on, or is about to start:
 * - after a member's operator (`.`, `?.`, `->`, `?->`), what the value before it has: its fields,
 *   and the methods and statics a call through it may choose (checker lookup/members.ts);
 * - after a namespace, what its module exports; after a type, its statics and variants;
 * - anywhere else, the names visible where the name starts (§3.4), then the keywords.
 *
 * The editor filters by what has been typed, so every candidate is offered whatever the prefix.
 * A value read through an optional chain offers what the value inside the optional has (§4).
 */

import type { Entity } from '../compiler/binder/entities.ts';
import type { Checker } from '../compiler/checker/check.ts';
import type { TypeMembers } from '../compiler/checker/denotation.ts';
import { typeText } from '../compiler/checker/types/type-text.ts';
import { optionalArgument } from '../compiler/checker/types/well-known.ts';
import type { ModuleId, Program } from '../compiler/program/program.ts';
import type { FunctionDeclaration } from '../compiler/syntax/declarations.ts';
import { isOptionallyChained } from '../compiler/syntax/expressions/chains.ts';
import type { Expression } from '../compiler/syntax/expressions/index.ts';
import type { Identifier } from '../compiler/syntax/node.ts';
import { spanIn } from '../compiler/syntax/positions.ts';
import { keywords } from '../compiler/syntax/tokens.ts';
import { nodesAt, type SyntaxNode, type SyntaxTree } from '../compiler/syntax/tree.ts';
import { type CheckedModule, checkedModule } from './checked-module.ts';
import { identifierAt } from './identifier-at.ts';
import { importedModule } from './namespaces.ts';
import { signatureOf } from './signatures.ts';

export type CompletionKind =
  | 'variable'
  | 'function'
  | 'method'
  | 'field'
  | 'type'
  | 'variant'
  | 'module'
  | 'keyword';

export interface Completion {
  readonly name: string;
  readonly kind: CompletionKind;
  /** A function's signature, or a field's type. */
  readonly detail?: string;
}

const entityKinds = {
  variable: 'variable',
  functions: 'function',
  type: 'type',
  primitive: 'type',
  self: 'type',
  variant: 'variant',
  variants: 'variant',
  namespace: 'module',
} as const satisfies Record<Entity['kind'], CompletionKind>;

/** The candidates for the name at `offset` of `module`. */
export function completionsAt(
  program: Program,
  module: ModuleId,
  offset: number,
): readonly Completion[] {
  const checked = checkedModule(program, module);
  if (checked === undefined) {
    return [];
  }
  const place = memberPlaceAt(checked.tree, offset);
  return place === undefined
    ? scopeCompletions(checked, offset)
    : memberCompletions(checked, place);
}

/** The candidates for a member at `offset` of `module`; undefined where no member is written. */
export function memberCompletionsAt(
  program: Program,
  module: ModuleId,
  offset: number,
): readonly Completion[] | undefined {
  const checked = checkedModule(program, module);
  const place = checked && memberPlaceAt(checked.tree, offset);
  return checked && place && memberCompletions(checked, place);
}

/**
 * Where a member is written: after a namespace or a type, `head` names it; after a value,
 * `receiver` is the expression giving the value, read through an optional when the member's link
 * is optionally chained (§4). A qualified name in a type or a pattern has a head alone.
 */
interface MemberPlace {
  readonly head: Identifier | undefined;
  readonly receiver: Expression | undefined;
  readonly isOptional: boolean;
}

/**
 * The member place the cursor is in: a member's name, or the spot right after its operator, as a
 * member access has it (`a.b`, `a?.b`, `a->b`, its name missing while unwritten), or a qualified
 * name's later segment.
 */
function memberPlaceAt(tree: SyntaxTree, offset: number): MemberPlace | undefined {
  for (const node of nodesAt(tree, offset - 1).toReversed()) {
    const place = memberPlaceOf(tree, node, offset);
    if (place !== undefined) {
      return place;
    }
  }
  return unfinishedQualifierAt(tree, offset);
}

/**
 * A qualifier whose name isn't written yet in a type or a pattern, `time.` in `t: time.` or
 * `Color.` in `case Color.:`: the parser ends the name before the `.` and reads the `.` apart from
 * it, as an invalid node or a member access of nothing, so the qualifier is the name right before
 * a `.` the cursor follows.
 */
function unfinishedQualifierAt(tree: SyntaxTree, offset: number): MemberPlace | undefined {
  const dot = offset - 1;
  const head = tree.source.text.charAt(dot) === '.' ? identifierAt(tree, dot) : undefined;
  return head !== undefined && spanIn(tree, head.span).end === dot
    ? { head, receiver: undefined, isOptional: false }
    : undefined;
}

function memberPlaceOf(
  tree: SyntaxTree,
  node: SyntaxNode,
  offset: number,
): MemberPlace | undefined {
  const reaches = (name: Identifier) => {
    const { start, end } = spanIn(tree, name.span);
    return start <= offset && offset <= end;
  };
  const isWritten = ({ span }: SyntaxNode) => span.from < span.to;
  if (node.kind === 'MemberAccess' && isWritten(node.target) && reaches(node.member)) {
    const { target } = node;
    const head = target.kind === 'MemberAccess' ? target.member : target;
    return {
      head: head.kind === 'Identifier' ? head : undefined,
      receiver: target,
      isOptional: isOptionallyChained(node),
    };
  }
  if (node.kind === 'NamedType' || node.kind === 'NamePattern') {
    const head = node.path[node.path.findIndex((name, index) => index > 0 && reaches(name)) - 1];
    return head && { head, receiver: undefined, isOptional: false };
  }
  return undefined;
}

function scopeCompletions({ checker, module, tree }: CheckedModule, offset: number) {
  const written = identifierAt(tree, offset);
  const start = written === undefined ? offset : spanIn(tree, written.span).start;
  return [
    ...[...checker.bindings.visibleAt(module, start)].map(
      ([name, entity]): Completion => ({ name, kind: entityKinds[entity.kind] }),
    ),
    ...keywords.map((keyword): Completion => ({ name: keyword, kind: 'keyword' })),
  ];
}

function memberCompletions(
  { checker, module }: CheckedModule,
  { head, receiver, isOptional }: MemberPlace,
): readonly Completion[] {
  const named = head === undefined ? [] : checker.lookup.denotationsOf(module, head);
  for (const { declared, type } of named) {
    if (declared.kind === 'namespace') {
      const exported = importedModule(checker, declared.entity);
      return exported === undefined
        ? []
        : [...checker.bindings.exportsOf(exported.id)].map(([name, entity]) => ({
            name,
            kind: entityKinds[entity.kind],
          }));
    }
    if (declared.kind === 'type' && type !== undefined) {
      const { statics, variants } = checker.lookup.membersOf(module, type);
      return [
        ...functionCompletions(checker, statics, 'function'),
        ...variants.map(({ name }): Completion => ({ name, kind: 'variant' })),
      ];
    }
  }
  const read = receiver && checker.lookup.bodyHolding(module, receiver)?.typeOf(receiver);
  const value = read && isOptional ? (optionalArgument(checker, read) ?? read) : read;
  return value === undefined ? [] : valueMembers(checker, checker.lookup.membersOf(module, value));
}

function valueMembers(checker: Checker, { fields, methods }: TypeMembers): readonly Completion[] {
  return [
    ...fields.map(
      ({ name, type }): Completion => ({ name, kind: 'field', detail: typeText(type) }),
    ),
    ...functionCompletions(checker, methods, 'method'),
  ];
}

/** One completion per name, overloads alike, with one overload's signature. */
function functionCompletions(
  checker: Checker,
  functions: readonly FunctionDeclaration[],
  kind: CompletionKind,
): readonly Completion[] {
  const byName = new Map(functions.map((each) => [each.name.text, each]));
  return [...byName].map(([name, declaration]) => ({
    name,
    kind,
    detail: signatureOf(checker, declaration).label,
  }));
}
