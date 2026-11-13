/**
 * The one walk over a pattern (§3.11, §3.15): what it binds, the tests a value must pass to match
 * it, and its shape for exhaustiveness. Every pattern is walked here: a declaration's or loop's
 * targets, a `match` case's and an `is`'s.
 *
 * - The walk owns the structure every use shares: names and `_`, `as`, tuples, struct field items,
 *   arrays, call patterns' arguments (walk/kinds/variant-calls.ts), or-patterns, and the parts each
 *   reaches (parts.ts). A tuple or struct is taken apart
 *   as an assignment's target is (taking.ts). What could fail to match (a literal, a comparison,
 *   a referring name, a variant, an array's length, a range) is checked by its own kind (kinds/)
 *   in a `match` case or `is`, and refused in a target, which must always match.
 * - A bare name binds when the binder made it a variable, as it does for every bare name of a
 *   target and for a camelCase one in a case (§3.11); otherwise it refers.
 * - Tests come out in the order lowering runs them: a variant is tested before its fields are read.
 * - An or-pattern walks each alternative on its own, into one `or` test. Its alternatives bind the
 *   first's variables (binder), so a binding is named by its variable's declaring name, and the
 *   alternatives must agree on the names and their types (walk/kinds/alternatives.ts). An
 *   alternative its part's type rules out (a `never` test, §3.11) is left out; with none left, the
 *   pattern never matches.
 * - What a pattern selects of its part comes first (selections.ts): a downcast of an `any`
 *   value, or the members of a union's. Type arguments are written only there, on a union's
 *   members, and in a parameter's own pattern, whose head names the parameter's type (§3.3,
 *   `typed`).
 * - A shape is undefined when the pattern acts as a guard for exhaustiveness: it compares by more
 *   than `==` against a literal or variant, tests one field twice, or is a range (§3.11).
 */

import { type Handlers, handlerOf } from '../../../../../foundation/structures/kind-table.ts';
import { unreachable } from '../../../../../foundation/structures/unreachable.ts';
import type {
  NamePattern,
  OrPattern,
  Pattern,
  PatternPart,
  StructPattern,
} from '../../../../syntax/patterns.ts';
import { targetNames, unparenthesizedPattern } from '../../../../syntax/patterns.ts';
import { type Identifier, isMissingName, lastName } from '../../../../syntax/tree/node.ts';
import { type AnchoredSpan, spanAcross } from '../../../../syntax/tree/positions.ts';
import type { BodyContext } from '../../../contexts/body-context.ts';
import { checkerDiagnostics } from '../../../diagnostics/index.ts';
import {
  cantMatch,
  neverTest,
  type PartBinding,
  type PatternTest,
  type TargetBinding,
} from '../../../surface/checked-pattern.ts';
import type { Type } from '../../../types/type/index.ts';
import { errorType, isPrimitive, neverType } from '../../../types/type/primitives.ts';
import { namesOwnType } from '../../../types/written/pattern-types.ts';
import { anyShape, nothingShape, type Shape } from '../exhaustiveness/exhaustiveness.ts';
import { partSelected, sameNames } from './kinds/alternatives.ts';
import { takeArray } from './kinds/arrays.ts';
import { comparison, literal } from './kinds/comparisons.ts';
import { rangeLeaf } from './kinds/ranges.ts';
import { reference } from './kinds/references.ts';
import { isStructNotKnown, restBinding, takeFieldsByName } from './kinds/struct-fields.ts';
import {
  calledVariant,
  takeVariantBraces,
  takeVariantCall,
  variantBraced,
} from './kinds/variant-calls.ts';
import type { ValuePart } from './parts.ts';
import type { Leaf, Selection } from './pattern-tests.ts';
import { literalPart, refuseTypeArguments, selectionOf } from './selections.ts';
import { type Taking, takeApart, takeTargets } from './taking.ts';

/** A pattern as walked. */
export interface WalkedPattern {
  readonly tests: readonly PatternTest[];
  readonly bindings: readonly PartBinding[];
  readonly shape: Shape | undefined;
}

/** Walks `pattern`, a `match` case's or an `is`'s, which may fail to match, over a value of `part`. */
export function walkPattern(
  context: BodyContext,
  pattern: Pattern,
  part: ValuePart,
): WalkedPattern {
  const walk = newWalk(context, true);
  const shape = walk.take(pattern, part);
  return { tests: walk.found, bindings: walk.bindings, shape };
}

