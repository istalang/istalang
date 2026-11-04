/**
 * Annotations (§3.16): struct values computed at compile time, attached to fields, functions and
 * statements. ProgramChecker composes this unit; each item's annotations are checked once, on
 * first demand: by its declaration's check, a body's statement, the boundary's forms or lowering.
 * What they are checked against depends on the item alone: a field's on its type as declared,
 * whatever instance of its struct asks, and an annotation's value is checked on its own.
 *
 * - An annotation is checked as a value of its own in its module, and computed as a top-level
 *   constant is (computation.ts), so the two can't disagree on what compile time
 *   computes. A value that isn't a struct is no annotation.
 * - What an annotation means decides where it may stand, and none on a shape's field, which has no
 *   declaration to carry one (§3.16): the json module's on fields
 *   (`@JsonSkip` only on a field whose type is `Default`, which it reads back as, as found where
 *   the field is declared; `@JsonBigInt` only on an `Int`),
 *   `@Waypoint` on a statement that waits, `@Suite` on a function (rules/suites.ts says which),
 *   and any other struct on fields and functions, kept for tools. The same annotation twice on one item says nothing new, so it is an error.
 * - Fields of one struct or variant that end up with the same JSON name are reported where they
 *   are declared, since the clash is in the declaration whether or not the type ever crosses.
 */

import type { Diagnostic } from '../../../diagnostics/diagnostic.ts';
import { type WellKnownDeclaration, wellKnown } from '../../../language/well-known.ts';
import type { EntryTable } from '../../../structures/entries/index.ts';
import { sameItems } from '../../../structures/equality.ts';
import type { ModuleId } from '../../program/program.ts';
import type { Annotatable, Annotation } from '../../syntax/annotations.ts';
import type { Declaration, Field, FunctionDeclaration } from '../../syntax/declarations.ts';
import type { Expression } from '../../syntax/expressions/index.ts';
import type { Invalid, NodeOf } from '../../syntax/node.ts';
import type { AnchoredSpan } from '../../syntax/positions.ts';
import type { Statement } from '../../syntax/statements.ts';
import type { CheckedBody } from '../check.ts';
import {
  type AnnotationPlace,
  type CheckedAnnotation,
  canAnnotate,
  statementPlace,
} from '../checked-annotation.ts';
import { sameForm } from '../constant-form.ts';
import type { AnnotationChecks, CheckerContext, CheckerNote } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { defaultWitness } from '../resolution/default-witness.ts';
import { declaredFieldOf, type FieldOwner } from '../types/declared-fields.ts';
import { errorType, type FieldMember, type Type } from '../types/type.ts';
import { sameTypeSpelled } from '../types/type-parts.ts';
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

export class Annotations implements AnnotationChecks {
  readonly #seams: AnnotationSeams;
  readonly #checked: EntryTable<
    CheckerNote,
    Annotatable & NodeOf<string>,
    readonly CheckedAnnotation[],
    { readonly module: ModuleId; readonly place: AnnotationPlace }
  >;
  readonly #bodies: EntryTable<CheckerNote, Annotation, CheckedBody, ModuleId>;

