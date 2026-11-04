/**
 * The one walk over a pattern (§3.11, §3.15): what it binds, the tests a value must pass to match
 * it, and its shape for exhaustiveness. Every pattern is walked here: a declaration's or loop's
 * targets, a `match` case's and an `is`'s.
 *
 * - The walk owns the structure every use shares: names and `_`, `as`, tuples, struct field items,
 *   arrays, or-patterns, and the parts each reaches (parts.ts). A tuple or struct is taken apart
 *   as an assignment's target is (taking.ts). What could fail to match (a literal, a comparison, a
 *   referring name, a variant, an array's length, a range) goes to `PatternTests`, which a
 *   `match` case or `is` provides. A target has none, so each such construct is refused there: a
 *   target must always match.
 * - A bare name binds when the binder made it a variable, as it does for every bare name of a
 *   target and for a camelCase one in a case (§3.11); otherwise it refers.
 * - Tests come out in the order lowering runs them: a variant is tested before its fields are read.
 * - An or-pattern walks each alternative on its own, into one `or` test. Its alternatives bind the
 *   first's variables (binder), so a binding is named by its variable's declaring name, and the
 *   alternatives must agree on the names and their types.
 * - A shape is undefined when the pattern acts as a guard for exhaustiveness: it compares by more
 *   than `==` against a literal or variant, tests one field twice, or is a range (§3.11).
 */

import { type Handlers, handlerOf } from '../../../structures/kind-table.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import { type Identifier, isMissingName, lastName } from '../../syntax/node.ts';
import type {
  ArrayPattern,
  NamePattern,
  OrPattern,
  Pattern,
  PatternPart,
  StructPattern,
} from '../../syntax/patterns.ts';
import { targetNames, unparenthesizedPattern } from '../../syntax/patterns.ts';
import { type AnchoredSpan, spanAcross } from '../../syntax/positions.ts';
import type { PartBinding, PatternTest, TargetBinding } from '../checked-pattern.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { sameType } from '../types/identity.ts';
import { namesOwnType } from '../types/named-types.ts';
import { type AnyType, errorType, type Type } from '../types/type.ts';
import { anyShape, type Shape } from './exhaustiveness.ts';
import type { PatternScope, ValuePart } from './parts.ts';
import type { Leaf, PatternTests } from './pattern-tests.ts';
import { constructed, type Taking, takeApart, takeFields, takeTargets } from './taking.ts';

