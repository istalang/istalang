/**
 * The checker of one Program: every program-wide answer, each computed once as an entry of the
 * checker's tables (structures/entries.ts), so the checker as a whole is a function of its Program
 * (check.ts keys it on that snapshot), whatever was asked of it first.
 *
 * - Checking is lazy. A function's body is checked the first time anything needs it: its module's
 *   diagnostics, lowering, or another function inferring a result from a call to it. Each entry
 *   keeps what it reported, and a module's diagnostics are read back from what its check read
 *   (declarations/module-checks.ts), so each is reported once and found by every module it is in.
 * - A function with no declared result gets the one its body produces (§2). Inferring it checks
 *   the body; a call reached while that body is being checked is the function calling itself,
 *   directly or through others, which needs a declared result: every result on the cycle stands
 *   for the error type, whichever was asked first.
 * - A top-level constant is checked the same lazy way, and one reached while it is being checked
 *   is defined through itself (§3).
 * - What one kind of declaration needs lives in a unit beside its rules, which this class composes
 *   (declarations/: constants, layouts, parameters, aliases, static functions; traits/: type
 *   parameters; rules/: expansion), as BodyChecker composes the units of a body.
 * - Items checked by their module are its top-level items and a trait's members; type parameters
 *   are noted with the module declaring them, where their constraints resolve.
 */

import type { Diagnostic } from '../../diagnostics/diagnostic.ts';
import {
  type LanguageModule,
  type WellKnownDeclaration,
  wellKnown,
} from '../../language/well-known.ts';
import { Entries } from '../../structures/entries.ts';
import { unreachable } from '../../structures/unreachable.ts';
import type { Span } from '../../text/span.ts';
import { bindProgram } from '../binder/bind.ts';
import type { Bindings, Entity } from '../binder/entities.ts';
import type { ModuleId, Program } from '../program/program.ts';
import {
  type Declaration,
  type DeclaredStruct,
  type EnumDeclaration,
  type FunctionDeclaration,
  type TypeAliasDeclaration,
  type TypeParameter,
  typeParametersOf,
} from '../syntax/declarations.ts';
import { fieldsFunctionsOf } from '../syntax/field-defaults.ts';
import type { Identifier } from '../syntax/node.ts';
import type { VariableDeclaration } from '../syntax/statements.ts';
import type { TypeNode } from '../syntax/types.ts';
import { BodyChecker, type BodyKind } from './body-checker.ts';
import type {
  CheckedBody,
  CheckedConstant,
  Disposal,
  SignatureParameter,
  VariantMember,
} from './check.ts';
import type { CheckerContext, CheckerNote, StaticOwner } from './context.ts';
import { Aliases } from './declarations/aliases.ts';
import { ConstantChecks } from './declarations/constants.ts';
import { Layouts } from './declarations/layout.ts';
import { ModuleChecks } from './declarations/module-checks.ts';
import { DeclaringModules } from './declarations/modules.ts';
import { Parameters } from './declarations/parameters.ts';
import { callResult, declaredBodyResult, writtenByReference } from './declarations/signatures.ts';
import { StaticFunctions } from './declarations/statics.ts';
import { checkerDiagnostics } from './diagnostics/index.ts';
import { Lookup } from './lookup/lookup.ts';
import { meetsAny, memberWitnesses } from './resolution/trait-objects.ts';
import { TypeParameters } from './resolution/type-parameters.ts';
import type { ResolvedCall } from './resolved-call.ts';
import { Annotations } from './rules/annotations.ts';
import { disposalOf } from './rules/disposal.ts';
import { Expansion } from './rules/expansion.ts';
import { JsonForms } from './rules/json-forms/index.ts';
import { resolveAnyType } from './traits/any-types.ts';
import { type Fit, type Fitting, fitOf, type OptionalEntity } from './types/fit.ts';
import { resolveTypeNode } from './types/resolve-type.ts';
import type { Substitution } from './types/substitution.ts';
import {
  type AnonymousStructType,
  type AnyType,
  type Constraint,
  errorType,
  type FieldMember,
  isNominalEntity,
  type NominalType,
  type Type,
  unitType,
} from './types/type.ts';
import { typeKeys } from './types/type-keys.ts';

