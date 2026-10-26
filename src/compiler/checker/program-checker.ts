/**
 * The checker of one Program: every program-wide answer, each computed once and memoized here, so
 * the checker as a whole is a memoized function of its Program (check.ts keys it on that
 * snapshot).
 *
 * - Checking is lazy. A function's body is checked the first time anything needs it: its module's
 *   diagnostics, lowering, or another function inferring a result from a call to it. Each piece
 *   is computed once, so each diagnostic is reported once, by whoever asks first.
 * - A function with no declared result gets the one its body produces (§2). Inferring it checks
 *   the body; a call reached while that body is being checked is the function calling itself,
 *   directly or through others, which needs a declared result.
 * - A top-level constant is checked the same lazy way, and one reached while it is being checked
 *   is defined through itself (§3). Both use one lazy check with cycle reporting (lazy-checks.ts).
 * - What one kind of declaration needs lives in a unit beside its rules, which this class composes
 *   (declarations/: constants, layouts, parameters, aliases, static functions; traits/: type
 *   parameters; rules/: expansion), as BodyChecker composes the units of a body.
 * - Items checked by their module are its top-level items and a trait's members; type parameters
 *   are noted with the module declaring them, where their constraints resolve.
 * - Diagnostics are kept per module, in the order found; the coordinator sorts them.
 */

import type { Diagnostic } from '../../diagnostics/diagnostic.ts';
import {
  type LanguageModule,
  type WellKnownDeclaration,
  wellKnown,
} from '../../language/well-known.ts';
import { memo } from '../../structures/memo.ts';
import { unreachable } from '../../structures/unreachable.ts';
import type { Span } from '../../text/span.ts';
import { bindProgram } from '../binder/bind.ts';
import type { Bindings, Entity } from '../binder/entities.ts';
import type { ModuleId, Program } from '../program/program.ts';
import type {
  Declaration,
  EnumDeclaration,
  FunctionDeclaration,
  StructDeclaration,
  TypeAliasDeclaration,
  TypeParameter,
} from '../syntax/declarations.ts';
import type { Identifier, NodeOf } from '../syntax/node.ts';
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
import type { CheckerContext, StaticOwner } from './context.ts';
import { Aliases } from './declarations/aliases.ts';
import { ConstantChecks } from './declarations/constants.ts';
import { checkDeclaration } from './declarations/declarations.ts';
import { Layouts } from './declarations/layout.ts';
import { Parameters } from './declarations/parameters.ts';
import { resolveTypeNode, typeParametersOf } from './declarations/resolve-type.ts';
import { callResult, declaredBodyResult, writtenByReference } from './declarations/signatures.ts';
import { StaticFunctions } from './declarations/statics.ts';
import { checkerDiagnostics } from './diagnostics/index.ts';
import type { FrontierConstruct } from './frontier.ts';
import { LazyChecks } from './lazy-checks.ts';
import { Annotations } from './rules/annotations.ts';
import { checkClashes } from './rules/clashes.ts';
import { disposalOf } from './rules/disposal.ts';
import { Expansion } from './rules/expansion.ts';
import { JsonForms } from './rules/json-forms/index.ts';
import type { Constraint } from './traits/constraints.ts';
import { TypeParameters } from './traits/type-parameters.ts';
import { type OptionalEntity, wrapsToFit } from './types/fit.ts';
import {
  errorType,
  type FieldMember,
  isNominalEntity,
  type NominalType,
  type Substitution,
  type Type,
  unitType,
} from './types/type.ts';
import { TypeKeys } from './types/type-keys.ts';
import { notSupported } from './unsupported.ts';

