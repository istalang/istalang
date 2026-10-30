/**
 * A member's place: after a member's operator (`.`, `?.`, `->`, `?->`), what the value before it
 * has: its fields, and the methods and statics a call through it may choose (checker
 * lookup/members.ts); after a namespace, what its module exports; after a type, its statics and
 * variants. A qualified name offers only what its place takes: in a type, a namespace's types and
 * nothing of a type's; naming what a literal builds or a pattern matches, a namespace's types and a
 * type's variants.
 *
 * Only a member can follow a `.` or `?.`, so where none can stand there, as after a name on a line
 * of its own at the top level, the place is still a member's and nothing is offered: never the
 * visible names. A `->` also starts a function's result type, so it makes a member's place only
 * where the tree reads a member access.
 *
 * A link of an optional chain offers what the value its step works on has, as checking found it
 * (§4): the value inside after `?.`, and nothing after a `?.` on a value that isn't optional.
 *
 * A `.` typed right after an integer may start its fraction (`1.5`), so it opens no list; asked
 * for, the integer's members are offered, since `2.toString()` calls one (§2).
 */

import { type NamespaceEntity, namesType } from '../../../compiler/binder/entities.ts';
import type { Checker } from '../../../compiler/checker/check.ts';
import type { Type } from '../../../compiler/checker/types/type.ts';
import type { FunctionDeclaration } from '../../../compiler/syntax/declarations.ts';
import { chainStepOf } from '../../../compiler/syntax/expressions/chains.ts';
import {
  type Expression,
  type MemberAccess,
  qualifiedPath,
} from '../../../compiler/syntax/expressions/index.ts';
import type { Identifier } from '../../../compiler/syntax/node.ts';
import type { NamePattern } from '../../../compiler/syntax/patterns.ts';
import { spanIn } from '../../../compiler/syntax/positions.ts';
import {
  nodesAt,
  parentOf,
  type SyntaxNode,
  type SyntaxTree,
} from '../../../compiler/syntax/tree.ts';
import type { NamedType } from '../../../compiler/syntax/types.ts';
import { importedModule } from '../../namespaces.ts';
import type { Candidate } from '../candidate.ts';
import { type Cursor, touchingBefore } from '../cursor.ts';

/**
 * Where a member is written: after a namespace or a type, `head` names it; after a value, `access`
 * reads it. A qualified name in a type or a pattern has a head alone; after a `.` where no member
 * can stand, neither is known. `names` is what the member names: a value or a value's member, a
 * type, or a struct or variant a literal builds or a pattern matches.
 */
export interface MemberPlace {
  readonly kind: 'member';
  readonly head: Identifier | undefined;
  readonly access: MemberAccess | undefined;
  readonly names: 'value' | 'type' | 'variant';
}

/** What builds or matches the struct or variant its NamedType names. */
const namingVariants: ReadonlySet<string> = new Set([
  'StructLiteral',
  'NewStructLiteral',
  'StructPattern',
]);

/** What the qualified name `holder` holds names. */
function namedBy(tree: SyntaxTree, holder: NamedType | NamePattern): 'type' | 'variant' {
  const parent = parentOf(tree, holder);
  return holder.kind === 'NamePattern' || (parent !== undefined && namingVariants.has(parent.kind))
    ? 'variant'
    : 'type';
}

/** What a member's name is written right after (§4). */
const memberOperators: ReadonlySet<string> = new Set(['.', '?.', '->', '?->']);

/** What only a member can follow. */
const memberOnlyOperators: ReadonlySet<string> = new Set(['.', '?.']);

/**
 * The member place the cursor is in: a member's name, or the spot right after its operator, as a
 * member access has it (`a.b`, `a?.b`, `a->b`, its name missing while unwritten), or a qualified
 * name's later segment. A member spelled as a keyword so far (`xs.in` on the way to `includes`)
 * is no name to the parser, which ends the access at its operator, so the place is looked up
 * there.
 */
