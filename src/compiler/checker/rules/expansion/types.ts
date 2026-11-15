/**
 * Generic types that would need endlessly many instantiations (§3.5): `struct W<T>` with a field of
 * type `W<(T,)>?` makes `W<Int>`, `W<(Int,)>` and so on without end.
 *
 * The expansion graph (edges.ts) takes its edges from fields here: each generic struct or enum a
 * field's type names, at any depth, gives that type's parameters arguments built from the declaring
 * type's own. A field cut from the graph is reported where its declaration's layout is made, once,
 * and the layout reads its type as the error type (constructs/declarations/layout/index.ts), so
 * every walk over types meets finitely many instantiations.
 *
 * Fields are cut in two strata, so that whether a field is cut never depends on code that reads it:
 * - A field whose type is written is cut when it makes an expanding edge on a cycle of written
 *   fields: its type and its cut are known without checking any code, and a default may read it.
 * - A field typed by its default has its type once the default is checked, which may read written
 *   fields' layouts. With its edges added to what the first stratum leaves, it is cut when it lies
 *   on a cycle that grows, whichever field on the cycle expands: the cycle ends at it.
 *
 * Checking a default reads layouts, which ask for cuts, and a cut's walk checks the defaults it
 * meets, which may read a layout still open on the way to it. So a cut of the second stratum is
 * decided only outside defaults being checked to type what they give (`typingDefaults`) and other
 * cuts' walks, over the whole graph, checking every default on it: whether a field is cut, and what
 * is reported, never depends on what was asked first. Inside them, a field reads as cut when the
 * fields whose defaults are checked already make a growing cycle through it, which the whole graph
 * makes too; else as it is, though it may be cut once decided. A walk over types checks the fields
 * it reads, so it goes round a growing cycle at most once before the cycle is cut.
 */

import type { EntryTable } from '../../../../foundation/structures/entries/index.ts';
import {
  sameItems,
  sameMembers,
  sameProperties,
} from '../../../../foundation/structures/equality.ts';
import type { ModuleId } from '../../../program/program.ts';
import {
  type DeclaredField,
  type DeclaredStruct,
  type EnumDeclaration,
  type Field,
  typeParametersOf,
} from '../../../syntax/declarations/index.ts';
import type { CheckerContext, CheckerNote } from '../../contexts/context.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { nominalsIn } from '../../types/parts/type-parts.ts';
import type { FieldMember, ParameterKey, Type } from '../../types/type/index.ts';
import { type ArgumentEdge, argumentEdges, endlessEdgesFrom, growingEdgesFrom } from './edges.ts';

/** A declaration with fields of its own: a struct's, shared or not, or an enum's variants'. */
export type FieldedDeclaration = DeclaredStruct | EnumDeclaration;

interface FieldEdge extends ArgumentEdge {
  readonly declaration: FieldedDeclaration;
  readonly field: DeclaredField;
  /** The generic type the field names, whose own fields the graph follows next. */
  readonly reached: FieldedDeclaration;
}

type ExpansionSeams = Pick<
  CheckerContext,
  'entries' | 'resolveType' | 'moduleOf' | 'report' | 'typingDefaults'
>;

/**
 * Each field typed alone, before it may be cut, a default checked to type its field
 * (layout/index.ts); running while that default is checked.
 */
type FieldTypes = Pick<
  EntryTable<CheckerNote, DeclaredField, FieldMember, FieldedDeclaration>,
  'get' | 'computed' | 'running'
>;

/** How a walk of the second stratum reads the edges of a field typed by its default. */
type DefaultedEdges = (
  field: DeclaredField,
  declaration: FieldedDeclaration,
) => readonly FieldEdge[];

const sameEdges = sameItems<FieldEdge>(sameProperties);

export class TypeExpansion {
  readonly #checker: ExpansionSeams;
  readonly #fieldTypes: FieldTypes;
  /** Each declaration's edges from the fields whose types are written. */
  readonly #writtenEdges: EntryTable<CheckerNote, FieldedDeclaration, readonly FieldEdge[]>;
  /** The written fields each declaration cuts: the first stratum. */
  readonly #endless: EntryTable<CheckerNote, FieldedDeclaration, ReadonlySet<DeclaredField>>;
  /** The edges of each field typed by its default, once the default is checked. */
  readonly #defaultedEdges: EntryTable<
    CheckerNote,
    DeclaredField,
    readonly FieldEdge[],
    FieldedDeclaration
  >;
  /**
   * Whether a field typed by its default is cut: the second stratum. Each field walks from its own
   * edges.
   */
  readonly #cut: EntryTable<CheckerNote, DeclaredField, boolean, FieldedDeclaration>;