/** A pattern as walked. */
export interface WalkedPattern {
  readonly tests: readonly PatternTest[];
  readonly bindings: readonly PartBinding[];
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
 * (§3.15). A target refuses whatever could fail to match before taking it apart (`refused`), so
 * its parts are fields and tuple elements only.
 */
export function walkTargets(
  scope: PatternScope,
  targets: readonly Pattern[],
  type: Type,
): readonly TargetBinding[] {
  const walk = newWalk(scope, undefined);
  takeTargets(walk, targets, { type, path: [] }, spanOf(targets));
  return walk.bindings.map(({ path, ...binding }) => ({
    ...binding,
    path: path.map((step) =>
      typeof step === 'number' ? step : unreachable('A target took an array apart.'),
    ),
  }));
}

/** A pattern's walk: what it found so far. */
interface Walk extends Taking<Pattern | PatternPart> {
  readonly tests: PatternTests | undefined;
  readonly found: PatternTest[];
  readonly bindings: PartBinding[];
}

/** A pattern or part as walked: its shape for exhaustiveness, and the part it matched at. */
interface Matched {
  readonly shape: Shape | undefined;
  readonly part: ValuePart;
}

function newWalk(scope: PatternScope, tests: PatternTests | undefined): Walk {
  const walk: Walk = {
    scope,
    tests,
    found: [],
    bindings: [],
    take: (node, part) => takeMatched(walk, node, part).shape,
  };
  return walk;
}

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
const patternHandlers: Handlers<Walk, Pattern | PatternPart, [ValuePart], Shape | undefined> = {
  WildcardPattern: () => anyShape,
  Missing: () => anyShape,
  Invalid: () => anyShape,
  OrPattern: (walk, node, part) => takeAlternatives(walk, node, part),
  ArrayPattern: (walk, node, part) => takeArray(walk, node, part),
  RangePattern: (walk, node, part) =>
    refutable(walk, node, part, (tests) => tests.range(node, part)),
  RestPattern: (walk, node, part) => {
    if (node.target.kind === 'Identifier') {
      walk.bindings.push({ name: node.target, ...part });
    }
    return anyShape;
  },
  NamePattern: (walk, node, part) => {
    const [name] = node.path;
    if (binds(walk, node)) {
      walk.bindings.push({ name, ...part });
      return anyShape;
    }
    // `a.` cut short, as code being typed leaves it, names nothing: the parser reported it.
    if (isMissingName(lastName(node.path))) {
      return;
    }
    return refutable(walk, node, part, (tests) => tests.reference(node, part));
  },
  LiteralPattern: (walk, node, part) =>
    refutable(walk, node, part, (tests) => tests.literal(node, part)),
  ParenthesizedPattern: () => unreachable('Parenthesized patterns are unwrapped before dispatch.'),
  AsPattern: (walk, node, part) => {
    const matched = takeMatched(walk, node.pattern, part);
    walk.bindings.push({ name: node.name, ...matched.part });
    return matched.shape;
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
    refutable(walk, item, part, (tests) => tests.comparison(item, part)),
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.

/** A part already in error was reported where it arose; it takes anything, for exhaustiveness. */
function takeMatched(walk: Walk, written: Pattern | PatternPart, part: ValuePart): Matched {
  const node =
    written.kind === 'ParenthesizedPattern' ? unparenthesizedPattern(written.pattern) : written;
  if (part.type.kind === 'any' && isDowncasting(walk, node, part.type)) {
    return takeDowncast(walk, node, { ...part, type: part.type });
  }
  const shape = handlerOf(patternHandlers, node)(walk, node, part);
  return { shape: part.type.kind === 'error' ? anyShape : shape, part };
}

/**
 * Whether `node`, against a part of the `any` type `type`, names a type to downcast to
 * (downcasts.ts): not a name naming `type` itself, which matches every value of it.
 */
function isDowncasting(
  walk: Walk,
  node: Pattern | PatternPart,
  type: AnyType,
): node is StructPattern | NamePattern {
  if (walk.tests === undefined) {
    return false;
  }
  if (node.kind !== 'NamePattern') {
    return node.kind === 'StructPattern';
  }
  if (binds(walk, node)) {
    return false;
  }
  const entity = walk.scope.entityOf(lastName(node.path));
  return entity === undefined || !namesOwnType(walk.scope, entity, type);
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
): Matched {
  const downcast = walk.tests?.downcast(node, part);
  if (downcast === undefined) {
    return { shape: undefined, part };
  }
  walk.found.push(downcast.test);
  handlerOf(patternHandlers, node)(walk, node, downcast.part);
  return { shape: undefined, part: downcast.part };
}

/** `A | B`: each alternative walked on its own, as one alternative of an `or` test. */
function takeAlternatives(walk: Walk, node: OrPattern, part: ValuePart): Shape | undefined {
  if (walk.tests === undefined) {
    return refused(walk, node, part);
  }
  const { tests } = walk;
  const alternatives = node.alternatives.map((alternative) => {
    const own = newWalk(walk.scope, tests);
    const shape = own.take(alternative, part);
    const bindings = own.bindings.map((binding) => ({
      ...binding,
      name: declaringName(walk, binding.name),
    }));
    return { span: alternative.span, shape, tests: own.found, bindings };
  });
  const [first, ...others] = alternatives;
  for (const other of others) {
    if (first !== undefined && !sameNames(first.bindings, other.bindings)) {
      walk.scope.report(checkerDiagnostics.differentAlternatives(other.span));
    }
  }
  walk.found.push({
    kind: 'or',
    alternatives: alternatives.map(({ tests: own, bindings }) => ({ tests: own, bindings })),
  });
  const shapes = alternatives.flatMap(({ shape }) => (shape === undefined ? [] : [shape]));
  return shapes.length === alternatives.length ? { kind: 'or', alternatives: shapes } : undefined;
}

/** The name declaring the variable `name` binds: the first alternative's, for a later one's. */
function declaringName(walk: Walk, name: Identifier): Identifier {
  const entity = walk.scope.entityOf(name);
  return entity?.kind === 'variable' ? entity.name : name;
}

/**
 * Whether two alternatives bind the same names, each with the same type. A name bound at the error
 * type was reported where its type went wrong, so it agrees with any.
 */
function sameNames(first: readonly PartBinding[], other: readonly PartBinding[]): boolean {
  const agree = (one: Type, another: Type) =>
    one.kind === 'error' || another.kind === 'error' || sameType(one, another);
  return (
    first.length === other.length &&
    first.every((binding) =>
      other.some((each) => each.name === binding.name && agree(each.type, binding.type)),
    )
  );
}

/**
 * `[first, ...rest, last]`: its length tested first, then each item against the item it names,
 * counted from the start before the rest and from the end after it; the rest is the items between.
 * A target refuses it, since the length can fail.
 */
function takeArray(walk: Walk, node: ArrayPattern, part: ValuePart): Shape | undefined {
  if (walk.tests === undefined) {
    return refused(walk, node, part);
  }
  const array = walk.tests.array(node, part);
  const restAt = node.elements.findIndex((element) => element.kind === 'RestPattern');
  const prefix = restAt < 0 ? node.elements : node.elements.slice(0, restAt);
  const suffix = restAt < 0 ? [] : node.elements.slice(restAt + 1);
  const item = (offset: number): ValuePart => ({
    type: array?.items ?? errorType,
    path: [...part.path, { kind: 'item', site: node, offset }],
  });
  if (array !== undefined) {
    walk.found.push(array.test);
  }
  const shapes = {
    prefix: prefix.map((element, index) => walk.take(element, item(index))),
    suffix: suffix.map((element, index) => walk.take(element, item(index - suffix.length))),
  };
  const rest = node.elements[restAt];
  if (rest !== undefined) {
    const between = {
      kind: 'rest',
      site: node,
      before: prefix.length,
      after: suffix.length,
    } as const;
    walk.take(rest, {
      type: array === undefined ? errorType : part.type,
      path: [...part.path, between],
    });
  }
  const known = [...shapes.prefix, ...shapes.suffix];
  if (array === undefined || known.some((shape) => shape === undefined)) {
    return array === undefined ? anyShape : undefined;
  }
  return {
    kind: 'array',
    prefix: shapes.prefix.filter(isShape),
    suffix: shapes.suffix.filter(isShape),
    hasRest: restAt >= 0,
  };
}

function isShape(shape: Shape | undefined): shape is Shape {
  return shape !== undefined;
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
  const isVariant = named?.kind === 'variant' || named?.kind === 'variants';
  if (walk.tests === undefined && isVariant) {
    return refused(walk, node, part);
  }
  if (walk.tests === undefined || !isVariant) {
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
  node: Pattern | PatternPart,
  part: ValuePart,
  check: (tests: PatternTests) => Leaf,
): Shape | undefined {
  if (walk.tests === undefined) {
    return refused(walk, node, part);
  }
  const leaf = check(walk.tests);
  walk.found.push(...leaf.tests);
  return leaf.shape;
}

/**
 * A construct that could fail to match, standing in a target, which must always match: reported
 * once, its names bound at the error type to the part it stands at, so each use of them resolves
 * with nothing more to report. Nothing inside it is taken apart, so a target's parts are fields and
 * tuple elements only.
 */
function refused(walk: Walk, node: Pattern | PatternPart, part: ValuePart): Shape {
  walk.scope.report(checkerDiagnostics.refutableTarget(node.span));
  const names = new Set(targetNames(node).map((name) => declaringName(walk, name)));
  for (const name of names) {
    walk.bindings.push({ name, type: errorType, path: part.path });
  }
  return anyShape;
}

/** From the first of `targets` to the last; the parser reads at least one. */
function spanOf(targets: readonly Pattern[]): AnchoredSpan {
  const [first] = targets;
  const last = targets.at(-1);
  return first === undefined || last === undefined
    ? unreachable('A declaration has no targets.')
    : spanAcross(first.span, last.span);
}
