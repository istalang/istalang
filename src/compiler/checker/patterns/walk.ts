/**
 * The one walk over a pattern (§3.11, §3.15): what it binds, the tests a value must pass to match
 * it, and its shape for exhaustiveness. Every pattern is walked here: a declaration's or loop's
 * targets, a `match` case's and an `is`'s; and every target taking a value apart, an assignment's
 * too, through `takeApart`.
 *
 * - The walk owns the structure every use shares: names and `_`, `as`, tuples, struct field items,
 *   and the parts each reaches (parts.ts). A tuple or struct target is taken apart one way, as
 *   syntax reads it (`Destructuring`), whether a pattern or an assignment's expression wrote it;
 *   only what stands at its leaves differs. What could fail to match (a literal, a comparison, a
 *   referring name, a variant) goes to `PatternTests`, which a `match` case or `is` provides.
 *   A target has none, so each such construct is refused there: a target must always match.
 * - A bare name binds when the binder made it a variable, as it does for every bare name of a
 *   target and for a camelCase one in a case (§3.11); otherwise it refers.
 * - Tests come out in the order lowering runs them: a variant is tested before its fields are read.
 * - A shape is undefined when the pattern acts as a guard for exhaustiveness: it compares by more
 *   than `==` against a literal or variant, or tests one field twice (§3.11).
 */

import { type Handlers, handlerOf } from '../../../structures/kind-table.ts';
import type { Span } from '../../../text/span.ts';
import type { VariantNaming } from '../../binder/entities.ts';
import { lastName } from '../../syntax/node.ts';
import type {
  CompareFieldPattern,
  LiteralPattern,
  NamePattern,
  Pattern,
  PatternPart,
  StructPattern,
} from '../../syntax/patterns.ts';
import type { Destructuring, FieldTarget } from '../../syntax/statements.ts';
import type { PatternTest, TargetBinding } from '../checked-pattern.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import type { FieldMember, Type } from '../types/type.ts';
import { notSupported } from '../unsupported.ts';
import { anyShape, type Shape } from './exhaustiveness.ts';
import {
  elementParts,
  fieldPart,
  type PatternScope,
  structParts,
  type ValuePart,
} from './parts.ts';
import { structKey, tupleKey } from './shapes.ts';

/** What a refutable construct gives the walk: its tests, and its shape (undefined: a guard). */
export interface Leaf {
  readonly tests: readonly PatternTest[];
  readonly shape: Shape | undefined;
}

/** The variant a struct pattern names: the test for it, its key among shapes, and its fields. */
export interface VariantPart {
  readonly test: PatternTest;
  readonly key: string;
  readonly fields: readonly FieldMember[];
}

/** How the constructs that could fail to match are checked, where a pattern may fail. */
export interface PatternTests {
  /** `case 0:`, `case "cfo":`, `case none:`. */
  readonly literal: (node: LiteralPattern, part: ValuePart) => Leaf;
  /** `amount > 1000`, `ok == false`, on the part of the field. */
  readonly comparison: (item: CompareFieldPattern, part: ValuePart) => Leaf;
  /** A name that refers: a variant or a struct without fields, or a constant. */
  readonly reference: (node: NamePattern, part: ValuePart) => Leaf;
  /** The variant `naming` names in a struct pattern; undefined after a report. */
  readonly variant: (
    node: StructPattern,
    naming: VariantNaming,
    part: ValuePart,
  ) => VariantPart | undefined;
}

/** A pattern as walked. */
export interface WalkedPattern {
  readonly tests: readonly PatternTest[];
  readonly bindings: readonly TargetBinding[];
  readonly shape: Shape | undefined;
}

/** Walks `pattern` over a value of `part`; without `tests`, as a target that must always match. */
export function walkPattern(
  scope: PatternScope,
  tests: PatternTests | undefined,
  pattern: Pattern,
  part: ValuePart,
): WalkedPattern {
  const walk = newWalk(scope, tests);
  const shape = walk.take(pattern, part);
  return { tests: walk.found, bindings: walk.bindings, shape };
}

