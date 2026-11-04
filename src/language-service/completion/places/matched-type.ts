/**
 * The type a pattern being written matches (§3.11), read down from the type the `match` subject or
 * the `is` operand has as checked: an alternative, a parenthesized or an `as` pattern matches its
 * whole; a struct pattern's item, the field it names, among those of the variant or struct the
 * pattern names (against an `any` value, the type it downcasts to); a nested field pattern, that
 * field's type; a tuple's element, its element's; an array's item, its item's, and its rest the
 * whole array.
 *
 * The patterns are read from the placeholder parse, which holds the one being written whole; the
 * subject and a struct pattern's name end before the cursor, so the checked tree types the one and
 * tells what the other denotes (checked-twin.ts).
 */

import type { Denotation } from '../../../compiler/checker/denotation.ts';
import { downcastTargetOf, namesOwnType } from '../../../compiler/checker/types/named-types.ts';
import type { AnyType, FieldMember, Type } from '../../../compiler/checker/types/type.ts';
import { arrayElement } from '../../../compiler/checker/types/well-known.ts';
import { type Identifier, lastName } from '../../../compiler/syntax/node.ts';
import type { NamePattern, StructPattern } from '../../../compiler/syntax/patterns.ts';
import type { SyntaxNode } from '../../../compiler/syntax/tree.ts';
import { checkedTwinOf } from '../checked-twin.ts';
import type { Cursor } from '../cursor.ts';
import { holderIn } from '../grammar/chain.ts';
import type { ParsedPlace } from '../placeholder.ts';

type Parsed = ParsedPlace['parsed'];

/**
 * The pattern the placeholder's name starts, its holder in `chain` being `holder`: a bare name,
 * or the struct pattern it names (`case Ok‸{value}`); undefined elsewhere.
 */
export function patternStartedBy(
  chain: readonly SyntaxNode[],
  holder: SyntaxNode,
): NamePattern | StructPattern | undefined {
  if (holder.kind === 'NamePattern') {
    return holder;
  }
  const pattern = holderIn(chain, holder);
  return pattern?.kind === 'StructPattern' && pattern.type === holder ? pattern : undefined;
}

/** The type `pattern`, a node of `parsed`'s chain, matches; undefined where it isn't known. */
export function matchedTypeOf(
  cursor: Cursor,
  parsed: Parsed,
  pattern: SyntaxNode,
): Type | undefined {
  const { chain } = parsed;
  const depth = chain.indexOf(pattern);
  const links = chain
    .slice(0, Math.max(depth, 0))
    .map((node, index) => ({ node, child: chain[index + 1], parent: chain[index - 1] }));
  return links.reduce<Type | undefined>((type, { node, child, parent }) => {
    const step = steps[node.kind] as Step<SyntaxNode> | undefined;
    return child === undefined ? undefined : step?.({ cursor, parsed, node, child, parent, type });
  }, undefined);
}

/** The fields a struct pattern's items name: its variant's, or its struct's. */
export function fieldsMatchedBy(
  cursor: Cursor,
  parsed: Parsed,
  pattern: StructPattern,
): readonly FieldMember[] {
  const type = matchedTypeOf(cursor, parsed, pattern);
  return type === undefined ? [] : fieldsOf(cursor, parsed, pattern, type);
}

/**
 * The fields `pattern`'s items may name against a value of `type`, by what its name denotes as
 * checked: a variant of `type`'s enum, which a bare name chooses by its name even before checking
 * resolved it, or `type`'s own struct, a shape an alias names among them (§3.17); against an `any`
 * type, the type it downcasts to, a struct, a shape or a qualified variant's enum, none generic
 * (§3.10). `struct{…}` names `type`'s own fields. A trait's required fields are no pattern's (patterns/parts.ts).
 */
function fieldsOf(
  cursor: Cursor,
  parsed: Parsed,
  pattern: StructPattern,
  type: Type,
): readonly FieldMember[] {
  const { checker } = cursor;
  if (pattern.type === undefined) {
    return type.kind === 'any' ? [] : (checker.fieldsOf(type) ?? []);
  }
  const name = lastName(pattern.type.path);
  const declared = denotationOf(cursor, parsed, name)?.declared;
  const own = type.kind === 'any' ? downcastOf(cursor, parsed, name, type) : type;
  if (own === undefined) {
    return [];
  }
  if (declared?.kind === 'type') {
    return namesOwnType(checker, declared.entity, own) ? (checker.fieldsOf(own) ?? []) : [];
  }
  const choosesByName = pattern.type.path.length === 1 && type.kind !== 'any';
  return variantFieldsOf(checker, own, { name, declared, choosesByName });
}

