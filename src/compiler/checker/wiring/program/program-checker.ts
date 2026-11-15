/**
 * The checker of one Program: every program-wide answer, each computed once as an entry of the
 * checker's tables (foundation/structures/entries/), so the checker as a whole is a function of its
 * Program (check.ts keys it on that snapshot), whatever was asked of it first.
 *
 * - Checking is lazy. A function's body is checked the first time anything needs it: its module's
 *   diagnostics, lowering, or another function inferring a result from a call to it. Each entry
 *   keeps what it reported, and a module's diagnostics are read back from what its check read
 *   (constructs/declarations/module-checks.ts), so each is reported once and found by every module
 *   it is in.
 * - A top-level constant is checked the same lazy way, and one reached while it is being checked
 *   is defined through itself (§3).
 * - What one kind of declaration needs lives in a unit beside its rules, which this class composes
 *   (constructs/declarations/: functions, constants, layouts, parameters, aliases, static
 *   functions, type parameters; program-type-rules.ts: the type rules and fitting; rules/:
 *   expansion), as BodyChecker composes a body's units.
 * - Items checked by their module are its top-level items and a trait's members; type parameters
 *   resolve their constraints in the module declaring them (program-inputs.ts).
 * - A checker made with the checker of an earlier snapshot takes over its entries wherever what
 *   they read answers alike (foundation/structures/entries/). It reads its Program and Bindings
 *   only through inputs recorded in the entry computing now (program-inputs.ts), so nothing it
 *   answers rests on a read no entry recorded.
 */

import type { Diagnostic } from '../../../../foundation/diagnostics/diagnostic.ts';
import type {
  LanguageModule,
  WellKnownDeclaration,
} from '../../../../foundation/language/well-known/index.ts';
import { Entries, type EntryTable } from '../../../../foundation/structures/entries/index.ts';
import { unreachable } from '../../../../foundation/structures/unreachable.ts';
import { bindProgram } from '../../../binder/bind.ts';
import type { Bindings, Entity } from '../../../binder/entities.ts';
import { type ModuleId, type Program, programModule } from '../../../program/program.ts';
import type {
  AliasDeclaration,
  ContextConstantDeclaration,
  Declaration,
  DeclaredStruct,
  EnumDeclaration,
  FunctionDeclaration,
  RequiredAssociatedType,
  TypeParameter,
} from '../../../syntax/declarations/index.ts';
import type { VariableDeclaration } from '../../../syntax/statements/index.ts';
import { awaits } from '../../../syntax/tokens/modifiers.ts';
import type { Identifier, NodeOf } from '../../../syntax/tree/node.ts';
import type { AnchoredSpan } from '../../../syntax/tree/positions.ts';
import type { TypeNode } from '../../../syntax/types/index.ts';
import type {
  CheckedConstant,
  LaidOutField,
  SignatureParameter,
  TraitObjects,
  VariantMember,
} from '../../check.ts';
import { Aliases } from '../../constructs/declarations/aliases/index.ts';
import { ConstantChecks } from '../../constructs/declarations/constants.ts';
import { ContextConstantChecks } from '../../constructs/declarations/context-constants.ts';
import { FunctionChecks } from '../../constructs/declarations/functions/functions.ts';
import {
  type DefaultsBody,
  defaultsBody,
  Parameters,
} from '../../constructs/declarations/functions/parameters.ts';
import { StaticFunctions } from '../../constructs/declarations/functions/statics.ts';
import { Layouts } from '../../constructs/declarations/layout/index.ts';
import { ModuleChecks } from '../../constructs/declarations/module-checks.ts';
import { TypeParameters } from '../../constructs/declarations/type-parameters.ts';
import { declareParameter } from '../../constructs/patterns/targets.ts';
import type {
  CheckerContext,
  CheckerNote,
  ConstraintCheck,
  ProgramInputs,
  RootGoals,
} from '../../contexts/context.ts';
import { withSynthesizedNames } from '../../contexts/synthesized.ts';
import { Lookup } from '../../lookup/lookup.ts';
import { namedInModule } from '../../resolution/choosing/candidates.ts';
import { rootSearches } from '../../resolution/conformance/conformance.ts';
import { programRootGoals } from '../../resolution/conformance/root-goals.ts';
import { traitObjectsOf } from '../../resolution/conformance/trait-objects.ts';
import { Annotations } from '../../rules/annotations/index.ts';
import { JsonForms } from '../../rules/boundary/json-forms.ts';
import { Expansion } from '../../rules/expansion/functions.ts';
import { externHeldOf, keepsOf } from '../../rules/lifetimes/externs.ts';
import { Lifetimes } from '../../rules/lifetimes/lifetimes.ts';
import type { CheckedBody } from '../../surface/checked-body.ts';
import { type Fit, type Fitting, fitOf } from '../../types/fitting/fit/index.ts';
import { typeKeys } from '../../types/identity/type-keys.ts';
import { standingFor } from '../../types/inference/variables.ts';
import { sameTypeSpelled } from '../../types/parts/type-parts.ts';
import { resolveAnyType } from '../../types/traits/any-types.ts';
import { boundKindsOf } from '../../types/traits/data-kind.ts';
import { memberUnionOf } from '../../types/traits/struct-keys.ts';
import {
  type AnonymousStructType,
  type Constraint,
  type FieldMember,
  isNominalEntity,
  type NominalType,
  type Type,
} from '../../types/type/index.ts';
import type {
  AssociatedBounds,
  StructConstraintModel,
} from '../../types/type/struct-constraint.ts';
import type { TypeRules } from '../../types/type/type-rules.ts';
import { cellTypeOf } from '../../types/type/well-known.ts';
import type { StaticOwner } from '../../types/written/named-types.ts';
import { resolveTypeNode } from '../../types/written/resolve-type.ts';
import type { TypeMatchQueries } from '../../types/written/type-match.ts';
import { BodyChecker } from '../body/body-checker.ts';
import type { BodyKind } from '../body/body-kinds.ts';
import { programDisposals } from './program-disposals.ts';
import { declaringInputs, programInputs, recordedBindings } from './program-inputs.ts';
import { programKinds } from './program-kinds.ts';
import { programTypeRules } from './program-type-rules.ts';

