/**
 * Taking a value apart by a declaration's or loop's targets (§3.15): which names the targets bind,
 * the type of each one's part, and the steps from the whole value to that part.
 *
 * - One walk serves every consumer: a body declares the names, a top-level constant computes each
 *   part from its value, and lowering reads each part along its steps. None repeats the shapes.
 *   An assignment's targets take a value apart with the same parts (statements/assignments.ts).
 * - Several targets take apart a tuple of that many values, as if parenthesized.
 * - A target must always match. Names, `_`, `as`, and tuple and struct patterns take any value of
 *   the right shape; a literal, a comparison, a qualified name or an enum variant could fail, so
 *   each is reported here, and belongs in `match` or `is` (§3.11).
 * - A struct pattern names the value's own type, or takes it with `struct{…}`, as a `struct{…}`
 *   literal takes the expected type (§3.1). A generic struct is named without its arguments: the
 *   value has them.
 * - A part of a value already in error binds its names to the error type, so each mistake is
 *   reported once.
 */

import type { Diagnostic } from '../../../diagnostics/diagnostic.ts';
import { type Handlers, handlerOf } from '../../../structures/kind-table.ts';
import type { Span } from '../../../text/span.ts';
import type { Entity } from '../../binder/entities.ts';
import { type Identifier, type Invalid, lastName } from '../../syntax/node.ts';
import type { Pattern, PatternPart, StructPattern } from '../../syntax/patterns.ts';
import type { NamedType } from '../../syntax/types.ts';
import type { TargetBinding } from '../check.ts';
import { checkerDiagnostics } from '../diagnostics.ts';
import { errorType, type FieldMember, type Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';

/** What the walk reads and where it reports, from a body or from a top-level constant. */
export interface DestructuringScope {
  readonly fieldsOf: (type: Type) => readonly FieldMember[] | undefined;
  readonly entityOf: (name: Identifier) => Entity | undefined;
  readonly report: (diagnostic: Diagnostic) => void;
}

/** A part of a value being taken apart: its type, and its positions in the whole value. */
export interface ValuePart {
  readonly type: Type;
  readonly path: readonly number[];
}

/** The body as destructuring reads it. */
export function bodyScope(context: {
  readonly checker: { readonly fieldsOf: DestructuringScope['fieldsOf'] };
  readonly entityOf: DestructuringScope['entityOf'];
  readonly report: DestructuringScope['report'];
}): DestructuringScope {
  return {
    fieldsOf: (type) => context.checker.fieldsOf(type),
    entityOf: (name) => context.entityOf(name),
    report: (diagnostic) => context.report(diagnostic),
  };
}

/** The names `targets` bind in a value of `type`, reporting what can't take it apart. */
export function destructure(
  scope: DestructuringScope,
  targets: readonly Pattern[],
  type: Type,
): readonly TargetBinding[] {
  const bindings: TargetBinding[] = [];
  const walk: Walk = { scope, bindings };
  const whole = { type, path: [] };
  const [only] = targets;
  if (targets.length === 1 && only !== undefined) {
    take(walk, only, whole);
  } else {
    takeElements(walk, targets, whole, spanOf(targets));
  }
  return bindings;
}

/**
 * The `count` elements of `part`, a tuple of that many, at `span`; each of the error type, after
 * a report, when it is anything else.
 */
export function elementParts(
  scope: Pick<DestructuringScope, 'report'>,
  part: ValuePart,
  count: number,
  span: Span,
): readonly ValuePart[] {
  const { type } = part;
  const fits = type.kind === 'error' || (type.kind === 'tuple' && type.elements.length === count);
  if (!fits) {
    scope.report(checkerDiagnostics.tupleArity(span, count, typeText(type)));
  }
  return Array.from({ length: count }, (_, index) => ({
    type: type.kind === 'tuple' && fits ? (type.elements[index] ?? errorType) : errorType,
    path: [...part.path, index],
  }));
}

/**
 * The fields of the struct a pattern or target at `span` takes apart: the value's own, when it
 * names the value's type (`named`) or takes it with `struct{…}`. Undefined after a report, or for
 * an error value. Naming an enum variant can fail to match, so it is refused.
 */
export function structParts(
  scope: DestructuringScope,
  named: NamedType | undefined,
  type: Type,
  span: Span,
): readonly FieldMember[] | undefined {
  const entity = named === undefined ? undefined : scope.entityOf(lastName(named.path));
  if (entity?.kind === 'variant' || entity?.kind === 'variants') {
    scope.report(checkerDiagnostics.refutableTarget(span));
    return undefined;
  }
  if (type.kind === 'error') {
    return undefined;
  }
  if (named !== undefined) {
    const name = lastName(named.path);
    const declaration = entity?.kind === 'type' ? entity.declaration : undefined;
    if (type.kind !== 'nominal' || declaration !== type.entity.declaration) {
      scope.report(checkerDiagnostics.typeMismatch(named.span, name.text, typeText(type)));
      return undefined;
    }
  }
  const fields = scope.fieldsOf(type);
  if (fields === undefined) {
    scope.report(checkerDiagnostics.notStructValue(span, typeText(type)));
  }
  return fields;
}

/**
 * The part of a struct value of `part` that its field `name` holds, among `fields`; an unknown
 * name is reported, and its part has the error type.
 */
export function fieldPart(
  scope: Pick<DestructuringScope, 'report'>,
  fields: readonly FieldMember[] | undefined,
  name: Identifier,
  part: ValuePart,
): ValuePart {
  const index = fields?.findIndex((candidate) => candidate.name === name.text) ?? -1;
  const field = fields?.[index];
  if (fields !== undefined && field === undefined) {
    scope.report(checkerDiagnostics.unknownField(name.span, typeText(part.type), name.text));
  }
  return { type: field?.type ?? errorType, path: [...part.path, index] };
}

interface Walk {
  readonly scope: DestructuringScope;
  readonly bindings: TargetBinding[];
}

/** A struct pattern's item, with the fields its struct has. */
type FieldItem = PatternPart | Invalid;

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
const targetHandlers: Handlers<Walk, Pattern, [ValuePart], void> = {
  WildcardPattern: () => undefined,
  Missing: () => undefined,
  Invalid: () => undefined,
  NamePattern: (walk, node, part) => {
    const [name, ...rest] = node.path;
    if (rest.length > 0) {
      refutable(walk, node.span);
      return;
    }
    walk.bindings.push({ name, ...part });
  },
  LiteralPattern: (walk, node) => refutable(walk, node.span),
  ParenthesizedPattern: (walk, node, part) => take(walk, node.pattern, part),
  AsPattern: (walk, node, part) => {
    take(walk, node.pattern, part);
    walk.bindings.push({ name: node.name, ...part });
  },
  TuplePattern: (walk, node, part) => takeElements(walk, node.elements, part, node.span),
  StructPattern: (walk, node, part) => takeFields(walk, node, part),
};

const fieldHandlers: Handlers<
  Walk,
  FieldItem,
  [readonly FieldMember[] | undefined, ValuePart],
  void
> = {
  BindFieldPattern: (walk, item, fields, part) =>
    walk.bindings.push({
      name: item.alias ?? item.field,
      ...fieldPart(walk.scope, fields, item.field, part),
    }),
  NestedFieldPattern: (walk, item, fields, part) =>
    take(walk, item.pattern, fieldPart(walk.scope, fields, item.field, part)),
  CompareFieldPattern: (walk, item) => refutable(walk, item.span),
  Invalid: () => undefined,
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.

function take(walk: Walk, node: Pattern, part: ValuePart): void {
  handlerOf(targetHandlers, node)(walk, node, part);
}

function takeElements(walk: Walk, elements: readonly Pattern[], part: ValuePart, span: Span): void {
  const parts = elementParts(walk.scope, part, elements.length, span);
  for (const [index, element] of elements.entries()) {
    take(walk, element, parts[index] ?? part);
  }
}

function takeFields(walk: Walk, node: StructPattern, part: ValuePart): void {
  const fields = structParts(walk.scope, node.type, part.type, node.span);
  for (const item of node.fields) {
    handlerOf(fieldHandlers, item)(walk, item, fields, part);
  }
}

function refutable(walk: Walk, span: Span): void {
  walk.scope.report(checkerDiagnostics.refutableTarget(span));
}

function spanOf(targets: readonly Pattern[]): Span {
  const first = targets[0]?.span;
  const last = targets.at(-1)?.span;
  return { start: first?.start ?? 0, end: last?.end ?? 0 };
}
