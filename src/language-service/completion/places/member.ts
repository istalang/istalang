/**
 * A member's place: after a member's operator (`.`, `?.`, `->`, `?->`), what the value before it
 * has: its fields, and the methods and statics a call through it may choose (checker
 * lookup/members.ts); after a namespace, what its module exports; after a type, its statics and
 * variants.
 *
 * Only a member can follow a `.` or `?.`, so where none can stand there, as after a name on a line
 * of its own at the top level, the place is still a member's and nothing is offered: never the
 * visible names. A `->` also starts a function's result type, so it makes a member's place only
 * where the tree reads a member access.
 *
 * A link of an optional chain offers what the value its step works on has, as checking found it
 * (§4): the value inside after `?.`, and nothing after a `?.` on a value that isn't optional.
 */

import type { Checker } from '../../../compiler/checker/check.ts';
import type { FunctionDeclaration } from '../../../compiler/syntax/declarations.ts';
import { chainStepOf } from '../../../compiler/syntax/expressions/chains.ts';
import {
  type Expression,
  type MemberAccess,
  qualifiedPath,
} from '../../../compiler/syntax/expressions/index.ts';
import type { Identifier } from '../../../compiler/syntax/node.ts';
import { spanIn } from '../../../compiler/syntax/positions.ts';
import type { Token } from '../../../compiler/syntax/tokens.ts';
import {
  nodesAt,
  parentOf,
  type SyntaxNode,
  type SyntaxTree,
} from '../../../compiler/syntax/tree.ts';
import { identifierAt } from '../../identifier-at.ts';
import { importedModule } from '../../namespaces.ts';
import type { Candidate } from '../candidate.ts';
import { type Cursor, touchingBefore } from '../cursor.ts';

/**
 * Where a member is written: after a namespace or a type, `head` names it; after a value, `access`
 * reads it. A qualified name in a type or a pattern has a head alone; after a `.` where no member
 * can stand, neither is known.
 */
export interface MemberPlace {
  readonly kind: 'member';
  readonly head: Identifier | undefined;
  readonly access: MemberAccess | undefined;
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
  if (before === undefined || !memberOnlyOperators.has(before.kind)) {
    return undefined;
  }
  return (
    (before.kind === '.' ? unfinishedQualifierAt(tree, before) : undefined) ?? {
      kind: 'member',
      head: undefined,
      access: undefined,
    }
  );
}

/**
 * A qualifier whose name isn't written yet in a type or a pattern, `time.` in `t: time.` or
 * `Color.` in `case Color.:`: the parser ends the name before the `.` and reads the `.` apart from
 * it, as an invalid node or a member access of nothing, so the qualifier is the type's or the
 * pattern's name right before `dot`.
 */
function unfinishedQualifierAt(tree: SyntaxTree, dot: Token): MemberPlace | undefined {
  const head = identifierAt(tree, dot.span.start);
  const holder = head && parentOf(tree, head);
  const qualifies = holder?.kind === 'NamedType' || holder?.kind === 'NamePattern';
  return head !== undefined && qualifies && spanIn(tree, head.span).end === dot.span.start
    ? { kind: 'member', head, access: undefined }
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
    return { kind: 'member', head: qualifiedPath(node)?.at(-2), access: node };
  }
  if (node.kind === 'NamedType' || node.kind === 'NamePattern') {
    const head = node.path[node.path.findIndex((name, index) => index > 0 && reaches(name)) - 1];
    return head && { kind: 'member', head, access: undefined };
  }
  return undefined;
}

export function offerMembers(
  { checker, module, tree }: Cursor,
  { head, access }: MemberPlace,
): readonly Candidate[] {
  const named = head === undefined ? [] : checker.lookup.denotationsOf(module, head);
  for (const { declared, type } of named) {
    if (declared.kind === 'namespace') {
      const exported = importedModule(checker, declared.entity);
      return exported === undefined
        ? []
        : [...checker.bindings.exportsOf(exported.id)].map(([name, entity]) => ({
            name,
            subject: { kind: 'entity', entity },
          }));
    }
    if (declared.kind === 'type' && type !== undefined) {
      const { statics, variants } = checker.lookup.membersOf(module, type);
      return [
        ...functionsThrough('type', statics),
        ...variants.map(
          (variant): Candidate => ({ name: variant.name, subject: { kind: 'variant', variant } }),
        ),
      ];
    }
  }
  return access === undefined ? [] : valueMembers(checker, module, tree, access);
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