/**
 * The names a declaration's or loop's `targets` bind in a value of `type`, each with its part
 * (§3.15).
 */
export function walkTargets(
  scope: PatternScope,
  targets: readonly Pattern[],
  type: Type,
): readonly TargetBinding[] {
  const walk = newWalk(scope, undefined);
  takeTargets(walk, targets, { type, path: [] }, spanOf(targets));
  return walk.bindings;
}

/** How a walk takes the targets a value is taken apart into: where it reports, and each target. */
export interface Taking<Target> {
  readonly scope: PatternScope;
  /** Takes `target` over the part of the value it reaches; its shape. */
  readonly take: (target: Target, part: ValuePart) => Shape | undefined;
}

/**
 * Takes a value of `part` apart into `targets`, at `span`: one takes it whole, and several a tuple
 * of as many, as if parenthesized (§3.15).
 */
export function takeTargets<Target>(
  taking: Taking<Target>,
  targets: readonly Target[],
  part: ValuePart,
  span: Span,
): Shape | undefined {
  const [only] = targets;
  if (targets.length === 1 && only !== undefined) {
    return taking.take(only, part);
  }
  return takeApart(taking, { kind: 'tuple', elements: targets, span }, part);
}

/**
 * Takes a value of `part` apart as `destructuring` says, each of its targets taking its part: a
 * tuple of exactly as many elements, or a struct value's fields (parts.ts).
 */
export function takeApart<Target>(
  taking: Taking<Target>,
  destructuring: Destructuring<Target>,
  part: ValuePart,
): Shape | undefined {
  if (destructuring.kind === 'tuple') {
    const { elements, span } = destructuring;
    const parts = elementParts(taking.scope, part, elements.length, span);
    const shapes = elements.map((element, index) => taking.take(element, parts[index] ?? part));
    return constructed(tupleKey, shapes);
  }
  const fields = structParts(taking.scope, destructuring.type, part.type, destructuring.span);
  return constructed(structKey, takeFields(taking, destructuring.items, fields, part));
}

/** A pattern's walk: what it found so far. */
interface Walk extends Taking<Pattern | PatternPart> {
  readonly tests: PatternTests | undefined;
  readonly found: PatternTest[];
  readonly bindings: TargetBinding[];
}

function newWalk(scope: PatternScope, tests: PatternTests | undefined): Walk {
  const walk: Walk = {
    scope,
    tests,
    found: [],
    bindings: [],
    take: (node, part) => takePattern(walk, node, part),
  };
  return walk;
}

