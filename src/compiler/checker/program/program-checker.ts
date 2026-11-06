/**
 * The checker of one Program: every program-wide answer, each computed once as an entry of the
 * checker's tables (structures/entries/), so the checker as a whole is a function of its Program
 * (check.ts keys it on that snapshot), whatever was asked of it first.
 *
 * - Checking is lazy. A function's body is checked the first time anything needs it: its module's
 *   diagnostics, lowering, or another function inferring a result from a call to it. Each entry
 *   keeps what it reported, and a module's diagnostics are read back from what its check read
 *   (declarations/module-checks.ts), so each is reported once and found by every module it is in.
 * - A top-level constant is checked the same lazy way, and one reached while it is being checked
 *   is defined through itself (§3).
 * - What one kind of declaration needs lives in a unit beside its rules, which this class composes
 *   (declarations/: functions, constants, layouts, parameters, aliases, static functions;
 *   resolution/: type parameters, the type rules and fitting; rules/: expansion), as BodyChecker
 *   composes a body's units.
 * - Items checked by their module are its top-level items and a trait's members; type parameters
 *   resolve their constraints in the module declaring them (program-inputs.ts).
 * - A checker made with the checker of an earlier snapshot takes over its entries wherever what
 *   they read answers alike (structures/entries/). It reads its Program and Bindings only through
 *   inputs recorded in the entry computing now (program-inputs.ts), so nothing it answers rests on
 *   a read no entry recorded.
 */

