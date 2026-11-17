/**
 * Targets as written (§3.15): what an assignment's target takes its value apart into, which targets
 * name no variable, and what declares targets (a declaration, a loop, a comprehension, a field
 * loop's header, a parameter), so the binder, the checker and lowering read one destructuring.
 */

import { isUnnamed } from '../../../foundation/language/naming.ts';
import type { Comprehension, Expression, FieldHeader, Parameter } from '../expressions/index.ts';
import { isPlace } from '../expressions/places.ts';
import { itemName, itemValue, unparenthesized } from '../expressions/readings.ts';
import type { Pattern } from '../patterns.ts';
import type { Identifier } from '../tree/node.ts';
import type { AnchoredSpan } from '../tree/positions.ts';
import type { NamedType } from '../types/index.ts';
import type { For, VariableDeclaration } from './index.ts';

/**
 * What a target takes its value apart into, as written (§3.15): a tuple's elements, or a struct's
 * items, each a target of its own. A declaration's targets are patterns and an assignment's are
 * expressions, but both read as one of these, which the checker takes apart by one walk.
 */
export type Destructuring<Target> =
  | { readonly kind: 'tuple'; readonly elements: readonly Target[]; readonly span: AnchoredSpan }
  | {
      readonly kind: 'struct';
      readonly type: NamedType | undefined;
      readonly items: readonly FieldTarget<Target>[];
      readonly span: AnchoredSpan;
    };

/** A struct target's item: the field it names, none when positional (§3.1), and its target. */
export interface FieldTarget<Target> {
  readonly name: Identifier | undefined;
  readonly span: AnchoredSpan;
  readonly target: Target;
}

/**
 * What an assignment's target takes its value apart into, each part without its parentheses;
 * undefined for a target naming one place. A struct target's item takes the field it gives as a
 * literal's item does, and the shorthand `first` assigns the variable `first`.
 */
export function destructuringOf(target: Expression): Destructuring<Expression> | undefined {
  const bare = unparenthesized(target);
  switch (bare.kind) {
    case 'Tuple':
      return { kind: 'tuple', elements: bare.elements.map(unparenthesized), span: bare.span };
    case 'StructLiteral':
      return {
        kind: 'struct',
        type: bare.type,
        items: bare.items.flatMap((item) =>
          item.kind === 'FieldInitializer' || item.kind === 'PositionalInitializer'
            ? [{ name: itemName(item), span: item.span, target: unparenthesized(itemValue(item)) }]
            : [],
        ),
        span: bare.span,
      };
    default:
      return undefined;
  }
}

/**
 * What may stand left of `=` (§3.4, §3.15): a place, or a tuple or struct literal made of targets,
 * parenthesized or not; a struct's positional value needs the parentheses (§3.1).
 */
export function isTarget(target: Expression): boolean {
  const bare = unparenthesized(target);
  const itemsOnly =
    bare.kind !== 'StructLiteral' ||
    bare.items.every(
      (item) => item.kind === 'FieldInitializer' || item.kind === 'PositionalInitializer',
    );
  if (!itemsOnly) {
    return false;
  }
  return destructures(bare) ? targetParts(bare).every(isTarget) : isPlace(bare);
}

/**
 * Whether an assignment's target takes its value apart, a tuple or struct literal of targets,
 * parenthesized or not, rather than naming one place (§3.15).
 */
export function destructures(target: Expression): boolean {
  return destructuringOf(target) !== undefined;
}

/** Whether an assignment's target is `_`, which names no place but holds the value (§7). */
export function isUnnamedTarget(target: Expression): boolean {
  const bare = unparenthesized(target);
  return bare.kind === 'Identifier' && isUnnamed(bare.text);
}

/**
 * The targets a destructuring target is made of, each without its parentheses: a tuple's
 * elements, or the values of a struct literal's items; none for a place.
 */
export function targetParts(target: Expression): readonly Expression[] {
  const destructuring = destructuringOf(target);
  switch (destructuring?.kind) {
    case 'tuple':
      return destructuring.elements;
    case 'struct':
      return destructuring.items.map((item) => item.target);
    default:
      return [];
  }
}

/** What declares targets (`declaredTargets`). */
export type TargetOwner = VariableDeclaration | For | Comprehension | FieldHeader | Parameter;

/** Whether `node` declares targets, which `declaredTargets` reads. */
export function ownsTargets<Node extends { readonly kind: string }>(
  node: Node,
): node is Extract<Node, TargetOwner> {
  return targetOwnerKinds.has(node.kind);
}

/**
 * The targets `owner` declares, which take its value apart (§3.15): a declaration's or loop's, a
 * field loop's key and value, which take apart the pair of a field's name and value, or a
 * parameter's pattern, which takes its argument apart (§3.3).
 */
export function declaredTargets(owner: TargetOwner): readonly Pattern[] {
  switch (owner.kind) {
    case 'FieldHeader':
      return [owner.key, owner.value];
    case 'Parameter':
      return owner.pattern === undefined ? [] : [owner.pattern];
    default:
      return owner.targets;
  }
}

const targetOwnerKinds: ReadonlySet<string> = new Set<TargetOwner['kind']>([
  'VariableDeclaration',
  'For',
  'Comprehension',
  'FieldHeader',
  'Parameter',
]);