/**
 * The fields of the variant `name` of `own`'s enum: one a bare name chooses by its name, against a
 * value of the enum (`choosesByName`), or one a qualified name denotes, of that enum.
 */
function variantFieldsOf(
  checker: Cursor['checker'],
  own: Type,
  {
    name,
    declared,
    choosesByName,
  }: {
    readonly name: Identifier;
    readonly declared: Denotation['declared'] | undefined;
    readonly choosesByName: boolean;
  },
): readonly FieldMember[] {
  if (own.kind !== 'nominal') {
    return [];
  }
  const isDenoted = declared?.kind === 'variant' && declared.entity.enum === own.entity.declaration;
  return choosesByName || isDenoted
    ? (checker.variantsOf(own)?.find((variant) => variant.name === name.text)?.fields ?? [])
    : [];
}

/** What `name`, written before the cursor, denotes as checked. */
function denotationOf(cursor: Cursor, parsed: Parsed, name: Identifier): Denotation | undefined {
  const checked = checkedTwinOf(cursor, parsed.tree, name);
  return checked === undefined
    ? undefined
    : cursor.checker.lookup.denotationsOf(cursor.module, checked)[0];
}

/**
 * The type a downcast of a value of `from` to `name`, written before the cursor, tests for
 * (named-types.ts).
 */
function downcastOf(
  cursor: Cursor,
  parsed: Parsed,
  name: Identifier,
  from: AnyType,
): Type | undefined {
  const checked = checkedTwinOf(cursor, parsed.tree, name);
  const entity =
    checked === undefined ? undefined : cursor.checker.bindings.entityOf(cursor.module, checked);
  const target = entity === undefined ? undefined : downcastTargetOf(cursor.checker, entity, from);
  return target?.kind === 'type' ? target.type : undefined;
}

/** A link of the chain: `node`, its `child` on the way to the pattern, and what `node` matches. */
interface Link<Node extends SyntaxNode> {
  readonly cursor: Cursor;
  readonly parsed: Parsed;
  readonly node: Node;
  readonly child: SyntaxNode;
  readonly parent: SyntaxNode | undefined;
  readonly type: Type | undefined;
}

/** The type `link.child` matches; undefined where the child is no pattern, or isn't known. */
type Step<Node extends SyntaxNode> = (link: Link<Node>) => Type | undefined;

const whole: Step<SyntaxNode> = ({ type }) => type;

/** What a subject before the cursor has, as checked. */
function subjectType(
  { cursor, parsed }: Link<SyntaxNode>,
  subject: Extract<SyntaxNode, { kind: 'Match' | 'Is' }>['subject'],
): Type | undefined {
  const checked = checkedTwinOf(cursor, parsed.tree, subject);
  return checked === undefined
    ? undefined
    : cursor.checker.lookup.bodyHolding(cursor.module, checked)?.typeOf(checked);
}

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
const steps: { readonly [Kind in SyntaxNode['kind']]?: Step<Extract<SyntaxNode, { kind: Kind }>> } =
  {
    MatchCase: (link) =>
      link.child === link.node.pattern && link.parent?.kind === 'Match'
        ? subjectType(link, link.parent.subject)
        : undefined,
    Is: (link) =>
      link.child === link.node.pattern ? subjectType(link, link.node.subject) : undefined,
    OrPattern: whole,
    ParenthesizedPattern: whole,
    AsPattern: (link) => (link.child === link.node.pattern ? link.type : undefined),
    TuplePattern: ({ node, child, type }) => {
      const elements: readonly SyntaxNode[] = node.elements;
      return type?.kind === 'tuple' ? type.elements[elements.indexOf(child)] : undefined;
    },
    ArrayPattern: ({ cursor, child, type }) => {
      if (type === undefined || child.kind === 'RestPattern') {
        return type;
      }
      return arrayElement(cursor.checker, type);
    },
    StructPattern: (link) => {
      const { cursor, node, child, type } = link;
      const item = node.fields.find((each) => each === child);
      if (type === undefined || item === undefined || item.kind === 'Invalid') {
        return;
      }
      return fieldsOf(cursor, link.parsed, node, type).find(({ name }) => name === item.field.text)
        ?.type;
    },
    NestedFieldPattern: (link) => (link.child === link.node.pattern ? link.type : undefined),
  };
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.
