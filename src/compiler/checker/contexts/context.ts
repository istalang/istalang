/**
 * The program-wide context checking runs in, as an interface, so per-construct modules depend on
 * it and never on each other or on the class implementing it (program-checker.ts). This is the
 * same seam the parser's grammar and the binder's local binder use: construct modules recurse
 * through the context, and the wiring lives in one place.
 *
 * - `CheckerContext` answers program-wide questions, each memoized per Program: what later phases
 *   read (../check.ts), plus reporting, type nodes' types, and the prelude's types and functions.
 * - One body is checked in a `BodyContext` (body-context.ts), which asks this one.
 *
 * This contract names nothing above the type model, so no folder reaches another through it
 * (.dependency-cruiser.mjs).
 */

import type { Diagnostic } from '../../../foundation/diagnostics/diagnostic.ts';
import type { LanguageModule } from '../../../foundation/language/well-known/index.ts';
import type { Entries } from '../../../foundation/structures/entries/index.ts';
import type { VariantEntity } from '../../binder/entities.ts';
import type { ModuleId } from '../../program/program.ts';
import type {
  Declaration,
  DeclaredStruct,
  EnumDeclaration,
  FunctionDeclaration,
  RequiredAssociatedType,
  TypeAliasDeclaration,
  TypeParameter,
} from '../../syntax/declarations/index.ts';
import type { Block } from '../../syntax/statements/index.ts';
import type { SyntaxTree } from '../../syntax/tree/index.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import type { TypeNode } from '../../syntax/types/index.ts';
import type { Checker, VariantMember } from '../check.ts';
import type { AnnotationQueries } from '../surface/checked-annotation.ts';
import type { JsonCodecs } from '../surface/json-form.ts';
import type { ResolvedCall } from '../surface/resolved-call.ts';
import type { Fit, Fitting } from '../types/fitting/fit/index.ts';
import type { Substitution } from '../types/parts/substitution.ts';
import type { Constraint, FieldMember, NominalDeclaration, Type } from '../types/type/index.ts';
import type { AssociatedBounds, StructConstraintModel } from '../types/type/struct-constraint.ts';
import type { StaticOwner } from '../types/written/named-types.ts';
import type { TypeMatchQueries } from '../types/written/type-match.ts';
import type { UseSite } from './use-site.ts';

/** A declaration an instantiation gives type arguments: a function, a nominal type or an alias. */
export type Instantiable = FunctionDeclaration | NominalDeclaration | TypeAliasDeclaration;

/**
 * What an instantiation at `at` must pass once its module is checked (§3.5): `typeArguments`
 * giving `parameter` an argument meeting its constraints, or giving `declaration` arguments every
 * type `match` it reaches reduces for (§3.17).
 */
export type ConstraintCheck =
  | {
      readonly kind: 'meets';
      readonly at: AnchoredSpan;
      readonly parameter: TypeParameter;
      readonly typeArguments: Substitution;
    }
  | {
      readonly kind: 'reduces';
      readonly at: AnchoredSpan;
      readonly declaration: Instantiable;
      readonly typeArguments: Substitution;
    };

/**
 * What an entry notes while it computes (foundation/structures/entries/): a diagnostic reported in
 * a module, or a constraint check to run once that module is checked (`constrainLater`).
 */
export type CheckerNote =
  | {
      readonly kind: 'diagnostic';
      readonly module: ModuleId;
      readonly diagnostic: Diagnostic<AnchoredSpan>;
    }
  | ConstraintNote;

/** A constraint check to run once `module` is checked. */
export interface ConstraintNote {
  readonly kind: 'constraint';
  readonly module: ModuleId;
  readonly check: ConstraintCheck;
}

/**
 * What checking reads of its Program, each answer recorded in the entry computing now
 * (program-inputs.ts), so an entry depends only on the parts it read. Checking reads a program
 * through these alone, never through `program`.
 */