  constructor(seams: AnnotationSeams) {
    this.#seams = seams;
    this.#checked = seams.checker.entries.table({
      name: 'annotations',
      compute: (item, { module, place }) => this.#check(module, item, place),
      equal: sameItems(
        (first, second) =>
          first.node === second.node &&
          sameTypeSpelled(first.type, second.type) &&
          sameForm(first.form, second.form),
      ),
    });
    this.#bodies = seams.checker.entries.table({
      name: 'annotation bodies',
      compute: (annotation, module) => seams.checkValue(module, annotation.value),
    });
  }

  /** The annotations on `item` of `module`, standing at `place`, checked once. */
  of(
    module: ModuleId,
    item: Annotatable & NodeOf<string>,
    place: AnnotationPlace,
  ): readonly CheckedAnnotation[] {
    return this.#checked.get(item, { module, place });
  }

  bodyOf(module: ModuleId, annotation: Annotation): CheckedBody {
    return this.#bodies.get(annotation, module);
  }

  /** Which of the toolchain's own annotations `annotation` is; undefined for any other struct. */
  knownOf(annotation: CheckedAnnotation): Known | undefined {
    const { checker } = this.#seams;
    return (Object.keys(known) as Known[]).find((name) => {
      const entity = checker.wellKnownEntity(known[name]);
      return entity !== undefined && entity === annotation.type.entity;
    });
  }

  /**
   * The annotations on `field`, checked where it is declared, against its type there whatever
   * instance asks; none for one no field declares.
   */
  ofField(field: FieldMember): readonly CheckedAnnotation[] {
    const { declared } = field;
    return declared === undefined ? [] : this.of(declared.module, declared.node, { kind: 'field' });
  }

  /** The name a field has in JSON (§9): its `@JsonName`, or its own. */
  jsonNameOf(field: FieldMember): string {
    return this.#textOf(this.ofField(field), 'jsonName') ?? field.name;
  }

  /** The name `statement`'s `@Waypoint` gives where it waits (§10); undefined without one. */
  waypointOf(module: ModuleId, statement: Statement): string | undefined {
    return this.#textOf(this.of(module, statement, statementPlace(statement)), 'waypoint');
  }

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
    item: Annotatable & NodeOf<string>,
    place: AnnotationPlace,
  ): readonly CheckedAnnotation[] {
    const found: CheckedAnnotation[] = [];
    const placed = place.kind === 'field' ? this.#fieldPlace(module, item) : place;
    if (placed === undefined) {
      return found;
    }
    for (const node of item.annotations ?? []) {
      const annotation = this.#value(module, node);
      const problem =
        annotation === undefined ? undefined : this.#problem(annotation, found, placed);
      if (problem !== undefined) {
        this.#seams.checker.report(module, problem);
      } else if (annotation !== undefined) {
        found.push(annotation);
      }
    }
    return found;
  }

  /**
   * Where the field `node` of `module` stands: in a struct, a variant or a trait, with the type it
   * is declared with there; undefined in a shape, whose field takes no annotation, as resolving
   * its type reported (§3.16). Its owner is found among the module's items, which checking reads,
   * not by walking its tree, and its type is read here, in the entry of its annotations, so the
   * entry depends on both.
   */
  #fieldPlace(module: ModuleId, node: NodeOf<string>): Placed | undefined {
    const { checker } = this.#seams;
    const owner = checker.inputs.itemsOf(module).find((item) => declaresField(item, node));
    if (owner === undefined) {
      return undefined;
    }
    const field = declaredFieldOf(checker, module, owner, node as Field);
    return { kind: 'field', type: field?.declared?.type ?? errorType };
  }

  /** Why `annotation` doesn't belong at `place` after those `found` there already. */
  #problem(
    annotation: CheckedAnnotation,
    found: readonly CheckedAnnotation[],
    place: Placed,
  ): Diagnostic<AnchoredSpan> | undefined {
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
    const { checker } = this.#seams;
    const checked = this.bodyOf(module, node);
    const type = checked.result;
    if (type.kind === 'error') {
      return undefined;
    }
    if (type.kind !== 'nominal' || !canAnnotate(type.entity)) {
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
      checker.report(module, refusalOf(outcome, checkerDiagnostics.annotationNotConstant));
    }
    return outcome.kind === 'computed' ? { node, type, form: outcome.form } : undefined;
  }
}

/** A place as its annotations' check reads it: a field's with the type it is declared with. */
type Placed =
  | Exclude<AnnotationPlace, { readonly kind: 'field' }>
  | { readonly kind: 'field'; readonly type: Type };

/**
 * Where each annotation means something: `'elsewhere'` when `place` is no place for it, a
 * diagnostic at its span when the place is right but the item can't take it, else nothing.
 * Annotations the toolchain doesn't read (`any`) mean something to tools on fields and functions.
 */
const placements: Record<
  Known | 'any',
  (
    place: Placed,
    isDefault: (type: Type) => boolean,
  ) => 'elsewhere' | ((at: AnchoredSpan) => Diagnostic<AnchoredSpan>) | undefined
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
    return place.type.kind === 'primitive' && place.type.name === 'Int'
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
function placeText(place: Placed): string {
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
 * Whether `item` declares the field `node`: a struct's own, one of its variants', or a trait's;
 * a shape's fields are no item's.
 */
function declaresField(
  item: Declaration | Invalid,
  node: NodeOf<string>,
): item is Extract<FieldOwner, Declaration> {
  switch (item.kind) {
    case 'StructDeclaration':
    case 'SharedStructDeclaration':
      return item.fields.some((field) => field === node);
    case 'EnumDeclaration':
      return item.variants.some(
        (variant) => variant.kind === 'Variant' && variant.fields.some((field) => field === node),
      );
    case 'TraitDeclaration':
      return item.members.some((member) => member === node);
    default:
      return false;
  }
}
