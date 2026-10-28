/**
 * Annotations (§3.16): struct values computed at compile time, attached to fields, functions and
 * statements. ProgramChecker composes this unit; each item's annotations are checked once, on
 * first demand, by whoever reaches the item first: its declaration's check, a body's statement,
 * the boundary's forms or lowering.
 *
 * - An annotation is checked as a value of its own in its module, and computed as a top-level
 *   constant is (computation.ts), so the two can't disagree on what compile time
 *   computes. A value that isn't a struct is no annotation.
 * - What an annotation means decides where it may stand: the json module's on fields
 *   (`@JsonSkip` only on a field whose type is `Default`, which it reads back as, as found where
 *   the field is declared; `@JsonBigInt` only on an `int`),
 *   `@Waypoint` on a statement that waits, `@Suite` on a function (rules/suites.ts says which),
 *   and any other struct on fields and functions, kept for tools. The same annotation twice on one item says nothing new, so it is an error.
 * - Fields of one struct or variant that end up with the same JSON name are reported where they
 *   are declared, since the clash is in the declaration whether or not the type ever crosses.
 */

import type { Diagnostic } from '../../../diagnostics/diagnostic.ts';
import { type WellKnownDeclaration, wellKnown } from '../../../language/well-known.ts';
import { memo } from '../../../structures/memo.ts';
import type { Span } from '../../../text/span.ts';
import type { ModuleId } from '../../program/program.ts';
import type { Annotatable, Annotation } from '../../syntax/annotations.ts';
import type { FunctionDeclaration } from '../../syntax/declarations.ts';
import type { Expression } from '../../syntax/expressions/index.ts';
import type { NodeOf } from '../../syntax/node.ts';
import type { Statement } from '../../syntax/statements.ts';
import { bodyChildrenOf, type SyntaxNode } from '../../syntax/tree.ts';
import type { CheckedBody } from '../check.ts';
import type {
  AnnotationPlace,
  AnnotationQueries,
  CheckedAnnotation,
} from '../checked-annotation.ts';
import type { CheckerContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { defaultWitness } from '../resolution/default-witness.ts';
import type { FieldMember, Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import { searchSite } from '../use-site.ts';
import { computeConstant, refusalOf } from './computation.ts';

/** The annotations the toolchain itself reads. */
const known = {
  jsonName: wellKnown.jsonName,
  jsonSkip: wellKnown.jsonSkip,
  jsonBigInt: wellKnown.jsonBigInt,
  waypoint: wellKnown.waypoint,
  suite: wellKnown.suite,
} as const satisfies Record<string, WellKnownDeclaration>;

type Known = keyof typeof known;

/** What ProgramChecker gives the unit: how to check an annotation's value as a value of its own. */
export interface AnnotationSeams {
  readonly checker: CheckerContext;
  readonly checkValue: (module: ModuleId, value: Expression) => CheckedBody;
}

export class Annotations implements AnnotationQueries {
  readonly #seams: AnnotationSeams;
  readonly #checked = new Map<NodeOf<string>, readonly CheckedAnnotation[]>();

  constructor(seams: AnnotationSeams) {
    this.#seams = seams;
  }

  /** The annotations on `item` of `module`, standing at `place`, checked once. */
  of(
    module: ModuleId,
    item: Annotatable & NodeOf<string>,
    place: AnnotationPlace,
  ): readonly CheckedAnnotation[] {
    return memo(this.#checked, item, () => this.#check(module, item, place));
  }

  /** Which of the toolchain's own annotations `annotation` is; undefined for any other struct. */
  knownOf(annotation: CheckedAnnotation): Known | undefined {
    const { checker } = this.#seams;
    return (Object.keys(known) as Known[]).find((name) => {
      const entity = checker.wellKnownEntity(known[name]);
      return entity !== undefined && entity === annotation.type.entity;
    });
  }

  /** The annotations on `field`, checked where it is declared; none for one no field declares. */
  ofField(field: FieldMember): readonly CheckedAnnotation[] {
    const { declared } = field;
    return declared === undefined
      ? []
      : this.of(declared.module, declared.node, { kind: 'field', type: field.type });
  }

  /** The name a field has in JSON (§9): its `@JsonName`, or its own. */
  jsonNameOf(field: FieldMember): string {
    const named = this.#knownOn(field, 'jsonName');
    const value = named?.form.kind === 'struct' ? named.form.fields[0] : undefined;
    return value?.kind === 'primitive' && typeof value.value === 'string'
      ? value.value
      : field.name;
  }

  /** The name `statement`'s `@Waypoint` gives where it waits (§10); undefined without one. */
  waypointOf(module: ModuleId, statement: Statement): string | undefined {
    return this.#textOf(this.of(module, statement, statementPlace(statement)), 'waypoint');
  }

  /** The title `declaration`'s `@Suite` gives its suite (§10); undefined without one. */
  suiteTitleOf(module: ModuleId, declaration: FunctionDeclaration): string | undefined {
    return this.#textOf(this.of(module, declaration, { kind: 'function' }), 'suite');
  }

  /** The one string field of the annotation `name` among `annotations`, if it is there. */
  #textOf(annotations: readonly CheckedAnnotation[], name: Known): string | undefined {
    const found = annotations.find((annotation) => this.knownOf(annotation) === name);
    const text = found?.form.kind === 'struct' ? found.form.fields[0] : undefined;
    return text?.kind === 'primitive' && typeof text.value === 'string' ? text.value : undefined;
  }

  /** Whether a field carries the toolchain's annotation `name`. */
  fieldHas(field: FieldMember, name: Known): boolean {
    return this.#knownOn(field, name) !== undefined;
  }

  /**
   * Checks the annotations of each of `fields`, declared together, and reports each field whose
   * JSON name an earlier one already has.
   */
  checkFields(fields: readonly FieldMember[]): void {
    const names = new Set<string>();
    for (const field of fields) {
      this.ofField(field);
      const name = this.jsonNameOf(field);
      const { declared } = field;
      if (names.has(name) && declared !== undefined) {
        this.#seams.checker.report(
          declared.module,
          checkerDiagnostics.jsonNameClash(declared.node.name.span, name),
        );
      }
      names.add(name);
    }
  }

  #knownOn(field: FieldMember, name: Known): CheckedAnnotation | undefined {
    return this.ofField(field).find((annotation) => this.knownOf(annotation) === name);
  }

  #check(
    module: ModuleId,
    item: Annotatable,
    place: AnnotationPlace,
  ): readonly CheckedAnnotation[] {
    const found: CheckedAnnotation[] = [];
    for (const node of item.annotations ?? []) {
      const annotation = this.#value(module, node);
      const problem =
        annotation === undefined ? undefined : this.#problem(annotation, found, place);
      if (problem !== undefined) {
        this.#seams.checker.report(module, problem);
      } else if (annotation !== undefined) {
        found.push(annotation);
      }
    }
    return found;
  }

  /** Why `annotation` doesn't belong at `place` after those `found` there already. */
  #problem(
    annotation: CheckedAnnotation,
    found: readonly CheckedAnnotation[],
    place: AnnotationPlace,
  ): Diagnostic | undefined {
    const { node, type } = annotation;
    const name = type.entity.declaration.name.text;
    if (found.some((earlier) => earlier.type.entity === type.entity)) {
      return checkerDiagnostics.repeatedAnnotation(node.span, name);
    }
    const means = placements[this.knownOf(annotation) ?? 'any'];
    const misplaced = means(
      place,
      (held) =>
        held.kind === 'error' ||
        defaultWitness(searchSite(this.#seams.checker), held) !== undefined,
    );
    if (misplaced === 'elsewhere') {
      return checkerDiagnostics.misplacedAnnotation(node.span, name, placeText(place));
    }
    return misplaced?.(node.span);
  }

  /** `node`'s value as an annotation; undefined after reporting why it isn't one. */
  #value(module: ModuleId, node: Annotation): CheckedAnnotation | undefined {
    const { checker, checkValue } = this.#seams;
    const checked = checkValue(module, node.value);
    const type = checked.result;
    if (type.kind === 'error') {
      return undefined;
    }
    if (type.kind !== 'nominal' || type.entity.declaration.kind !== 'StructDeclaration') {
      checker.report(module, checkerDiagnostics.notAnnotation(node.value.span, typeText(type)));
      return undefined;
    }
    const outcome = computeConstant(node.value, {
      checker,
      constant: undefined,
      checked,
      valueNamed: (name) => checker.constantNamed(module, name),
    });
    if (outcome.kind === 'refused') {
      checker.report(module, refusalOf(outcome));
    }
    return outcome.kind === 'computed' ? { node, type, form: outcome.form } : undefined;
  }
}