export interface ProgramInputs {
  /** `module`'s top-level items, as its tree holds them. */
  readonly itemsOf: (module: ModuleId) => SyntaxTree['root']['items'];
  /** The modules `module`'s imports name. */
  readonly importedBy: (module: ModuleId) => readonly ModuleId[];
  /** The std module the language refers to as `role`; undefined when the program lacks it. */
  readonly role: (role: LanguageModule) => ModuleId | undefined;
  /** `module`'s tree, which tools walk up from a node; checking reads `itemsOf`. */
  readonly treeOf: (module: ModuleId) => SyntaxTree;
  /** The body of `declaration`, a function of `module`, read apart from the rest of its tree. */
  readonly bodyOf: (module: ModuleId, declaration: FunctionDeclaration) => Block | undefined;
  /**
   * The first variant of the program named `name` (§3.11) declared by one of `enums`, in the
   * order the program lists its variants: what a bare name expecting those enums chooses.
   */
  readonly variantNamed: (
    name: string,
    enums: readonly EnumDeclaration[],
  ) => VariantEntity | undefined;
  /**
   * The variants named `name` whose enum `module`'s top level names, through which a bare one there
   * can be qualified: a module's own answer, whatever enums other modules declare.
   */
  readonly variantsQualifiableIn: (module: ModuleId, name: string) => readonly VariantEntity[];
}

/**
 * Where a body is checked, as a rule over types applied there reads it: the program-wide services,
 * the module, and where it reports (body-context.ts holds the rest).
 */
export interface CheckedModule {
  readonly checker: CheckerContext;
  readonly module: ModuleId;
  readonly report: (diagnostic: Diagnostic<AnchoredSpan>) => void;
}

/**
 * The program-wide services, beyond what later phases read (../check.ts). A checker unit reads its
 * program only through `inputs`, which records each read in the entry making it, so the program
 * itself is no member here.
 */