/** What a checker is made with, beside its program. */
export interface CheckerOptions {
  /**
   * The checker of an earlier snapshot, whose entries this one takes over where what they read
   * answers alike; making this one lets go of that checker's own previous, so at most two
   * revisions' tables are held.
   */
  readonly previous?: ProgramChecker | undefined;
  /**
   * Whether no later snapshot is made from this one, as for an edit tried out and dropped: it
   * takes over from `previous` keeping that checker's own previous, which later checkers still take
   * over from.
   */
  readonly tentative?: boolean | undefined;
  /** Called each time an entry is computed rather than taken over: a seam for tests to count. */
  readonly observe?: ((table: string, key: unknown) => void) | undefined;
}

export class ProgramChecker implements CheckerContext {
  readonly program: Program;
  readonly typeKeys = typeKeys;
  readonly entries: Entries<CheckerNote>;
  readonly typeRules: TypeRules;
  readonly fitting: Fitting;
  readonly bindings: Bindings;
  readonly inputs: ProgramInputs;
  readonly moduleOf: (declaration: Declaration | VariableDeclaration | TypeParameter) => ModuleId;
  readonly isStd: (module: ModuleId | undefined) => boolean;
  /** The module whose item, or item's type parameter, `node` is; undefined for a local one. */
  readonly #itemModuleOf: (node: NodeOf<string>) => ModuleId | undefined;
  readonly #resolvedTypes: EntryTable<CheckerNote, TypeNode, Type, ModuleId>;
  readonly disposalOf: CheckerContext['disposalOf'];
  readonly disposeKindsOf: CheckerContext['disposeKindsOf'];
  readonly externHeldOf: CheckerContext['externHeldOf'] = (type) => externHeldOf(this, type);
  readonly keepsOf: CheckerContext['keepsOf'] = (declaration) => keepsOf(this, declaration);
  readonly kindOf: CheckerContext['kindOf'];
  readonly valueKindsOf: CheckerContext['valueKindsOf'];
  readonly boundKindsOf: CheckerContext['boundKindsOf'] = (type) => boundKindsOf(this, type);
  readonly #functions: FunctionChecks;
  readonly #constants: ConstantChecks;
  readonly contextConstants: ContextConstantChecks;
  readonly #layouts: Layouts;
  readonly #parameters: Parameters;
  readonly #aliases: Aliases;
  readonly #statics: StaticFunctions;
  readonly #typeParameters: TypeParameters;
  readonly #moduleChecks: ModuleChecks;
  readonly annotations: Annotations;
  readonly json: JsonForms;
  readonly traitObjects: TraitObjects;
  readonly rootGoals: RootGoals;
  readonly lookup: Lookup;
  readonly lifetimes: Lifetimes;