/**
 * Where each annotation means something: `'elsewhere'` when `place` is no place for it, a
 * diagnostic at its span when the place is right but the item can't take it, else nothing.
 * Annotations the toolchain doesn't read (`any`) mean something to tools on fields and functions.
 */
const placements: Record<
  Known | 'any',
  (
    place: AnnotationPlace,
    isDefault: (type: Type) => boolean,
  ) => 'elsewhere' | ((at: Span) => Diagnostic) | undefined
> = {
  jsonName: (place) => (place.kind === 'field' ? undefined : 'elsewhere'),
  jsonSkip: (place, isDefault) => {
    if (place.kind !== 'field') {
      return 'elsewhere';
    }
    return isDefault(place.type)
      ? undefined
      : (at) => checkerDiagnostics.skippedWithoutDefault(at, typeText(place.type));
  },
  jsonBigInt: (place) => {
    if (place.kind !== 'field') {
      return 'elsewhere';
    }
    return place.type.kind === 'primitive' && place.type.name === 'int'
      ? undefined
      : (at) => checkerDiagnostics.bigIntNotInt(at, typeText(place.type));
  },
  waypoint: (place) => {
    if (place.kind !== 'statement') {
      return 'elsewhere';
    }
    return place.waits ? undefined : (at) => checkerDiagnostics.waypointWithoutWait(at);
  },
  suite: (place) => (place.kind === 'function' ? undefined : 'elsewhere'),
  any: (place) => (place.kind === 'field' || place.kind === 'function' ? undefined : 'elsewhere'),
};

/** How a diagnostic names `place`. */
function placeText(place: AnnotationPlace): string {
  switch (place.kind) {
    case 'field':
      return 'a field';
    case 'function':
      return 'a function';
    case 'statement':
      return 'a statement';
    case 'other':
      return place.description;
    default: {
      const unhandled: never = place;
      return unhandled;
    }
  }
}

/**
 * Where a statement of a body stands: a local function's annotations mean what a function's do,
 * and any other statement's whether it waits, at an `await` or `select` of its own rather than in
 * a function it nests.
 */
export function statementPlace(statement: Statement): AnnotationPlace {
  return statement.kind === 'FunctionDeclaration'
    ? { kind: 'function' }
    : { kind: 'statement', waits: waits(statement) };
}

function waits(node: SyntaxNode): boolean {
  return node.kind === 'Await' || node.kind === 'Select' || bodyChildrenOf(node).some(waits);
}
