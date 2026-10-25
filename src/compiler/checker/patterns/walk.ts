/**
 * The one walk over a pattern (§3.11, §3.15): what it binds, the tests a value must pass to match
 * it, and its shape for exhaustiveness. Every pattern is walked here: a declaration's or loop's
 * targets, an assignment's, a `match` case's and an `is`'s.
 *
 * - The walk owns the structure every use shares: names and `_`, `as`, tuples, struct field items,
 *   and the parts each reaches (parts.ts). What could fail to match (a literal, a comparison, a
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
import { type Invalid, lastName } from '../../syntax/node.ts';
import type {
  CompareFieldPattern,
  LiteralPattern,
  NamePattern,
  Pattern,
  PatternPart,
  StructPattern,
} from '../../syntax/patterns.ts';
import type { PatternTest, TargetBinding } from '../check.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import type { FieldMember, Type } from '../types/type.ts';
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
  /** A name that refers: a variant without fields, or a constant. */
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
  const walk: Walk = { scope, tests, found: [], bindings: [] };
  const shape = take(walk, pattern, part);
  return { tests: walk.found, bindings: walk.bindings, shape };
}

/**
 * The names a declaration's or loop's `targets` bind in a value of `type`, each with its part
 * (§3.15). Several targets take apart a tuple of as many values, as if parenthesized.
 */
export function walkTargets(
  scope: PatternScope,
  targets: readonly Pattern[],
  type: Type,
): readonly TargetBinding[] {
  const part = { type, path: [] };
  const walk: Walk = { scope, tests: undefined, found: [], bindings: [] };
  const [only] = targets;
  if (targets.length === 1 && only !== undefined) {
    take(walk, only, part);
  } else {
    takeElements(walk, targets, part, spanOf(targets));
  }
  return walk.bindings;
}

interface Walk {
  readonly scope: PatternScope;
  readonly tests: PatternTests | undefined;
  readonly found: PatternTest[];
  readonly bindings: TargetBinding[];
}

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
const patternHandlers: Handlers<Walk, Pattern, [ValuePart], Shape | undefined> = {
  WildcardPattern: () => anyShape,
  Missing: () => anyShape,
  Invalid: () => anyShape,
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
  ParenthesizedPattern: (walk, node, part) => take(walk, node.pattern, part),
  AsPattern: (walk, node, part) => {
    const shape = take(walk, node.pattern, part);
    walk.bindings.push({ name: node.name, ...part });
    return shape;
  },
  TuplePattern: (walk, node, part) => {
    const elements = takeElements(walk, node.elements, part, node.span);
    return constructed(tupleKey, elements);
  },
  StructPattern: (walk, node, part) => takeStruct(walk, node, part),
};

const fieldHandlers: Handlers<Walk, PatternPart | Invalid, [ValuePart], Shape | undefined> = {
  BindFieldPattern: (walk, item, part) => {
    walk.bindings.push({ name: item.alias ?? item.field, ...part });
    return anyShape;
  },
  NestedFieldPattern: (walk, item, part) => take(walk, item.pattern, part),
  CompareFieldPattern: (walk, item, part) =>
    refutable(walk, item.span, (tests) => tests.comparison(item, part)),
  Invalid: () => anyShape,
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.

/** A part already in error was reported where it arose; it takes anything, for exhaustiveness. */
function take(walk: Walk, node: Pattern, part: ValuePart): Shape | undefined {
  const shape = handlerOf(patternHandlers, node)(walk, node, part);
  return part.type.kind === 'error' ? anyShape : shape;
}

function takeElements(
  walk: Walk,
  elements: readonly Pattern[],
  part: ValuePart,
  span: Span,
): readonly (Shape | undefined)[] {
  const parts = elementParts(walk.scope, part, elements.length, span);
  return elements.map((element, index) => take(walk, element, parts[index] ?? part));
}

/**
 * A struct pattern: a variant's, tested first where a pattern may fail, or a struct value's, which
 * always matches. A target naming a variant is refused where its parts are found (parts.ts).
 */
function takeStruct(walk: Walk, node: StructPattern, part: ValuePart): Shape | undefined {
  const named = node.type === undefined ? undefined : walk.scope.entityOf(lastName(node.type.path));
  if (walk.tests === undefined || (named?.kind !== 'variant' && named?.kind !== 'variants')) {
    const fields = structParts(walk.scope, node.type, part.type, node.span);
    return constructed(structKey, takeFields(walk, node, fields, part));
  }
  const variant = walk.tests.variant(node, named, part);
  if (variant === undefined) {
    takeFields(walk, node, undefined, part);
    return anyShape;
  }
  walk.found.push(variant.test);
  return constructed(variant.key, takeFields(walk, node, variant.fields, part));
}

/**
 * The shapes of a struct's or variant's fields, by position: what the items say of each field,
 * anything for a field no item names. A field two items test makes the whole a guard.
 */
function takeFields(
  walk: Walk,
  node: StructPattern,
  fields: readonly FieldMember[] | undefined,
  part: ValuePart,
): readonly (Shape | undefined)[] {
  const shapes: (Shape | undefined)[] = (fields ?? []).map(() => anyShape);
  const tested = new Set<number>();
  for (const item of node.fields.filter((each) => each.kind !== 'Invalid')) {
    const field = fieldPart(walk.scope, fields, item.field, part);
    const shape = handlerOf(fieldHandlers, item)(walk, item, field.part);
    if (field.index >= 0) {
      shapes[field.index] = tested.has(field.index) ? undefined : shape;
      tested.add(field.index);
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