import type { Diagnostic } from '../../../diagnostics/diagnostic.ts';
import {
  type LanguageModule,
  type WellKnownDeclaration,
  wellKnown,
} from '../../../language/well-known.ts';
import { Entries, type EntryTable } from '../../../structures/entries/index.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import { bindProgram } from '../../binder/bind.ts';
import type { Bindings, Entity } from '../../binder/entities.ts';
import { type ModuleId, type Program, programModule } from '../../program/program.ts';
import type {
  AliasDeclaration,
  Declaration,
  DeclaredStruct,
  EnumDeclaration,
  FunctionDeclaration,
  RequiredAssociatedType,
  TypeAliasDeclaration,
  TypeParameter,
} from '../../syntax/declarations.ts';
import type { Identifier, NodeOf } from '../../syntax/node.ts';
import type { AnchoredSpan } from '../../syntax/positions.ts';
import type { VariableDeclaration } from '../../syntax/statements.ts';
import type { TypeNode } from '../../syntax/types.ts';
import { BodyChecker, type BodyKind } from '../body/body-checker.ts';
import type { CheckedConstant, Disposal, SignatureParameter, VariantMember } from '../check.ts';
import type {
  CheckerContext,
  CheckerNote,
  ConstraintCheck,
  ProgramInputs,
  RootGoals,
} from '../context.ts';
import { Aliases } from '../declarations/aliases.ts';
import { ConstantChecks } from '../declarations/constants.ts';
import { FunctionChecks } from '../declarations/functions.ts';
import { Layouts } from '../declarations/layout.ts';
import { ModuleChecks } from '../declarations/module-checks.ts';
import { type DefaultsBody, Parameters } from '../declarations/parameters.ts';
import { writtenByReference } from '../declarations/signatures.ts';
import { StaticFunctions } from '../declarations/statics.ts';
import { Lookup } from '../lookup/lookup.ts';
import { declareParameter } from '../patterns/targets.ts';
import { rootSearches } from '../resolution/conformance/conformance.ts';
import { programRootGoals } from '../resolution/conformance/root-goals.ts';
import { memberWitnesses } from '../resolution/conformance/trait-objects.ts';
import { programTypeRules } from '../resolution/program-type-rules.ts';
import { TypeParameters } from '../resolution/type-parameters.ts';
import { Annotations } from '../rules/annotations.ts';
import { JsonForms } from '../rules/boundary/json-forms.ts';
import { disposalOf } from '../rules/disposal/disposal.ts';
import { Expansion } from '../rules/expansion/functions.ts';
import type { CheckedBody } from '../surface/checked-body.ts';
import type { ResolvedCall } from '../surface/resolved-call.ts';
import { resolveAnyType } from '../traits/any-types.ts';
import { memberUnionOf } from '../traits/struct-keys.ts';
import { type Fit, type Fitting, fitOf } from '../types/fitting/fit.ts';
import { typeKeys } from '../types/identity/type-keys.ts';
import { sameTypeSpelled, unaliased } from '../types/parts/type-parts.ts';
import type { ConstraintSet, StructConstraintModel } from '../types/struct-constraint.ts';
import {
  type AnonymousStructType,
  type AnyType,
  type Constraint,
  type FieldMember,
  isNominalEntity,
  type NominalType,
  type Type,
} from '../types/type/index.ts';
import type { TypeRules } from '../types/type-rules.ts';
import type { StaticOwner } from '../types/written/named-types.ts';
import { resolveTypeNode } from '../types/written/resolve-type.ts';
import type { TypeMatchQueries } from '../types/written/type-match.ts';
import { declaringInputs, programInputs, recordedBindings } from './program-inputs.ts';

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
  /** Each type's disposal, by its key: finding a declared `dispose` chooses among candidates. */
  readonly #disposals: EntryTable<CheckerNote, string, Disposal, NominalType>;
  readonly #functions: FunctionChecks;
  readonly #constants: ConstantChecks;
  readonly #layouts: Layouts;
  readonly #parameters: Parameters;
  readonly #aliases: Aliases;
  readonly #statics: StaticFunctions;
  readonly #typeParameters: TypeParameters;
  readonly #moduleChecks: ModuleChecks;
  readonly annotations: Annotations;
  readonly json: JsonForms;
  readonly rootGoals: RootGoals;
  readonly lookup: Lookup;

  constructor(program: Program, { previous, tentative = false, observe }: CheckerOptions = {}) {
    if (!tentative) {
      previous?.entries.release();
    }
    this.program = program;
    const entries = new Entries<CheckerNote>({ previous: previous?.entries, observe });
    this.entries = entries;
    const bindings = bindProgram(program);
    this.bindings = recordedBindings(entries, bindings);
    this.inputs = programInputs(entries, program, bindings);
    const declaring = declaringInputs(entries, program);
    this.moduleOf = declaring.moduleOf;
    this.#itemModuleOf = declaring.itemModuleOf;
    this.isStd = declaring.isStd;
    this.#resolvedTypes = entries.table({
      name: 'resolved types',
      compute: (node, module) => resolveTypeNode(this, module, node),
      equal: sameTypeSpelled,
    });
    this.#disposals = entries.table({
      name: 'disposals',
      compute: (_key, type) => disposalOf(this, type),
      equal: sameDisposal,
    });
    this.#aliases = new Aliases(this, (alias) => this.#aliasModuleOf(alias));
    this.#layouts = new Layouts(this);
    const rules = programTypeRules(this, { layouts: this.#layouts });
    this.typeRules = rules.typeRules;
    this.fitting = rules.fitting;
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
    this.#parameters = new Parameters({
      checker: this,
      defaultsBody: (declaration) => this.#defaultsBody(declaration),
    });
    this.#statics = new StaticFunctions(this);
    this.#typeParameters = new TypeParameters(this, (node) =>
      node.kind === 'TypeParameter' ? declaring.moduleOf(node) : this.#itemModuleOf(node),
    );
    this.#moduleChecks = new ModuleChecks(this, {
      expansion: new Expansion(this),
      typeParameters: this.#typeParameters,
    });
    this.annotations = new Annotations({
      checker: this,
      checkValue: (module, value) => this.#valueBody(module, undefined).checkValue(value),
    });
    this.json = new JsonForms({ checker: this, annotations: this.annotations });
    this.rootGoals = programRootGoals(this, rootSearches);
    this.lookup = new Lookup(this);
  }

  /** Checks a function's body, which must produce `declaredResult` if given. */
  #checkBody(
    module: ModuleId,
    declaration: FunctionDeclaration,
    declaredResult: Type | undefined,
  ): CheckedBody {
    const { isAsync } = declaration;
    const body = this.inputs.bodyOf(module, declaration);
    if (body === undefined) {
      return unreachable('A function with no body had its body checked.');
    }
    const kind: BodyKind = { kind: 'function', declaration, isAsync, declaredResult };
    return new BodyChecker(this, module, kind).checkFunction(body, this.parametersOf(declaration));
  }

  /** A body checking a value of its own in `module`: a constant's, an annotation's. */
  #valueBody(module: ModuleId, declaredResult: Type | undefined): BodyChecker {
    return new BodyChecker(this, module, { kind: 'value', declaredResult });
  }

  /** The body a function's parameter defaults are checked in, each seeing those before it. */
  #defaultsBody(declaration: FunctionDeclaration): DefaultsBody {
    const body = this.#valueBody(this.moduleOf(declaration), undefined);
    return {
      check: (value, declared) => body.expect(value, declared),
      declare: (node, type) =>
        declareParameter(body, { node, type, reference: writtenByReference(node) }),
      checked: (values) => body.defaults(values),
    };
  }

  report(module: ModuleId, diagnostic: Diagnostic<AnchoredSpan>): void {
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

  memberWitnesses(type: AnyType, constraint: number, member: Type): readonly ResolvedCall[] {
    return memberWitnesses(this, type, constraint, member);
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

  cellOf(type: Type): NominalType {
    const cell = this.wellKnownType(wellKnown.cell, [type]);
    if (cell === undefined) {
      unreachable(
        "A variable needs a cell (passed by '&' or shared with a closure) in a program without a prelude.",
      );
    }
    return cell;
  }

  /** An arrow, so the relation can be passed around on its own (rules/agreement.ts). */
  readonly fitOf = (found: Type, expected: Type): Fit | undefined =>
    fitOf(found, expected, this.fitting);

  constraintsOf(parameter: TypeParameter): readonly Constraint[] {
    return this.#typeParameters.constraintsOf(parameter);
  }

  structConstraintsOf(parameter: TypeParameter): readonly StructConstraintModel[] {
    return this.#typeParameters.structConstraintsOf(parameter);
  }

  associatedBoundsOf(requirement: RequiredAssociatedType): ConstraintSet {
    return this.#typeParameters.associatedBoundsOf(requirement);
  }

  memberUnionOf(parameter: TypeParameter): Type | undefined {
    return memberUnionOf(this, parameter);
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

  aliasArgumentsFor(alias: TypeAliasDeclaration, type: Type): readonly Type[] | undefined {
    return this.#aliases.argumentsFor(alias, type);
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

  variantsOf(type: NominalType): readonly VariantMember[] | undefined {
    return this.#layouts.variantsOf(type);
  }

  sharedValueOf(type: Type): AnonymousStructType | undefined {
    return this.#layouts.sharedValueOf(type);
  }

  disposalOf(type: NominalType): Disposal {
    const unspelled = unaliased(type);
    return this.#disposals.get(this.typeKeys.spelledKey(unspelled), unspelled);
  }

  declaredFieldsOf(declaration: DeclaredStruct): readonly FieldMember[] {
    return this.#layouts.declaredFieldsOf(declaration);
  }

  declaredVariantsOf(declaration: EnumDeclaration): readonly VariantMember[] {
    return this.#layouts.declaredVariantsOf(declaration);
  }

  languageFunctions(module: LanguageModule, name: string): readonly FunctionDeclaration[] {
    const entity = this.#languageDeclaration(module, name);
    return entity?.kind === 'functions' ? this.bindings.overloadsOf(entity) : [];
  }

  diagnosticsOf(module: ModuleId): readonly Diagnostic[] {
    return this.#moduleChecks.diagnosticsOf(module, programModule(this.program, module).tree);
  }

  checkItem(module: ModuleId, item: Declaration): void {
    this.#moduleChecks.checkItem(module, item);
  }

  wellKnownEntity({ module, name }: WellKnownDeclaration): Entity | undefined {
    return this.#languageDeclaration(module, name);
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

  /**
   * What language module `module` declares as `name`, when the program has that module: what it
   * exports, or a private name the toolchain itself uses, such as a json helper a codec calls.
   */
  #languageDeclaration(module: LanguageModule, name: string) {
    const id = this.inputs.role(module);
    return id === undefined ? undefined : this.bindings.topLevelNamed(id, name);
  }
}

/** Whether two disposals are alike: a declared `dispose`'s by its call, the others by kind. */
function sameDisposal(first: Disposal, second: Disposal): boolean {
  return first === second || (first.kind !== 'function' && first.kind === second.kind);
}