export class ProgramChecker implements CheckerContext {
  readonly program: Program;
  readonly bindings: Bindings;
  readonly typeKeys = typeKeys;
  readonly entries = new Entries<CheckerNote>();
  readonly #declaredResults = this.entries.table<FunctionDeclaration, Type | undefined>();
  readonly #resolvedTypes = this.entries.table<TypeNode, Type>();
  /** A result inferred from a body that reaches it again needs a declared one (§2). */
  readonly #results = this.entries.table<FunctionDeclaration, Type>({
    standIn: () => errorType,
    reportMember: (member) =>
      this.report(
        this.moduleOf(member),
        checkerDiagnostics.recursiveReturnType(member.name.span, member.name.text),
      ),
  });
  readonly #bodies = this.entries.table<FunctionDeclaration, CheckedBody>();
  /** Each type's disposal, by its key: finding a declared `dispose` chooses among candidates. */
  readonly #disposals = this.entries.table<string, Disposal>();
  readonly #constants = new ConstantChecks({
    checker: this,
    moduleOfItem: (declaration) => this.#modules.itemModuleOf(declaration),
    checkConstant: (module, declaration, declaredResult) =>
      new BodyChecker(this, module, {
        kind: 'value',
        declaredResult,
      }).checkConstant(declaration),
  });
  readonly #layouts = new Layouts(this);
  readonly #parameters = new Parameters({
    checker: this,
    defaultsBody: (declaration) => {
      const body = new BodyChecker(this, this.moduleOf(declaration), {
        kind: 'value',
        declaredResult: undefined,
      });
      return {
        check: (value, declared) => body.expect(value, declared),
        declare: (node, type) =>
          body.variables.declareParameter({ node, type, reference: writtenByReference(node) }),
        checked: (values) => body.defaults(values),
      };
    },
  });
  readonly #aliases = new Aliases(this);
  readonly #statics = new StaticFunctions(this);
  readonly #typeParameters = new TypeParameters(this);
  readonly #moduleChecks = new ModuleChecks(this, {
    expansion: new Expansion(this),
    typeParameters: this.#typeParameters,
  });
  readonly annotations = new Annotations({
    checker: this,
    checkValue: (module, value) =>
      new BodyChecker(this, module, { kind: 'value', declaredResult: undefined }).checkValue(value),
  });
  readonly json = new JsonForms({ checker: this, annotations: this.annotations });
  readonly lookup = new Lookup(this);
  #optional: { entity: OptionalEntity } | undefined;

  readonly #modules: DeclaringModules;

  constructor(program: Program) {
    this.program = program;
    this.#modules = new DeclaringModules(program);
    this.bindings = bindProgram(program);
    for (const [id, module] of program.modules) {
      for (const item of module.tree.root.items) {
        if (item.kind !== 'Invalid') {
          this.#declare(item, id);
        }
      }
    }
  }

  /**
   * Notes `item` and what it declares inside (a trait's members, the functions it derives, type
   * parameters) as `module`'s.
   */
  #declare(item: Declaration, module: ModuleId): void {
    this.#modules.note(item, module);
    if ('typeParameters' in item) {
      for (const parameter of typeParametersOf(item.typeParameters)) {
        this.#typeParameters.declare(parameter, module);
      }
    }
    if (item.kind === 'TraitDeclaration') {
      for (const member of item.members) {
        if (member.kind === 'FunctionDeclaration') {
          this.#declare(member, module);
        }
      }
    }
    for (const declared of fieldsFunctionsOf(item)) {
      this.#modules.note(declared, module);
    }
  }

  report(module: ModuleId, diagnostic: Diagnostic): void {
    this.entries.note({ kind: 'diagnostic', module, diagnostic });
  }

  reportCount(): number {
    return this.entries.notesMade().filter((note) => note.kind === 'diagnostic').length;
  }

  moduleOf(declaration: Declaration | VariableDeclaration): ModuleId {
    return this.#modules.moduleOf(declaration);
  }

  /** Each type node resolves once: in its own module, it always denotes the same type. */
  resolveType(module: ModuleId, node: TypeNode): Type {
    return this.#resolvedTypes.get(node, () => resolveTypeNode(this, module, node));
  }

  resolvedTypeOf(node: TypeNode): Type | undefined {
    return this.#resolvedTypes.computed(node);
  }

  memberWitnesses(type: AnyType, constraint: number, member: Type): readonly ResolvedCall[] {
    return memberWitnesses(this, type, constraint, member);
  }

  anyTypeOf(module: ModuleId, traits: readonly TypeNode[]): Type {
    return resolveAnyType(this, module, traits);
  }

  parametersOf(declaration: FunctionDeclaration): readonly SignatureParameter[] {
    return this.#parameters.parametersOf(declaration);
  }

  defaultsOf(declaration: FunctionDeclaration): CheckedBody | undefined {
    return this.#parameters.defaultsOf(declaration);
  }

  get optionalEntity(): OptionalEntity {
    this.#optional ??= {
      entity: this.wellKnownType(wellKnown.optional)?.entity,
    };
    return this.#optional.entity;
  }

  optionalOf(type: Type): NominalType {
    const optional = this.wellKnownType(wellKnown.optional, [type]);
    if (optional === undefined) {
      unreachable('A value was wrapped into an optional in a program without a prelude.');
    }
    return optional;
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

  get fitting(): Fitting {
    return {
      optional: this.optionalEntity,
      meetsAny: (type, target) => meetsAny(this, type, target),
    };
  }

  constraintsOf(parameter: TypeParameter): readonly Constraint[] {
    return this.#typeParameters.constraintsOf(parameter);
  }

  constrainLater(
    module: ModuleId,
    at: Span,
    parameter: TypeParameter,
    typeArguments: Substitution,
  ): void {
    this.#typeParameters.constrainLater(module, at, parameter, typeArguments);
  }

  staticFunctionsIn(module: ModuleId, owner: StaticOwner): readonly FunctionDeclaration[] {
    return this.#statics.in(module, owner);
  }

  aliasedType(alias: TypeAliasDeclaration): Type {
    return this.#aliases.aliasedType(alias);
  }

  resultOf(declaration: FunctionDeclaration): Type {
    return this.#results.get(declaration, () => {
      const declared = this.#declaredBodyResult(declaration);
      const inferred = declared === undefined ? this.#checkedBody(declaration)?.result : undefined;
      return callResult(this, declaration, declared ?? inferred ?? unitType);
    });
  }

  /**
   * The checked body of a function with one; undefined for an extern. A body its result is inferred
   * from is reached through that result, so a cycle through it always reaches the result first.
   */
  bodyOf(declaration: FunctionDeclaration): CheckedBody | undefined {
    if (this.#declaredBodyResult(declaration) === undefined) {
      this.resultOf(declaration);
    }
    return this.#checkedBody(declaration);
  }

  #checkedBody(declaration: FunctionDeclaration): CheckedBody | undefined {
    const { body } = declaration;
    if (body === undefined) {
      return undefined;
    }
    return this.#bodies.get(declaration, () => {
      const kind: BodyKind = {
        kind: 'function',
        declaration,
        isAsync: declaration.isAsync,
        declaredResult: this.#declaredBodyResult(declaration),
      };
      return new BodyChecker(this, this.moduleOf(declaration), kind).checkFunction(
        body,
        this.parametersOf(declaration),
      );
    });
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
    return this.#disposals.get(this.typeKeys.typeKey(type), () => disposalOf(this, type));
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
    return this.#moduleChecks.diagnosticsOf(module);
  }

  checkItem(module: ModuleId, item: Declaration): void {
    this.#moduleChecks.checkItem(module, item);
  }

  #declaredBodyResult(declaration: FunctionDeclaration): Type | undefined {
    return this.#declaredResults.get(declaration, () =>
      declaredBodyResult(this, this.moduleOf(declaration), declaration),
    );
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
    const id = this.program.roles[module];
    return id === undefined ? undefined : this.bindings.topLevelNamed(id, name);
  }
}