/** A pattern form the checker doesn't take yet: reported, and matching anything meanwhile. */
function notSupportedYet(walk: Walk, node: Pattern | PatternPart): Shape {
  walk.scope.report(notSupported(node));
  return anyShape;
}

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
const patternHandlers: Handlers<Walk, Pattern | PatternPart, [ValuePart], Shape | undefined> = {
  WildcardPattern: () => anyShape,
  Missing: () => anyShape,
  Invalid: () => anyShape,
  OrPattern: notSupportedYet,
  ArrayPattern: notSupportedYet,
  RangePattern: notSupportedYet,
  RestPattern: notSupportedYet,
  NamePattern: (walk, node, part) => {
    const [name, ...rest] = node.path;
    const entity = walk.scope.entityOf(name);
    const binds = rest.length === 0 && (walk.tests === undefined || entity?.kind === 'variable');
    if (binds) {
      walk.bindings.push({ name, ...part });
      return anyShape;
    }
    return refutable(walk, node.span, (tests) => tests.reference(node, part));
  },
  LiteralPattern: (walk, node, part) =>
    refutable(walk, node.span, (tests) => tests.literal(node, part)),
  ParenthesizedPattern: (walk, node, part) => walk.take(node.pattern, part),
  AsPattern: (walk, node, part) => {
    const shape = walk.take(node.pattern, part);
    walk.bindings.push({ name: node.name, ...part });
    return shape;
  },
  TuplePattern: (walk, node, part) =>
    takeApart(walk, { kind: 'tuple', elements: node.elements, span: node.span }, part),
  StructPattern: (walk, node, part) => takeStruct(walk, node, part),
  BindFieldPattern: (walk, item, part) => {
    walk.bindings.push({ name: item.alias ?? item.field, ...part });
    return anyShape;
  },
  NestedFieldPattern: (walk, item, part) => walk.take(item.pattern, part),
  CompareFieldPattern: (walk, item, part) =>
    refutable(walk, item.span, (tests) => tests.comparison(item, part)),
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.

/** A part already in error was reported where it arose; it takes anything, for exhaustiveness. */
function takePattern(walk: Walk, node: Pattern | PatternPart, part: ValuePart): Shape | undefined {
  const shape = handlerOf(patternHandlers, node)(walk, node, part);
  return part.type.kind === 'error' ? anyShape : shape;
}

/**
 * A struct pattern: a variant's, tested first where a pattern may fail, or a struct value's, which
 * always matches. A target naming a variant is refused where its parts are found (parts.ts).
 */
function takeStruct(walk: Walk, node: StructPattern, part: ValuePart): Shape | undefined {
  const items = node.fields.flatMap((item) =>
    item.kind === 'Invalid' ? [] : [{ name: item.field, span: item.span, target: item }],
  );
  const named = node.type === undefined ? undefined : walk.scope.entityOf(lastName(node.type.path));
  if (walk.tests === undefined || (named?.kind !== 'variant' && named?.kind !== 'variants')) {
    const struct = { kind: 'struct', type: node.type, items, span: node.span } as const;
    return takeApart(walk, struct, part);
  }
  const variant = walk.tests.variant(node, named, part);
  if (variant === undefined) {
    takeFields(walk, items, undefined, part);
    return anyShape;
  }
  walk.found.push(variant.test);
  return constructed(variant.key, takeFields(walk, items, variant.fields, part));
}

/**
 * The shapes of a struct's or variant's fields, by position, as `items` take them: what each item
 * says of its field, anything for a field no item names. A field two items take makes the whole
 * a guard.
 */
function takeFields<Target>(
  taking: Taking<Target>,
  items: readonly FieldTarget<Target>[],
  fields: readonly FieldMember[] | undefined,
  part: ValuePart,
): readonly (Shape | undefined)[] {
  const shapes: (Shape | undefined)[] = (fields ?? []).map(() => anyShape);
  const taken = new Set<number>();
  for (const item of items) {
    const field = fieldPart(taking.scope, fields, item, part);
    const shape = taking.take(item.target, field.part);
    if (field.index >= 0) {
      shapes[field.index] = taken.has(field.index) ? undefined : shape;
      taken.add(field.index);
    }
  }
  return shapes;
}

/** A construct that could fail to match: tested where tests are given, refused in a target. */
function refutable(
  walk: Walk,
  span: Span,
  check: (tests: PatternTests) => Leaf,
): Shape | undefined {
  if (walk.tests === undefined) {
    walk.scope.report(checkerDiagnostics.refutableTarget(span));
    return anyShape;
  }
  const leaf = check(walk.tests);
  walk.found.push(...leaf.tests);
  return leaf.shape;
}

/** A constructor's shape; a guard when any argument is one. */
function constructed(key: string, shapes: readonly (Shape | undefined)[]): Shape | undefined {
  const known = shapes.filter((shape) => shape !== undefined);
  return known.length === shapes.length
    ? { kind: 'constructor', key, arguments: known }
    : undefined;
}

function spanOf(targets: readonly Pattern[]): Span {
  const first = targets[0]?.span;
  const last = targets.at(-1)?.span;
  return { start: first?.start ?? 0, end: last?.end ?? 0 };
}
