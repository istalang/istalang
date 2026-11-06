/**
 * The type a pattern being written matches (§3.11), read down from the type the `match` subject or
 * the `is` operand has as checked, or the parameter whose pattern it is (§3.3): an alternative, a parenthesized or an `as` pattern matches its
 * whole; a struct pattern's item, the field it names, among those of the variant or struct the
 * pattern names (against an `any` value, the type it downcasts to); a nested field pattern, that
 * field's type; a tuple's element, its element's; an array's item, its item's, and its rest the
 * whole array. Against a union, a struct, tuple or array pattern first selects the one member it
 * takes apart, by the checker's rule (types/written/named-types.ts).
 *
 * The patterns are read from the placeholder parse, which holds the one being written whole; the
 * subject and a struct pattern's name end before the cursor, so the checked tree types the one and
 * tells what the other denotes (checked-twin.ts).
 */

import type { Entity } from '../../../compiler/binder/entities.ts';
import type { Denotation } from '../../../compiler/checker/surface/denotation.ts';
import type { AnyType, FieldMember, Type } from '../../../compiler/checker/types/type.ts';
import { unionOf } from '../../../compiler/checker/types/unions/unions.ts';
import { arrayElement } from '../../../compiler/checker/types/well-known.ts';
import {
  downcastTargetOf,
  instancesWith,
  kindMembers,
  membersNamed,
  namesOwnType,
  patternTypeOf,
} from '../../../compiler/checker/types/written/pattern-types.ts';
import type { Parameter } from '../../../compiler/syntax/expressions/index.ts';
import { type Identifier, lastName } from '../../../compiler/syntax/node.ts';
import type {
  ArrayPattern,
  NamePattern,
  StructPattern,
} from '../../../compiler/syntax/patterns.ts';
import { nodesAt, parentOf, type SyntaxNode } from '../../../compiler/syntax/tree.ts';
import type { NamedType } from '../../../compiler/syntax/types.ts';
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
 * (§3.10); against a union, the member it selects. `struct{…}` names that type's own fields. A
 * trait's required fields are no pattern's (patterns/parts.ts).
 */
function fieldsOf(
  cursor: Cursor,
  parsed: Parsed,
  pattern: StructPattern,
  type: Type,
): readonly FieldMember[] {
  const { checker } = cursor;
  const own =
    type.kind === 'any'
      ? downcastOf(cursor, parsed, pattern, type)
      : memberSelected(cursor, parsed, pattern, type);
  if (own === undefined) {
    return [];
  }
  if (pattern.type === undefined) {
    return checker.fieldsOf(own) ?? [];
  }
  const name = lastName(pattern.type.path);
  const declared = denotationOf(cursor, parsed, name)?.declared;
  if (declared?.kind === 'type') {
    return namesOwnType(checker, declared.entity, own) ? (checker.fieldsOf(own) ?? []) : [];
  }
  const choosesByName = pattern.type.path.length === 1 && type.kind !== 'any';
  return variantFieldsOf(checker, own, { name, declared, choosesByName });
}

/** A pattern that takes a value apart, and so selects one member of a union first. */
type TakingPattern = StructPattern | ArrayPattern | Extract<SyntaxNode, { kind: 'TuplePattern' }>;

/**
 * The member of `type` that `pattern` selects (§3.11), `type` itself where it is no union;
 * undefined where it selects none, or several.
 */
function memberSelected(
  cursor: Cursor,
  parsed: Parsed,
  pattern: TakingPattern,
  type: Type | undefined,
): Type | undefined {
  if (type?.kind !== 'union') {
    return type;
  }
  const [only, ...others] = membersSelected(cursor, parsed, pattern, type.members);
  return others.length === 0 ? only : undefined;
}

/**
 * The members `pattern` selects (checker/types/written/pattern-types.ts): those its type's name names, the instance its
 * type arguments give, or those of its kind, a `struct{…}` pattern's the shapes having the fields
 * its items other than the one being written name.
 */
