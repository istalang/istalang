/**
 * The one walk over a pattern (§3.11, §3.15): what it binds, the tests a value must pass to match
 * it, and its shape for exhaustiveness. Every pattern is walked here: a declaration's or loop's
 * targets, a `match` case's and an `is`'s. A tuple or struct is taken apart as an assignment's
 * target is (taking.ts).
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
import type { PatternTest, TargetBinding } from '../checked-pattern.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import type { AnyType, FieldMember, Type } from '../types/type.ts';
import { notSupported } from '../unsupported.ts';
import type { Downcast } from './downcasts.ts';
import { anyShape, type Shape } from './exhaustiveness.ts';
import type { PatternScope, ValuePart } from './parts.ts';
import { constructed, type Taking, takeApart, takeFields, takeTargets } from './taking.ts';

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
  /** The downcast a struct pattern or referring name makes of an `any` part; undefined after a report. */
  readonly downcast: (
    node: StructPattern | NamePattern,
    part: ValuePart & { readonly type: AnyType },
  ) => Downcast | undefined;
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

/** A pattern's walk: what it found so far. */
interface Walk extends Taking<Pattern | PatternPart> {
  readonly tests: PatternTests | undefined;
  readonly found: PatternTest[];
  readonly bindings: TargetBinding[];
  /** The part each downcasting pattern matched its value of the named type at, for its `as`. */
  readonly downcasts: Map<Pattern | PatternPart, ValuePart>;
}

function newWalk(scope: PatternScope, tests: PatternTests | undefined): Walk {
  const walk: Walk = {
    scope,
    tests,
    found: [],
    bindings: [],
    downcasts: new Map(),
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
    const [name] = node.path;
    if (binds(walk, node)) {
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
    walk.bindings.push({
      name: node.name,
      ...(walk.downcasts.get(unparenthesized(node.pattern)) ?? part),
    });
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
  if (part.type.kind === 'any' && isDowncasting(walk, node)) {
    return takeDowncast(walk, node, { ...part, type: part.type });
  }
  const shape = handlerOf(patternHandlers, node)(walk, node, part);
  return part.type.kind === 'error' ? anyShape : shape;
}

/** Whether `node`, against an `any` part, names a type to downcast to (downcasts.ts). */
function isDowncasting(
  walk: Walk,
  node: Pattern | PatternPart,
): node is StructPattern | NamePattern {
  if (walk.tests === undefined) {
    return false;
  }
  return node.kind === 'StructPattern' || (node.kind === 'NamePattern' && !binds(walk, node));
}

/**
 * Whether a name pattern binds a new variable, rather than referring: every bare name of a target,
 * and in a case a bare name the binder made a variable (§3.11).
 */
function binds(walk: Walk, node: NamePattern): boolean {
  const [name, ...rest] = node.path;
  return (
    rest.length === 0 &&
    (walk.tests === undefined || walk.scope.entityOf(name)?.kind === 'variable')
  );
}

/**
 * A downcast, then the rest of the pattern against the value of the type it names. The types
 * inside an `any` type are an open set, so it acts as a guard for exhaustiveness.
 */
function takeDowncast(
  walk: Walk,
  node: StructPattern | NamePattern,
  part: ValuePart & { readonly type: AnyType },
): undefined {
  const downcast = walk.tests?.downcast(node, part);
  if (downcast === undefined) {
    return;
  }
  walk.found.push(downcast.test);
  walk.downcasts.set(node, downcast.part);
  handlerOf(patternHandlers, node)(walk, node, downcast.part);
}

/** `node` without the parentheses around it. */
function unparenthesized(node: Pattern): Pattern {
  return node.kind === 'ParenthesizedPattern' ? unparenthesized(node.pattern) : node;
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

function spanOf(targets: readonly Pattern[]): Span {
  const first = targets[0]?.span;
  const last = targets.at(-1)?.span;
  return { start: first?.start ?? 0, end: last?.end ?? 0 };
}
