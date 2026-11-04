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
 *   alternatives must agree on the names and their types (alternatives.ts).
 * - What a pattern selects of its part comes first (selections.ts): a downcast of an `any` value,
 *   or the members of a union's. Type arguments are written only there, on a union's members.
 * - A shape is undefined when the pattern acts as a guard for exhaustiveness: it compares by more
 *   than `==` against a literal or variant, tests one field twice, or is a range (§3.11).
 */

import { type Handlers, handlerOf } from '../../../structures/kind-table.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import { type Identifier, isMissingName, lastName } from '../../syntax/node.ts';
import type {
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
import { errorType, type Type } from '../types/type.ts';
import { baseOf } from '../types/unions.ts';
import { partSelected, sameNames } from './alternatives.ts';
import { takeArray } from './arrays.ts';
import { anyShape, type Shape } from './exhaustiveness.ts';
import { literalTypeOf } from './members.ts';
import type { PatternScope, ValuePart } from './parts.ts';
import type { Leaf, PatternTests } from './pattern-tests.ts';
import { selectionOf } from './selections.ts';
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

/**
 * A pattern or part as walked: its shape for exhaustiveness, the part it matched at, and the test
 * selecting it, if it selected what its part is.
 */
interface Matched {
  readonly shape: Shape | undefined;
  readonly part: ValuePart;
  readonly selected?: PatternTest | undefined;
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
  OrPattern: (walk, node, part) => takeAlternatives(walk, node, part).shape,
  ArrayPattern: (walk, node, part) =>
    walk.tests === undefined ? refused(walk, node, part) : takeArray(walk, walk.tests, node, part),
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

/**
 * `node` matched at `part`, what it selects of the part first (selections.ts). A part already in
 * error, or a selection refused, was reported where it arose; it takes anything, for exhaustiveness.
 */
function takeMatched(walk: Walk, written: Pattern | PatternPart, part: ValuePart): Matched {
  const node =
    written.kind === 'ParenthesizedPattern' ? unparenthesizedPattern(written.pattern) : written;
  if (node.kind === 'OrPattern') {
    return takeAlternatives(walk, node, part);
  }
  const isBinding = node.kind === 'NamePattern' && binds(walk, node);
  const selection =
    walk.tests === undefined || isBinding
      ? undefined
      : selectionOf(walk.scope, walk.tests, node, part);
  if (selection === 'refused') {
    // A downcast is a guard however it goes, the types inside an `any` type being an open set.
    const shape = part.type.kind === 'any' ? undefined : anyShape;
    return { shape, part: { type: errorType, path: part.path } };
  }
  if (selection === undefined) {
    refuseTypeArguments(walk, node);
    const shape = handlerOf(patternHandlers, node)(walk, node, part);
    return { shape: part.type.kind === 'error' ? anyShape : shape, part: literalPart(node, part) };
  }
  if (selection.test.kind !== 'member') {
    refuseTypeArguments(walk, node);
  }
  walk.found.push(selection.test);
  const inside = selection.decided
    ? anyShape
    : handlerOf(patternHandlers, node)(walk, node, selection.part);
  return {
    shape: selection.shapeOf(inside),
    part: literalPart(node, selection.part),
    selected: selection.test,
  };
}

/**
 * The part a literal pattern leaves to what binds it: its literal type, where the part is of its
 * base (`case "draft" as d` against a `String`), as only that value matched.
 */
function literalPart(node: Pattern | PatternPart, part: ValuePart): ValuePart {
  const literal = node.kind === 'LiteralPattern' ? literalTypeOf(node.value) : undefined;
  return literal?.kind === 'literal' && sameType(baseOf(literal), part.type)
    ? { ...part, type: literal }
    : part;
}

/**
 * Reports type arguments written in a pattern that selects no member of a union: only that one
 * gives them, to tell apart the members instantiating one generic type (§3.11).
 */
function refuseTypeArguments(walk: Walk, node: Pattern | PatternPart): void {
  const named = node.kind === 'StructPattern' ? node.type : node;
  if (named?.kind !== 'NamePattern' && named?.kind !== 'NamedType') {
    return;
  }
  const [first] = named.typeArguments;
  const last = named.typeArguments.at(-1);
  if (first !== undefined && last !== undefined) {
    walk.scope.report(
      checkerDiagnostics.typeArgumentsOutsideUnion(
        spanAcross(first.span, last.span),
        lastName(named.path).text,
      ),
    );
  }
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
 * `A | B`: each alternative walked on its own, as one alternative of an `or` test. Where each
 * selects members of the part's union, what binds the whole has the union of those (`case Int |
 * String as v`); else the part's own type.
 */
function takeAlternatives(walk: Walk, node: OrPattern, part: ValuePart): Matched {
  if (walk.tests === undefined) {
    return { shape: refused(walk, node, part), part };
  }
  const { tests } = walk;
  const alternatives = node.alternatives.map((alternative) => {
    const own = newWalk(walk.scope, tests);
    const { shape, selected } = takeMatched(own, alternative, part);
    const bindings = own.bindings.map((binding) => ({
      ...binding,
      name: declaringName(walk, binding.name),
    }));
    return { span: alternative.span, shape, selected, tests: own.found, bindings };
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
  return {
    shape: shapes.length === alternatives.length ? { kind: 'or', alternatives: shapes } : undefined,
    part: partSelected(
      part,
      alternatives.map(({ selected }) => selected),
    ),
  };
}

/** The name declaring the variable `name` binds: the first alternative's, for a later one's. */
function declaringName(walk: Walk, name: Identifier): Identifier {
  const entity = walk.scope.entityOf(name);
  return entity?.kind === 'variable' ? entity.name : name;
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
