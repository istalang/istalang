/**
 * What an editor offers to complete the name a cursor is on, or is about to start:
 * - after a member's operator (`.`, `?.`, `->`, `?->`), what the value before it has: its fields,
 *   and the methods and statics a call through it may choose (checker lookup/members.ts);
 * - after a namespace, what its module exports; after a type, its statics and variants;
 * - where a struct or variant literal's item names its field, the fields the literal builds that
 *   its other items don't give (§3.1);
 * - anywhere else, the names visible where the name starts (§3.4), then the keywords.
 *
 * Only a member can follow a `.` or `?.`, so where none can stand there, as after a name on a line
 * of its own at the top level, nothing is offered: never the visible names.
 *
 * The editor filters by what has been typed, so every candidate is offered whatever the prefix.
 * A link of an optional chain offers what the value its step works on has, as checking found it
 * (§4): the value inside after `?.`, and nothing after a `?.` on a value that isn't optional.
 */

import type { Entity } from '../compiler/binder/entities.ts';
import type { Checker } from '../compiler/checker/check.ts';
import type { TypeMembers } from '../compiler/checker/denotation.ts';
import { typeText } from '../compiler/checker/types/type-text.ts';
import type { ModuleId, Program } from '../compiler/program/program.ts';
import type { FunctionDeclaration } from '../compiler/syntax/declarations.ts';
import { chainStepOf } from '../compiler/syntax/expressions/chains.ts';
import {
  type Expression,
  type FieldsLiteral,
  type MemberAccess,
  qualifiedPath,
} from '../compiler/syntax/expressions/index.ts';
import type { Identifier } from '../compiler/syntax/node.ts';
import { spanIn } from '../compiler/syntax/positions.ts';
import { isKeyword, keywords, type Token } from '../compiler/syntax/tokens.ts';
import { nodesAt, parentOf, type SyntaxNode, type SyntaxTree } from '../compiler/syntax/tree.ts';
import { type CheckedModule, checkedModule } from './checked-module.ts';
import { identifierAt } from './identifier-at.ts';
import { importedModule } from './namespaces.ts';
import { signatureOf } from './signatures.ts';
import { codeTokensOf } from './tokens.ts';

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
  if (place !== undefined) {
    return memberCompletions(checked, place);
  }
  const before = tokenBefore(checked.tree, offset);
  if (before !== undefined && memberOnlyOperators.has(before.kind)) {
    return [];
  }
  const fields = fieldsAt(checked, offset);
  if (fields === undefined) {
    return scopeCompletions(checked, offset);
  }
  return fields.takesValue
    ? [...fields.offered, ...scopeCompletions(checked, offset)]
    : fields.offered;
}

/**
 * The candidates for a field's name in a struct or variant literal at `offset` of `module`;
 * undefined where no field's name stands.
 */
export function fieldCompletionsAt(
  program: Program,
  module: ModuleId,
  offset: number,
): readonly Completion[] | undefined {
  const checked = checkedModule(program, module);
  return checked && fieldsAt(checked, offset)?.offered;
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
 * Where a member is written: after a namespace or a type, `head` names it; after a value, `access`
 * reads it. A qualified name in a type or a pattern has a head alone.
 */
interface MemberPlace {
  readonly head: Identifier | undefined;
  readonly access: MemberAccess | undefined;
}

/**
 * The member place the cursor is in: a member's name, or the spot right after its operator, as a
 * member access has it (`a.b`, `a?.b`, `a->b`, its name missing while unwritten), or a qualified
 * name's later segment. A member spelled as a keyword so far (`xs.in` on the way to `includes`)
 * is no name to the parser, which ends the access at its operator, so the place is looked up
 * there.
 */
function memberPlaceAt(tree: SyntaxTree, offset: number): MemberPlace | undefined {
  const before = tokenBefore(tree, offset);
  const at = before !== undefined && memberOperators.has(before.kind) ? before.span.end : offset;
  for (const node of nodesAt(tree, at - 1).toReversed()) {
    const place = memberPlaceOf(tree, node, at);
    if (place !== undefined) {
      return place;
    }
  }
  return before?.kind === '.' ? unfinishedQualifierAt(tree, before) : undefined;
}

/** What a member's name is written right after (§4). */
const memberOperators: ReadonlySet<string> = new Set(['.', '?.', '->', '?->']);

/**
 * What only a member can follow. A `->` also starts a function's result type, where the visible
 * names are what is written.
 */
const memberOnlyOperators: ReadonlySet<string> = new Set(['.', '?.']);

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
    ? { head, access: undefined }
    : undefined;
}