/**
 * The names a declaration's or loop's `targets` bind in a value of `type`, each with its part
 * (§3.15). A target refuses whatever could fail to match before taking it apart (`refused`), so
 * its parts are fields and tuple elements only. `typed` is a struct pattern among them whose
 * written type is the value's own, a parameter's (§3.3), so its type arguments are that type's.
 */
export function walkTargets(
  context: BodyContext,
  targets: readonly Pattern[],
  type: Type,
  typed?: StructPattern,
): readonly TargetBinding[] {
  const walk = newWalk(context, false, typed);
  takeTargets(walk, targets, { type, path: [] }, spanOf(targets));
  return walk.bindings.map(({ path, ...binding }) => ({
    ...binding,
    path: path.map((step) =>
      typeof step === 'number' || step.kind === 'field' || step.kind === 'fieldRest'
        ? step
        : unreachable('A target took an array apart, or tested a member.'),
    ),
  }));
}

/** A pattern's walk: what it found so far. */
interface Walk extends Taking<Pattern | PatternPart> {
  /** Whether the pattern may fail to match: a case's or an `is`'s, never a target's. */
  readonly refutable: boolean;
  /** The struct pattern whose written type arguments are its value's type's (`walkTargets`). */
  readonly typed: StructPattern | undefined;
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

function newWalk(context: BodyContext, refutable: boolean, typed?: StructPattern): Walk {
  const walk: Walk = {
    context,
    refutable,
    typed,
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
    walk.refutable
      ? takeArray(walk, { site: node, elements: node.elements }, part)
      : refused(walk, node, part),
  RangePattern: (walk, node, part) =>
    tested(walk, node, part, () => rangeLeaf(walk.context, node, part)),
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
    return tested(walk, node, part, () => reference(walk.context, node, part));
  },
  LiteralPattern: (walk, node, part) =>
    tested(walk, node, part, () => literal(walk.context, node, part)),
  ParenthesizedPattern: () => unreachable('Parenthesized patterns are unwrapped before dispatch.'),
  AsPattern: (walk, node, part) => {
    const matched = takeMatched(walk, node.pattern, part);
    walk.bindings.push({ name: node.name, ...matched.part });
    return matched.shape;
  },
  TuplePattern: (walk, node, part) =>
    takeApart(walk, { kind: 'tuple', elements: node.elements, span: node.span }, part),
  StructPattern: (walk, node, part) => takeStruct(walk, node, part),
  VariantCallPattern: (walk, node, part) =>
    walk.refutable ? takeVariantCall(walk, node, part) : refused(walk, node, part),
  NamedPatternArgument: (walk, item, part) => walk.take(item.pattern, part),
  OtherFieldsPattern: () => anyShape,
  BindFieldPattern: (walk, item, part) => {
    walk.bindings.push({ name: item.alias ?? item.field, ...part });
    return anyShape;
  },
  NestedFieldPattern: (walk, item, part) => walk.take(item.pattern, part),
  CompareFieldPattern: (walk, item, part) =>
    tested(walk, item, part, () => comparison(walk.context, item, part)),
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.

/**
 * `node` matched at `part`: an or-pattern's alternatives each on its own, a call pattern naming no
 * variant, or braces after a variant's name, refused before anything else is asked of them
 * (`refusedCall`, `refusedBraces`), any other pattern as `takeSelecting` takes it.
 */
function takeMatched(walk: Walk, written: Pattern | PatternPart, part: ValuePart): Matched {
  const node =
    written.kind === 'ParenthesizedPattern' ? unparenthesizedPattern(written.pattern) : written;
  if (node.kind === 'OrPattern') {
    return takeAlternatives(walk, node, part);
  }
  return (
    refusedCall(walk, node, part) ??
    refusedBraces(walk, node, part) ??
    takeSelecting(walk, node, part)
  );
}

/**
 * `node`, a call pattern naming no variant, reported (`calledVariant`); undefined for any other
 * pattern. Its arguments are each taken over the error type, so their names bind and what they
 * compare with is checked, in a target only bound, which must always match. Naming its value's own
 * type, it meant the value whole, so it covers it and nothing more is reported of its `match`;
 * naming any other, it covers nothing.
 */
function refusedCall(
  walk: Walk,
  node: Pattern | PatternPart,
  part: ValuePart,
): Matched | undefined {
  if (node.kind !== 'VariantCallPattern' || calledVariant(walk.context, node) !== undefined) {
    return undefined;
  }
  if (walk.refutable) {
    for (const argument of node.arguments) {
      walk.take(argument, { type: errorType, path: part.path });
    }
  } else {
    bindAt(walk, node, part, errorType);
  }
  const entity = walk.context.entityOf(lastName(node.callee.path));
  const covers = entity !== undefined && namesOwnType(walk.context.checker, entity, part.type);
  return { shape: covers ? anyShape : undefined, part };
}

/**
 * `node`, braces after a variant's name, reported (§3.11), nothing selected of its part first;
 * undefined for any other pattern. A target's binds at the error type (kinds/variant-calls.ts).
 */
function refusedBraces(
  walk: Walk,
  node: Pattern | PatternPart,
  part: ValuePart,
): Matched | undefined {
  const braced = variantBraced(walk.context, node);
  if (braced === undefined) {
    return undefined;
  }
  walk.context.report(checkerDiagnostics.variantInBracesPattern(node.span, braced.name));
  if (!walk.refutable) {
    bindAt(walk, node, part, errorType);
    return { shape: anyShape, part };
  }
  return { shape: takeVariantBraces(walk, braced, part), part };
}

/**
 * `node`, no or-pattern, matched at `part`, what it selects of the part first (selections.ts). A
 * part already in error, or a selection refused, was reported where it arose; it takes anything,
 * for exhaustiveness, and a refused one still binds its names, at the error type (`bindAt`). A part
 * of type `Never` has no value (§2), so the pattern never runs: it takes anything and binds its
 * names at `Never`, testing and reporting nothing (resolution/calls/stopped-operations.ts).
 */
function takeSelecting(walk: Walk, node: Pattern | PatternPart, part: ValuePart): Matched {
  const isBinding = node.kind === 'NamePattern' && binds(walk, node);
  if (!isBinding && isPrimitive(part.type, 'Never')) {
    bindAt(walk, node, part, neverType);
    return { shape: anyShape, part };
  }
  const selection =
    walk.refutable && !isBinding ? selectionOf(walk.context, node, part) : undefined;
  if (selection === 'refused') {
    bindAt(walk, node, part, errorType);
    // A downcast is a guard however it goes, the types inside an `any` type being an open set.
    const shape = part.type.kind === 'any' ? undefined : anyShape;
    return { shape, part: { type: errorType, path: part.path } };
  }
  if (selection === undefined) {
    refuseUnwritten(walk, node);
    const shape = handlerOf(patternHandlers, node)(walk, node, part);
    return { shape: part.type.kind === 'error' ? anyShape : shape, part: literalPart(node, part) };
  }
  return selection.test.kind === 'never'
    ? takeRuledOut(walk, node, part)
    : takeSelected(walk, node, selection);
}

/** Refuses type arguments `node` gives, unless they write its value's own type (`typed`). */
function refuseUnwritten(walk: Walk, node: Pattern | PatternPart): void {
  if (node !== walk.typed) {
    refuseTypeArguments(walk.context, node);
  }
}

/**
 * `node` past what it selected: the selection's test, then the rest of it against the selection.
 */
function takeSelected(walk: Walk, node: Pattern | PatternPart, selection: Selection): Matched {
  if (selection.test.kind !== 'member') {
    refuseTypeArguments(walk.context, node);
  }
  walk.found.push(selection.test);
  const inside = selection.decided
    ? anyShape
    : handlerOf(patternHandlers, node)(walk, node, selection.part);
  const part = literalPart(node, selection.part);
  return { shape: selection.shapeOf(inside), part, selected: selection.test };
}

/**
 * `node`, its part's type ruling it out (§3.11): a `never` test, covering nothing, binding `Never`.
 */
function takeRuledOut(walk: Walk, node: Pattern | PatternPart, part: ValuePart): Matched {
  walk.found.push(neverTest);
  bindAt(walk, node, part, neverType);
  return { shape: nothingShape, part: { type: neverType, path: part.path } };
}

/**
 * Whether a name pattern binds a new variable, rather than referring: every bare name of a target,
 * and in a case a bare name the binder made a variable (§3.11).
 */
function binds(walk: Walk, node: NamePattern): boolean {
  const [name, ...rest] = node.path;
  return rest.length === 0 && (!walk.refutable || walk.context.entityOf(name)?.kind === 'variable');
}

/**
 * `A | B`: each alternative walked on its own, as one alternative of an `or` test. Where each
 * selects members of the part's union, what binds the whole has the union of those (`case Int |
 * String as v`); else the part's own type.
 */
function takeAlternatives(walk: Walk, node: OrPattern, part: ValuePart): Matched {
  if (!walk.refutable) {
    return { shape: refused(walk, node, part), part };
  }
  const alternatives = node.alternatives.map((alternative) => {
    const own = newWalk(walk.context, true);
    const { shape, selected } = takeMatched(own, alternative, part);
    const bindings = own.bindings.map((binding) => ({
      ...binding,
      name: declaringName(walk, binding.name),
    }));
    return { span: alternative.span, shape, selected, tests: own.found, bindings };
  });
  // An alternative its part's type rules out never runs, so it neither binds nor covers anything.
  const live = alternatives.filter((alternative) => !cantMatch(alternative.tests));
  const [first, ...others] = live;
  if (first === undefined) {
    return takeRuledOut(walk, node, part);
  }
  for (const other of others) {
    if (!sameNames(first.bindings, other.bindings)) {
      walk.context.report(checkerDiagnostics.differentAlternatives(other.span));
    }
  }
  walk.found.push({
    kind: 'or',
    alternatives: live.map(({ tests: own, bindings }) => ({ tests: own, bindings })),
  });
  const shapes = live.flatMap(({ shape }) => (shape === undefined ? [] : [shape]));
  return {
    shape: shapes.length === live.length ? { kind: 'or', alternatives: shapes } : undefined,
    part: partSelected(
      part,
      live.map(({ selected }) => selected),
      walk.context.checker.typeRules,
    ),
  };
}

/** The name declaring the variable `name` binds: the first alternative's, for a later one's. */
function declaringName(walk: Walk, name: Identifier): Identifier {
  const entity = walk.context.entityOf(name);
  return entity?.kind === 'variable' ? entity.name : name;
}

/**
 * A struct pattern: a struct value's, which always matches; one naming a variant never reaches it
 * (`refusedBraces`).
 */
function takeStruct(walk: Walk, node: StructPattern, part: ValuePart): Shape | undefined {
  const items = node.fields.flatMap((item) =>
    item.kind === 'Invalid' ? [] : [{ name: item.field, span: item.span, target: item }],
  );
  const shape =
    node.type === undefined && isStructNotKnown(walk.context, part.type)
      ? takeFieldsByName(walk, items, part)
      : takeApart(walk, { kind: 'struct', type: node.type, items, span: node.span }, part);
  const rest = restBinding(walk.context.checker.typeRules, node, part);
  if (rest !== undefined) {
    walk.bindings.push(rest);
  }
  return shape;
}

/** A construct that could fail to match: tested in a pattern that may fail, refused in a target. */
function tested(
  walk: Walk,
  node: Pattern | PatternPart,
  part: ValuePart,
  check: () => Leaf,
): Shape | undefined {
  if (!walk.refutable) {
    return refused(walk, node, part);
  }
  const leaf = check();
  walk.found.push(...leaf.tests);
  return leaf.shape;
}

/**
 * A construct that could fail to match, standing in a target, which must always match: reported
 * once, its names bound at the error type (`bindAt`). Nothing inside it is taken apart, so a
 * target's parts are fields and tuple elements only.
 */
function refused(walk: Walk, node: Pattern | PatternPart, part: ValuePart): Shape {
  walk.context.report(checkerDiagnostics.refutableTarget(node.span));
  bindAt(walk, node, part, errorType);
  return anyShape;
}

/**
 * Binds each name `node` binds at `type`, the error type or `Never`, to the part it stands at: what
 * a pattern that isn't taken apart, refused where it stands, naming nothing or never running,
 * binds, so each use of its names resolves with nothing more to report, and an or-pattern's
 * alternatives still agree on them. In a case, a bare name the binder didn't make a variable refers
 * to something, so it binds nothing.
 */
function bindAt(walk: Walk, node: Pattern | PatternPart, part: ValuePart, type: Type): void {
  const names = new Set(
    targetNames(node).flatMap((name) => {
      const entity = walk.context.entityOf(name);
      if (entity?.kind === 'variable') {
        return [entity.name];
      }
      return walk.refutable ? [] : [name];
    }),
  );
  for (const name of names) {
    walk.bindings.push({ name, type, path: part.path });
  }
}

/** From the first of `targets` to the last; the parser reads at least one. */
function spanOf(targets: readonly Pattern[]): AnchoredSpan {
  const [first] = targets;
  const last = targets.at(-1);
  return first === undefined || last === undefined
    ? unreachable('A declaration has no targets.')
    : spanAcross(first.span, last.span);
}