export interface CheckerContext extends Omit<Checker, 'program'> {
  /**
   * The tables every program-wide result is kept in, each entry with what it read and reported,
   * so an answer never depends on what was asked before it.
   */
  readonly entries: Entries<CheckerNote>;
  /** What checking reads of its program; `bindings` records its answers alike. */
  readonly inputs: ProgramInputs;
  /**
   * Checks the top-level item `item` of `module` whole, once: what its module's check reads of
   * it, and what a lookup reads before it reads what checking decided inside the item.
   */
  readonly checkItem: (module: ModuleId, item: Declaration) => void;
  /** Reports `diagnostic` in `module`, from the entry computing now. */
  readonly report: (module: ModuleId, diagnostic: Diagnostic<AnchoredSpan>) => void;
  /** How many diagnostics the entry computing now has reported itself, so far. */
  readonly reportCount: () => number;
  /** The type `node` denotes in `module`. */
  readonly resolveType: (module: ModuleId, node: TypeNode) => Type;
  /**
   * The type checking resolved `node` to; undefined for one it never resolved, such as a pattern's
   * or a struct literal's type, which name a type rather than denote one. Asking reports nothing.
   */
  readonly resolvedTypeOf: (node: TypeNode) => Type | undefined;
  /** The type `match`es of aliases and associated types, resolved (§3.17). */
  readonly typeMatches: TypeMatchQueries;
  /**
   * The type `any` followed by `traits` denotes in `module` (§3.10), the traits' type arguments
   * resolved by `argumentType`, as the resolution asking resolves type nodes.
   */
  readonly anyTypeOf: (
    module: ModuleId,
    traits: readonly TypeNode[],
    argumentType: (argument: TypeNode) => Type,
  ) => Type;
  /** A struct declaration's fields, types as declared (not substituted). */
  readonly declaredFieldsOf: (declaration: DeclaredStruct) => readonly FieldMember[];
  /** An enum declaration's variants, types as declared (not substituted). */
  readonly declaredVariantsOf: (declaration: EnumDeclaration) => readonly VariantMember[];
  /** How types cross as JSON, with what meeting `Encodable` and `Decodable` asks (§9). */
  readonly json: JsonCodecs;
  /** The trait goals asked at the root of a witness search, each searched once (§3.10). */
  readonly rootGoals: RootGoals;
  /** What fitting a value where a type is expected asks of the program (§2). */
  readonly fitting: Fitting;
  /**
   * How `found` fits `expected`, by implicit conversions; undefined when nothing makes it (§2,
   * §3.14).
   */
  readonly fitOf: (found: Type, expected: Type) => Fit | undefined;
  /** The trait constraints after `is` on a type parameter, resolved where it is declared (§3.5). */
  readonly constraintsOf: (parameter: TypeParameter) => readonly Constraint[];
  /**
   * The struct constraints after `is` on a type parameter, resolved where it is declared (§3.5).
   */
  readonly structConstraintsOf: (parameter: TypeParameter) => readonly StructConstraintModel[];
  /**
   * The bound a trait's associated type requirement states (`type Key is C`, §3.10), resolved in
   * the trait's module: each trait's `Self` the associated type of the trait's own `Self`.
   */
  readonly associatedBoundsOf: (requirement: RequiredAssociatedType) => AssociatedBounds;
  /**
   * The union after `in` on a member parameter, which it stands for one member of, resolved where
   * it is declared (§3.5); undefined for any other parameter.
   */
  readonly memberUnionOf: (parameter: TypeParameter) => Type | undefined;
  /**
   * The distinct kinds what a value of `type` holds is of (§3.3; types/properties/value-kinds.ts),
   * read once per type however many signatures hold it.
   */
  readonly valueKindsOf: (type: Type) => readonly Type[];
  /**
   * The kinds the values of `type`, a type known by its constraints, may hold: those its bounds
   * allow (types/traits/data-kind.ts).
   */
  readonly boundKindsOf: (type: Type) => readonly Type[];
  /** The static functions declared on `owner` in `module` (§3.7). */
  readonly staticFunctionsIn: (
    module: ModuleId,
    owner: StaticOwner,
  ) => readonly FunctionDeclaration[];
  /** Annotations, as later phases read them and as declarations check them (§3.16). */
  readonly annotations: AnnotationChecks;
  /**
   * Notes `check`, an instantiation's in `module`: an argument meeting its parameter's constraints,
   * which may name the declaration's other parameters, or the type `match`es it reaches reducing
   * (§3.5). Types resolve while signatures are still being resolved, and either check looks at
   * signatures, so it runs once the module's declarations are checked: it is noted in the entry
   * computing now, which that module's check reads.
   */
  readonly constrainLater: (module: ModuleId, check: ConstraintCheck) => void;
}

/** A trait goal asked at the root of a witness search: `type` meeting `constraint`. */
export interface TraitGoal {
  readonly type: Type;
  readonly constraint: Constraint;
  /** Whether only calls on the type's values need it: a union's, through its members (§6). */
  readonly onValues: boolean;
}

/**
 * A struct goal asked at the root of a witness search: `type` meeting the struct constraint
 * `model`.
 */
export interface StructGoal {
  readonly type: Type;
  readonly model: StructConstraintModel;
}

/**
 * Goals asked at the root of a witness search (resolution/conformance/conformance.ts), each
 * searched once per program, since meeting is the same wherever it is asked (§3.10;
 * resolution/conformance/root-goals.ts).
 */
export interface RootGoals {
  /** The witness of every function `goal`'s trait requires; undefined after reporting why not. */
  readonly witnesses: (site: UseSite, goal: TraitGoal) => readonly ResolvedCall[] | undefined;
  /** Whether `goal` is met, reported at `site` when it isn't. */
  readonly structMet: (site: UseSite, goal: StructGoal) => boolean;
}

/** What declarations ask of annotations beyond later phases' queries (rules/annotations.ts). */
export interface AnnotationChecks extends AnnotationQueries {
  /** The title `declaration`'s `@Suite` gives its suite (§10); undefined without one. */
  readonly suiteTitleOf: (module: ModuleId, declaration: FunctionDeclaration) => string | undefined;
  /**
   * Checks the annotations of each of `fields`, declared together, and reports each field whose
   * JSON name an earlier one already has.
   */
  readonly checkFields: (fields: readonly FieldMember[]) => void;
}