/**
 * The name the cursor at `offset` is writing, a keyword's spelling included, if any; and the token
 * before it, or before `offset` when it writes none.
 */
function writingAt(
  tree: SyntaxTree,
  offset: number,
): { readonly name: Token | undefined; readonly before: Token | undefined } {
  const tokens = codeTokensOf(tree);
  const last = tokens.findLastIndex(({ span }) => span.start < offset);
  const written = tokens[last];
  const isName =
    written !== undefined &&
    written.span.end >= offset &&
    (written.kind === 'identifier' || isKeyword(written.kind));
  return isName
    ? { name: written, before: tokens[last - 1] }
    : { name: undefined, before: written };
}

/** The token right before what the cursor at `offset` writes; undefined when space parts them. */
function tokenBefore(tree: SyntaxTree, offset: number): Token | undefined {
  const { name, before } = writingAt(tree, offset);
  return before?.span.end === (name?.span.start ?? offset) ? before : undefined;
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
    return { head: qualifiedPath(node)?.at(-2), access: node };
  }
  if (node.kind === 'NamedType' || node.kind === 'NamePattern') {
    const head = node.path[node.path.findIndex((name, index) => index > 0 && reaches(name)) - 1];
    return head && { head, access: undefined };
  }
  return undefined;
}

/**
 * The fields the literal whose item's name the cursor is on, or would start, builds and its other
 * items don't give; none for a literal checking found no declared fields for. Undefined where no
 * field's name stands. Right after its `{`, a literal building one field also takes that field's
 * value without its name (§3.1), so a value may stand there too (`takesValue`).
 */
function fieldsAt(
  { checker, module, tree }: CheckedModule,
  offset: number,
): { readonly offered: readonly Completion[]; readonly takesValue: boolean } | undefined {
  const place = fieldPlaceAt(tree, offset);
  if (place === undefined) {
    return undefined;
  }
  const { literal, item, opens } = place;
  const fields = checker.lookup.bodyHolding(module, literal)?.literalFieldsOf(literal) ?? [];
  const given = new Set(
    literal.items.flatMap((each) =>
      each !== item && each.kind === 'FieldInitializer' ? [each.name.text] : [],
    ),
  );
  const offered = fields
    .filter(({ name }) => !given.has(name))
    .map(({ name, type }): Completion => ({ name, kind: 'field', detail: typeText(type) }));
  return { offered, takesValue: opens && fields.length === 1 };
}

/**
 * Where a field's name is written in a struct or variant literal: right after the literal's own
 * `{` (`opens`) or one of its `,`, the only tokens an item follows, whatever the parser made of a
 * name half written there (`item`, the item it starts) or of a literal not closed yet.
 */
function fieldPlaceAt(tree: SyntaxTree, offset: number): FieldPlace | undefined {
  const { name, before } = writingAt(tree, offset);
  if (before?.kind !== '{' && before?.kind !== ',') {
    return undefined;
  }
  const literal = nodesAt(tree, before.span.start).at(-1);
  if (!isFieldsLiteral(literal)) {
    return undefined;
  }
  const item = literal.items.find(
    ({ span }) => name !== undefined && spanIn(tree, span).start === name.span.start,
  );
  return { literal, item, opens: before.kind === '{' };
}

interface FieldPlace {
  readonly literal: FieldsLiteral;
  readonly item: FieldsLiteral['items'][number] | undefined;
  readonly opens: boolean;
}

function isFieldsLiteral(node: SyntaxNode | undefined): node is FieldsLiteral {
  return node?.kind === 'StructLiteral' || node?.kind === 'NewStructLiteral';
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
  { checker, module, tree }: CheckedModule,
  { head, access }: MemberPlace,
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
  if (access === undefined) {
    return [];
  }
  const body = checker.lookup.bodyHolding(module, access);
  const value = body && (body.chainOf(linkOf(tree, access))?.base ?? body.typeOf(access.target));
  return value === undefined
    ? []
    : valueMembers(checker, checker.lookup.membersOf(module, value, access));
}

/**
 * The link of an optional chain `access` is read by, if it is one (§4): a method call takes the
 * access's step, so its call is the link; any other access is its own.
 */
function linkOf(tree: SyntaxTree, access: MemberAccess): Expression {
  const parent = parentOf(tree, access);
  return parent?.kind === 'Call' && chainStepOf(parent)?.target === access.target ? parent : access;
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