export function memberPlaceAt(cursor: Cursor): MemberPlace | undefined {
  const { tree, offset } = cursor;
  const before = touchingBefore(cursor);
  const at = before !== undefined && memberOperators.has(before.kind) ? before.span.end : offset;
  for (const node of nodesAt(tree, at - 1).toReversed()) {
    const place = memberPlaceOf(tree, node, at);
    if (place !== undefined) {
      return place;
    }
  }
  return before !== undefined && memberOnlyOperators.has(before.kind)
    ? { kind: 'member', head: undefined, access: undefined, names: 'value' }
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
    return { kind: 'member', head: qualifiedPath(node)?.at(-2), access: node, names: 'value' };
  }
  if (node.kind === 'NamedType' || node.kind === 'NamePattern') {
    const head = node.path[node.path.findIndex((name, index) => index > 0 && reaches(name)) - 1];
    return head && { kind: 'member', head, access: undefined, names: namedBy(tree, node) };
  }
  return undefined;
}

export function offerMembers(
  cursor: Cursor,
  { head, access, names }: MemberPlace,
): readonly Candidate[] {
  const { checker, module, tree } = cursor;
  const named = head === undefined ? [] : checker.lookup.denotationsOf(module, head);
  for (const { declared, type } of named) {
    if (declared.kind === 'namespace') {
      return exportsNaming(checker, declared.entity, names);
    }
    if (declared.kind === 'type' && type !== undefined) {
      return typeMembers(checker, module, type, names);
    }
  }
  return access === undefined || startsFraction(cursor, access)
    ? []
    : valueMembers(checker, module, tree, access);
}

/** What `namespace`'s module exports; its types alone where no value is named. */
function exportsNaming(
  checker: Checker,
  namespace: NamespaceEntity,
  names: MemberPlace['names'],
): readonly Candidate[] {
  const exported = importedModule(checker, namespace);
  const exports = exported === undefined ? [] : [...checker.bindings.exportsOf(exported.id)];
  return exports
    .filter(([, entity]) => names === 'value' || namesType(entity))
    .map(([name, entity]) => ({ name, subject: { kind: 'entity', entity } }));
}

/** What a type has through its name: its variants, and for a value its statics too. */
function typeMembers(
  checker: Checker,
  module: Cursor['module'],
  type: Type,
  names: MemberPlace['names'],
): readonly Candidate[] {
  if (names === 'type') {
    return [];
  }
  const { statics, variants } = checker.lookup.membersOf(module, type);
  return [
    ...(names === 'value' ? functionsThrough('type', statics) : []),
    ...variants.map(
      (variant): Candidate => ({
        name: variant.name,
        subject: { kind: 'variant', variant, enum: type },
      }),
    ),
  ];
}

/** Whether the `.` just typed reads after an integer, which it may be on the way to a float. */
function startsFraction({ trigger }: Cursor, access: MemberAccess): boolean {
  return trigger === '.' && access.target.kind === 'IntegerLiteral';
}

function valueMembers(
  checker: Checker,
  module: Cursor['module'],
  tree: SyntaxTree,
  access: MemberAccess,
): readonly Candidate[] {
  const body = checker.lookup.bodyHolding(module, access);
  const value = body && (body.chainOf(linkOf(tree, access))?.base ?? body.typeOf(access.target));
  if (value === undefined) {
    return [];
  }
  const { fields, methods } = checker.lookup.membersOf(module, value, access);
  return [
    ...fields.map((field): Candidate => ({ name: field.name, subject: { kind: 'field', field } })),
    ...functionsThrough('value', methods),
  ];
}

/**
 * The link of an optional chain `access` is read by, if it is one (§4): a method call takes the
 * access's step, so its call is the link; any other access is its own.
 */
function linkOf(tree: SyntaxTree, access: MemberAccess): Expression {
  const parent = parentOf(tree, access);
  return parent?.kind === 'Call' && chainStepOf(parent)?.target === access.target ? parent : access;
}

/** One candidate per name, overloads alike, naming one of them. */
function functionsThrough(
  through: 'value' | 'type',
  functions: readonly FunctionDeclaration[],
): readonly Candidate[] {
  const byName = new Map(functions.map((each) => [each.name.text, each]));
  return [...byName].map(([name, declaration]) => ({
    name,
    subject: { kind: 'function', declaration, through },
  }));
}