export class ProgramChecker implements CheckerContext {
  readonly program: Program;
  readonly bindings: Bindings;
  readonly typeKeys = new TypeKeys();
  /** Every module's top-level items, with the module declaring each. */
  readonly #modules = new Map<NodeOf<string>, ModuleId>();
  readonly #diagnostics = new Map<ModuleId, Diagnostic[]>();
  readonly #declaredResults = new Map<FunctionDeclaration, Type | undefined>();
  readonly #resolvedTypes = new Map<TypeNode, Type>();
  readonly #results = new Map<FunctionDeclaration, Type>();
  /** Each type's disposal, by its key: finding a declared `dispose` chooses among candidates. */
  readonly #disposals = new Map<string, Disposal>();
  readonly #bodies = new LazyChecks<FunctionDeclaration, CheckedBody>((member) => {
    this.report(
      this.moduleOf(member),
      checkerDiagnostics.recursiveReturnType(member.name.span, member.name.text),
    );
  });
  readonly #constants = new ConstantChecks({
    checker: this,
    moduleOfItem: (declaration) => this.#modules.get(declaration),
    checkValue: (module, initializer, declaredResult) =>
      new BodyChecker(this, module, {
        kind: 'value',
        declaredResult,
      }).checkValue(initializer),
  });
  readonly #checkedModules = new Set<ModuleId>();
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
        checked: () => body.defaults(),
      };
    },
  });
  readonly #aliases = new Aliases(this);
  readonly #statics = new StaticFunctions(this);
  readonly #typeParameters = new TypeParameters(this);
  readonly #expansion = new Expansion(this);
  readonly annotations = new Annotations({
    checker: this,
    checkValue: (module, value) =>
      new BodyChecker(this, module, { kind: 'value', declaredResult: undefined }).checkValue(value),
  });
  readonly json = new JsonForms({ checker: this, annotations: this.annotations });
  #optional: { entity: OptionalEntity } | undefined;

  constructor(program: Program) {
    this.program = program;
    this.bindings = bindProgram(program);
    for (const [id, module] of program.modules) {
      for (const item of module.tree.root.items) {
        if (item.kind !== 'Invalid') {
          this.#declare(item, id);
        }
      }
    }
  }

  /** Notes `item` and what it declares inside (a trait's members, type parameters) as `module`'s. */
  #declare(item: Declaration, module: ModuleId): void {
    this.#modules.set(item, module);
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
  }

  report(module: ModuleId, diagnostic: Diagnostic): void {
    const diagnostics = this.#diagnostics.get(module) ?? [];
    diagnostics.push(diagnostic);
    this.#diagnostics.set(module, diagnostics);
  }

  unsupported(module: ModuleId, node: NodeOf<string>, construct?: FrontierConstruct): Type {
    this.report(module, notSupported(node, construct));
    return errorType;
  }

  moduleOf(declaration: Declaration | VariableDeclaration): ModuleId {
    const module = this.#modules.get(declaration);
    if (module === undefined) {
      unreachable(`No module declares ${declaration.kind} at ${declaration.span.start}.`);
    }
    return module;
  }

  /** Each type node resolves once: in its own module, it always denotes the same type. */
  resolveType(module: ModuleId, node: TypeNode): Type {
    return memo(this.#resolvedTypes, node, () => resolveTypeNode(this, module, node));
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

  sharedOf(type: Type): NominalType {
    const shared = this.wellKnownType(wellKnown.shared, [type]);
    if (shared === undefined) {
      unreachable(
        "A variable needs a cell (passed by '&' or shared with a closure) in a program without a prelude.",
      );
    }
    return shared;
  }

  /** An arrow, so the relation can be passed around on its own (rules/agreement.ts). */
  readonly wrapsToFit = (found: Type, expected: Type): number | undefined =>
    wrapsToFit(found, expected, this.optionalEntity);

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
    const declared = this.#declaredBodyResult(declaration);
    if (
      declared === undefined &&
      !this.#results.has(declaration) &&
      this.#bodies.inCycle(declaration)
    ) {
      return errorType;
    }
    return memo(this.#results, declaration, () =>
      callResult(this, declaration, declared ?? this.bodyOf(declaration)?.result ?? unitType),
    );
  }

  /** The checked body of a function with one; undefined for an extern. */
  bodyOf(declaration: FunctionDeclaration): CheckedBody | undefined {
    const { body } = declaration;
    if (body === undefined) {
      return undefined;
    }
    return this.#bodies.resultOf(declaration, () => {
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

  disposalOf(type: NominalType): Disposal {
    return memo(this.#disposals, this.typeKeys.typeKey(type), () => disposalOf(this, type));
  }

  declaredFieldsOf(declaration: StructDeclaration): readonly FieldMember[] {
    return this.#layouts.declaredFieldsOf(declaration);
  }

  declaredVariantsOf(declaration: EnumDeclaration): readonly VariantMember[] {
    return this.#layouts.declaredVariantsOf(declaration);
  }

  languageFunctions(module: LanguageModule, name: string): readonly FunctionDeclaration[] {
    const entity = this.#languageDeclaration(module, name);
    return entity?.kind === 'functions' ? this.bindings.overloadsOf(entity) : [];
  }

  /** Every diagnostic of `module`, after checking all of its declarations. */
  diagnosticsOf(module: ModuleId): readonly Diagnostic[] {
    if (!this.#checkedModules.has(module)) {
      this.#checkedModules.add(module);
      const items = this.program.modules.get(module)?.tree.root.items ?? [];
      for (const item of items) {
        if (item.kind !== 'Invalid') {
          checkDeclaration(this, module, item);
        }
      }
      checkClashes(this, module);
      this.#typeParameters.checkPending(module);
      this.#expansion.check(module);
    }
    return this.#diagnostics.get(module) ?? [];
  }

  #declaredBodyResult(declaration: FunctionDeclaration): Type | undefined {
    return memo(this.#declaredResults, declaration, () =>
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
   * exports, or a private name the toolchain itself uses, such as the extern writing a trace.
   */
  #languageDeclaration(module: LanguageModule, name: string) {
    const id = this.program.roles[module];
    return id === undefined ? undefined : this.bindings.topLevelNamed(id, name);
  }
}