  constructor(program: Program, { previous, tentative = false, observe }: CheckerOptions = {}) {
    if (!tentative) {
      previous?.entries.release();
    }
    this.program = program;
    this.entries = new Entries<CheckerNote>({ previous: previous?.entries, observe });
    const bindings = bindProgram(program);
    this.bindings = withSynthesizedNames(recordedBindings(this.entries, bindings));
    this.inputs = programInputs(this.entries, program, bindings);
    const declaring = declaringInputs(this.entries, program);
    ({ moduleOf: this.moduleOf, itemModuleOf: this.#itemModuleOf, isStd: this.isStd } = declaring);
    this.#resolvedTypes = this.entries.table({
      name: 'resolved types',
      compute: (node, module) => resolveTypeNode(this, module, node),
      equal: sameTypeSpelled,
    });
    ({ disposalOf: this.disposalOf, disposeKindsOf: this.disposeKindsOf } = programDisposals(this));
    ({ kindOf: this.kindOf, valueKindsOf: this.valueKindsOf } = programKinds(this));
    this.#aliases = new Aliases(this, (alias) => this.#aliasModuleOf(alias));
    this.#layouts = new Layouts(this);
    ({ typeRules: this.typeRules, fitting: this.fitting } = programTypeRules(this, {
      layouts: this.#layouts,
    }));
    this.#functions = new FunctionChecks({
      checker: this,
      checkBody: (module, declaration, declared) => this.#checkBody(module, declaration, declared),
    });
    this.#constants = new ConstantChecks({
      checker: this,
      moduleOfItem: this.#itemModuleOf,
      checkConstant: (module, declaration, declared) =>
        this.#valueBody(module, declared).checkConstant(declaration),
    });
    this.contextConstants = new ContextConstantChecks(this, (module, declared, within) =>
      this.#valueBody(module, declared, within),
    );
    this.#parameters = new Parameters({
      checker: this,
      defaultsBody: (declaration) => this.#defaultsBody(declaration),
    });
    this.#statics = new StaticFunctions(this);
    this.#typeParameters = new TypeParameters(this, (node) =>
      node.kind === 'TypeParameter' ? declaring.moduleOf(node) : this.#itemModuleOf(node),
    );
    this.lifetimes = new Lifetimes(this);
    this.#moduleChecks = new ModuleChecks(this, {
      expansion: new Expansion(this),
      typeParameters: this.#typeParameters,
      lifetimes: this.lifetimes,
    });
    this.annotations = new Annotations({
      checker: this,
      checkValue: (module, value) => this.#valueBody(module, undefined).checkValue(value),
    });
    this.json = new JsonForms({ checker: this, annotations: this.annotations });
    this.traitObjects = traitObjectsOf(this);
    this.rootGoals = programRootGoals(this, rootSearches);
    this.lookup = new Lookup(this);
  }

  reachesDisposable(type: Type): boolean {
    return this.lifetimes.reachesDisposable(type);
  }

  /** Checks a function's body, which must produce `declaredResult` if given. */
  #checkBody(
    module: ModuleId,
    declaration: FunctionDeclaration,
    declaredResult: Type | undefined,
  ): CheckedBody {
    const isAsync = awaits(declaration.qualifiers);
    const body = this.inputs.bodyOf(module, declaration);
    if (body === undefined) {
      return unreachable('A function with no body had its body checked.');
    }
    const kind: BodyKind = { kind: 'function', declaration, isAsync, declaredResult };
    return new BodyChecker(this, module, kind).checkFunction(body, this.parametersOf(declaration));
  }

  /**
   * A body checking a value of its own: a constant's, an annotation's, or one checked `within` a
   * function, its defaults or a context constant's initializer.
   */
  #valueBody(
    module: ModuleId,
    declaredResult: Type | undefined,
    within?: FunctionDeclaration | ContextConstantDeclaration,
  ): BodyChecker {
    return new BodyChecker(this, module, { kind: 'value', declaredResult, within });
  }

  /** The body a function's parameter defaults are checked in, each seeing those before it. */
  #defaultsBody(declaration: FunctionDeclaration): DefaultsBody {
    const body = this.#valueBody(this.moduleOf(declaration), undefined, declaration);
    return defaultsBody({
      expect: (value, declared) => body.expect(value, declared),
      declare: (parameter) => declareParameter(body, parameter),
      finished: (roots) => body.defaults(roots),
    });
  }

  report(module: ModuleId, diagnostic: Diagnostic<AnchoredSpan, ModuleId>): void {
    this.entries.note({ kind: 'diagnostic', module, diagnostic });
  }

  reportCount(): number {
    return this.entries.notesMade().filter((note) => note.kind === 'diagnostic').length;
  }

  /** Each type node resolves once: in its own module, it always denotes the same type. */
  resolveType(module: ModuleId, node: TypeNode): Type {
    return this.#resolvedTypes.get(node, module);
  }

  resolvedTypeOf(node: TypeNode): Type | undefined {
    return this.#resolvedTypes.computed(node);
  }

  anyTypeOf(
    module: ModuleId,
    traits: readonly TypeNode[],
    argumentType: (argument: TypeNode) => Type,
  ): Type {
    return resolveAnyType(this, module, traits, argumentType);
  }

  parametersOf(declaration: FunctionDeclaration): readonly SignatureParameter[] {
    return this.#parameters.parametersOf(declaration);
  }

  defaultsOf(declaration: FunctionDeclaration): CheckedBody | undefined {
    return this.#parameters.defaultsOf(declaration);
  }

  readonly cellOf = (type: Type): NominalType => cellTypeOf(this, type);

  /** An arrow, so the relation can be passed around on its own (rules/agreement.ts). */
  readonly fitOf = (found: Type, expected: Type): Fit | undefined =>
    fitOf(found, expected, this.fitting);

  constraintsOf(parameter: TypeParameter): readonly Constraint[] {
    return this.#typeParameters.constraintsOf(standingFor(parameter));
  }

  structConstraintsOf(parameter: TypeParameter): readonly StructConstraintModel[] {
    return this.#typeParameters.structConstraintsOf(standingFor(parameter));
  }

  associatedBoundsOf(requirement: RequiredAssociatedType): AssociatedBounds {
    return this.#typeParameters.associatedBoundsOf(requirement);
  }

  memberUnionOf(parameter: TypeParameter): Type | undefined {
    return memberUnionOf(this, standingFor(parameter));
  }

  constrainLater(module: ModuleId, check: ConstraintCheck): void {
    this.#typeParameters.constrainLater(module, check);
  }

  staticFunctionsIn(module: ModuleId, owner: StaticOwner): readonly FunctionDeclaration[] {
    return this.#statics.in(module, owner);
  }

  /** The module writing `alias`, where its type resolves: an associated type's item's. */
  #aliasModuleOf(alias: AliasDeclaration): ModuleId {
    return alias.kind === 'TypeAliasDeclaration'
      ? this.moduleOf(alias)
      : (this.#itemModuleOf(alias) ?? unreachable("An associated type is an item's part."));
  }

  get typeMatches(): TypeMatchQueries {
    return this.#aliases;
  }

  aliasedType(alias: AliasDeclaration): Type {
    return this.#aliases.aliasedType(alias);
  }

  resultOf(declaration: FunctionDeclaration): Type {
    return this.#functions.resultOf(declaration);
  }

  bodyOf(declaration: FunctionDeclaration): CheckedBody | undefined {
    return this.#functions.bodyOf(declaration);
  }

  constantOf(declaration: VariableDeclaration): CheckedConstant | undefined {
    return this.#constants.constantOf(declaration);
  }

  constantBodyOf(declaration: VariableDeclaration): CheckedBody | undefined {
    return this.#constants.bodyOf(declaration);
  }

  constantNamed(module: ModuleId, name: Identifier): CheckedConstant | undefined {
    return this.#constants.constantNamed(module, name);
  }

  fieldsOf(type: Type): readonly FieldMember[] | undefined {
    return this.#layouts.fieldsOf(type);
  }

  fieldNamed(type: Type, name: string): LaidOutField | undefined {
    return this.#layouts.fieldNamed(type, name);
  }

  variantsOf(type: NominalType): readonly VariantMember[] | undefined {
    return this.#layouts.variantsOf(type);
  }

  sharedValueOf(type: Type): AnonymousStructType | undefined {
    return this.#layouts.sharedValueOf(type);
  }

  declaredFieldsOf(declaration: DeclaredStruct): readonly FieldMember[] {
    return this.#layouts.declaredFieldsOf(declaration);
  }

  declaredVariantsOf(declaration: EnumDeclaration): readonly VariantMember[] {
    return this.#layouts.declaredVariantsOf(declaration);
  }

  languageFunctions(module: LanguageModule, name: string): readonly FunctionDeclaration[] {
    const id = this.inputs.role(module);
    return id === undefined ? [] : this.topLevelFunctions(id, name);
  }

  topLevelFunctions(module: ModuleId, name: string): readonly FunctionDeclaration[] {
    return namedInModule(this, module, name);
  }

  diagnosticsOf(module: ModuleId) {
    return this.#moduleChecks.diagnosticsOf(module, (id) => programModule(this.program, id).tree);
  }

  checkItem(module: ModuleId, item: Declaration): void {
    this.#moduleChecks.checkItem(module, item);
  }

  /**
   * What language module `module` declares as `name`, when the program has that module: what it
   * exports, or a private name the toolchain itself uses, such as a json helper a codec calls.
   */
  wellKnownEntity({ module, name }: WellKnownDeclaration): Entity | undefined {
    const id = this.inputs.role(module);
    return id === undefined ? undefined : this.bindings.topLevelNamed(id, name);
  }

  wellKnownType(
    declaration: WellKnownDeclaration,
    typeArguments: readonly Type[] = [],
  ): NominalType | undefined {
    const entity = this.wellKnownEntity(declaration);
    return entity?.kind === 'type' && isNominalEntity(entity)
      ? { kind: 'nominal', entity, arguments: typeArguments }
      : undefined;
  }
}