function membersSelected(
  cursor: Cursor,
  parsed: Parsed,
  pattern: TakingPattern,
  members: readonly Type[],
): readonly Type[] {
  const { checker } = cursor;
  switch (pattern.kind) {
    case 'TuplePattern':
      return kindMembers(checker, { kind: 'tuple', count: pattern.elements.length }, members);
    case 'ArrayPattern':
      return kindMembers(checker, { kind: 'array' }, members);
    default: {
      if (pattern.type !== undefined) {
        return membersNamedBy(cursor, parsed, pattern.type, members);
      }
      const written = parsed.chain.at(-1);
      const fields = pattern.fields.flatMap((item) =>
        item.kind === 'Invalid' || item.field === written ? [] : [item.field.text],
      );
      return kindMembers(checker, { kind: 'shape', fields }, members);
    }
  }
}

/** The members `named`, written before the cursor, names, the instance its type arguments give. */
function membersNamedBy(
  cursor: Cursor,
  parsed: Parsed,
  named: NamedType,
  members: readonly Type[],
): readonly Type[] {
  const entity = entityNamed(cursor, parsed, lastName(named.path));
  const selected = entity === undefined ? [] : membersNamed(cursor.checker, entity, members);
  if (named.typeArguments.length === 0) {
    return selected;
  }
  const given = named.typeArguments.flatMap((argument) => {
    const checked = checkedTwinOf(cursor, parsed.tree, argument);
    const type = checked && cursor.checker.lookup.typeOfNode(cursor.module, checked);
    return type === undefined ? [] : [type];
  });
  const pattern = entity === undefined ? undefined : patternTypeOf(cursor.checker, entity);
  return pattern?.kind === 'generic' && given.length === named.typeArguments.length
    ? instancesWith(selected, pattern.declaration, given)
    : [];
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

/** The entity `name`, written before the cursor, names as bound. */
function entityNamed(cursor: Cursor, parsed: Parsed, name: Identifier): Entity | undefined {
  const checked = checkedTwinOf(cursor, parsed.tree, name);
  return checked === undefined
    ? undefined
    : cursor.checker.bindings.entityOf(cursor.module, checked);
}

/**
 * The type a downcast of a value of `from` to the type `pattern` names tests for (checker/types/written/pattern-types.ts);
 * `struct{…}` names none.
 */
function downcastOf(
  cursor: Cursor,
  parsed: Parsed,
  pattern: StructPattern,
  from: AnyType,
): Type | undefined {
  const entity = pattern.type && entityNamed(cursor, parsed, lastName(pattern.type.path));
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

/**
 * What the parameter whose pattern holds the cursor has, as checked: a declared function's
 * signature gives it, and a lambda's as the body holding it checked the lambda, the union of each
 * pass's in a field loop (§4). The pattern reaches past the cursor, so the checked tree's parameter
 * is the one there.
 */
function parameterTypeAt({ cursor }: Link<SyntaxNode>): Type | undefined {
  const { checker, module, tree, offset } = cursor;
  const parameter = nodesAt(tree, offset).findLast(
    (node): node is Parameter => node.kind === 'Parameter',
  );
  const holder = parameter === undefined ? undefined : parentOf(tree, parameter);
  const declared = holder?.kind === 'FunctionDeclaration' ? [checker.parametersOf(holder)] : [];
  const nested =
    holder?.kind === 'Lambda'
      ? (checker.lookup.bodyHolding(module, holder)?.functionsOf(holder) ?? []).map(
          (checked) => checked.parameters,
        )
      : [];
  const types = [...declared, ...nested].flatMap(
    (parameters) => parameters.find(({ node }) => node === parameter)?.type ?? [],
  );
  return types.length === 0 ? undefined : unionOf(types, checker.typeRules);
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
    Parameter: (link) => (link.child === link.node.pattern ? parameterTypeAt(link) : undefined),
    OrPattern: whole,
    ParenthesizedPattern: whole,
    AsPattern: (link) => (link.child === link.node.pattern ? link.type : undefined),
    TuplePattern: ({ cursor, parsed, node, child, type }) => {
      const elements: readonly SyntaxNode[] = node.elements;
      const own = memberSelected(cursor, parsed, node, type);
      return own?.kind === 'tuple' ? own.elements[elements.indexOf(child)] : undefined;
    },
    ArrayPattern: ({ cursor, parsed, node, child, type }) => {
      const own = memberSelected(cursor, parsed, node, type);
      if (own === undefined || child.kind === 'RestPattern') {
        return own;
      }
      return arrayElement(cursor.checker, own);
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