  constructor(checker: ExpansionSeams, fieldTypes: FieldTypes) {
    this.#checker = checker;
    this.#fieldTypes = fieldTypes;
    this.#writtenEdges = checker.entries.table({
      name: 'field edges',
      compute: (declaration) =>
        this.#edgesOf(declaration, writtenFieldsOf(declaration), (field, module) =>
          field.type === undefined ? undefined : checker.resolveType(module, field.type),
        ),
      equal: sameEdges,
    });
    this.#endless = checker.entries.table({
      name: 'endless fields',
      compute: (declaration) =>
        this.#reported(
          declaration,
          endlessEdgesFrom([declaration], (each) => this.#writtenEdges.get(each), reachedBy),
        ),
      equal: sameMembers,
    });
    this.#defaultedEdges = checker.entries.table({
      name: 'defaulted field edges',
      compute: (field, declaration) =>
        this.#edgesOf(declaration, [field], () => fieldTypes.get(field, declaration).type),
      equal: sameEdges,
    });
    this.#cut = checker.entries.table({
      name: 'cut defaulted field',
      compute: (field, declaration) => this.#cutField(declaration, field),
    });
  }

  /**
   * Whether `field` of `declaration` is cut from the graph, which reports it once; while defaults
   * are checked or a cut walks, whether the defaults checked already cut a field typed by its own.
   */
  isEndless(declaration: FieldedDeclaration, field: Field): boolean {
    if (field.kind !== 'DeclaredField') {
      return false;
    }
    if (field.type !== undefined) {
      return this.#endless.get(declaration).has(field);
    }
    if (this.#checker.typingDefaults() || this.#cut.anyRunning()) {
      const checked: DefaultedEdges = (each, owner) => this.#checkedEdges(each, owner);
      return this.#grows(field, checked(field, declaration), checked);
    }
    return this.#cut.get(field, declaration);
  }

  /** Whether `field`, typed by its default, lies on a cycle that grows; reported once if so. */
  #cutField(declaration: FieldedDeclaration, field: DeclaredField): boolean {
    const own = this.#defaultedEdges.get(field, declaration);
    const cut = this.#grows(field, own, (each, owner) => this.#defaultedEdges.get(each, owner));
    if (cut) {
      this.#reported(declaration, own);
    }
    return cut;
  }

  /**
   * Whether `field`, making the edges `own`, lies on a cycle that grows among what the first
   * stratum leaves and the edges `defaulted` reads.
   */
  #grows(field: DeclaredField, own: readonly FieldEdge[], defaulted: DefaultedEdges): boolean {
    const edgesOf = (node: FieldedDeclaration | DeclaredField) =>
      node.kind === 'DeclaredField' ? own : this.#strataEdges(node, defaulted);
    return growingEdgesFrom([field], edgesOf, reachedBy).some((edge) => edge.field === field);
  }

  /** The edges the second stratum reads: what the first leaves, and the defaulted fields'. */
  #strataEdges(declaration: FieldedDeclaration, defaulted: DefaultedEdges): readonly FieldEdge[] {
    const endless = this.#endless.get(declaration);
    return [
      ...this.#writtenEdges.get(declaration).filter(({ field }) => !endless.has(field)),
      ...defaultedFieldsOf(declaration).flatMap((field) => defaulted(field, declaration)),
    ];
  }

  /** The edges of `field` if its default is checked already, checking none; else none. */
  #checkedEdges(field: DeclaredField, declaration: FieldedDeclaration): readonly FieldEdge[] {
    const checked =
      !this.#fieldTypes.running(field) && this.#fieldTypes.computed(field) !== undefined;
    return checked ? this.#defaultedEdges.get(field, declaration) : [];
  }

  /** The fields of `declaration` among `edges`, each reported. */
  #reported(
    declaration: FieldedDeclaration,
    edges: readonly FieldEdge[],
  ): ReadonlySet<DeclaredField> {
    const fields = new Set(
      edges.filter((edge) => edge.declaration === declaration).map((edge) => edge.field),
    );
    const module = this.#checker.moduleOf(declaration);
    for (const field of fields) {
      this.#checker.report(
        module,
        checkerDiagnostics.expandingType(field.name.span, declaration.name.text, field.name.text),
      );
    }
    return fields;
  }

  /** The edges `fields` of `declaration` make, each typed by `typeOf`. */
  #edgesOf(
    declaration: FieldedDeclaration,
    fields: readonly DeclaredField[],
    typeOf: (field: DeclaredField, module: ModuleId) => Type | undefined,
  ): readonly FieldEdge[] {
    const own = new Set<ParameterKey>(typeParametersOf(declaration.typeParameters));
    const module = this.#checker.moduleOf(declaration);
    return fields.flatMap((field) => {
      const type = typeOf(field, module);
      return type === undefined
        ? []
        : nominalsIn(type).flatMap(({ entity, arguments: typeArguments }) => {
            const reached = entity.declaration;
            if (reached.kind === 'ExternStructDeclaration') {
              return [];
            }
            return argumentEdges(own, reached.typeParameters, typeArguments).map((edge) => ({
              ...edge,
              declaration,
              field,
              reached,
            }));
          });
    });
  }
}

function reachedBy(edge: FieldEdge): FieldedDeclaration {
  return edge.reached;
}

/** The fields `declaration` declares: a struct's, or every variant's of an enum. */
function declaredFieldsOf(declaration: FieldedDeclaration): readonly DeclaredField[] {
  const fields =
    declaration.kind === 'EnumDeclaration'
      ? declaration.variants.flatMap((variant) =>
          variant.kind === 'Variant' ? variant.fields : [],
        )
      : declaration.fields;
  return fields.filter((field) => field.kind === 'DeclaredField');
}

function writtenFieldsOf(declaration: FieldedDeclaration): readonly DeclaredField[] {
  return declaredFieldsOf(declaration).filter((field) => field.type !== undefined);
}

function defaultedFieldsOf(declaration: FieldedDeclaration): readonly DeclaredField[] {
  return declaredFieldsOf(declaration).filter((field) => field.type === undefined);
}
