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
 *   (declarations/constants.ts), as BodyChecker composes the units of a body.
 * - Diagnostics are kept per module, in the order found; the coordinator sorts them.
 */

import type { Diagnostic } from '../../diagnostics/diagnostic.ts';
import type { LanguageModule, WellKnownDeclaration } from '../../language/well-known.ts';
import { memo } from '../../structures/memo.ts';
import { bindProgram } from '../binder/bind.ts';
import type { Bindings } from '../binder/entities.ts';
import type { ModuleId, Program } from '../program/program.ts';
import type {
  Declaration,
  EnumDeclaration,
  FunctionDeclaration,
  StructDeclaration,
} from '../syntax/declarations.ts';
import type { Identifier, NodeOf } from '../syntax/node.ts';
import type { VariableDeclaration } from '../syntax/statements.ts';
import type { TypeNode } from '../syntax/types.ts';
import { BodyChecker } from './body-checker.ts';
import type {
  CheckedBody,
  CheckedConstant,
  Disposal,
  FieldMember,
  SignatureParameter,
  VariantMember,
} from './check.ts';
import type { CheckerContext } from './context.ts';
import { ConstantChecks } from './declarations/constants.ts';
import { checkDeclaration } from './declarations/declarations.ts';
import { Layouts } from './declarations/layout.ts';
import { resolveTypeNode } from './declarations/resolve-type.ts';
import { callResult, declaredBodyResult, declaredParameters } from './declarations/signatures.ts';
import { checkerDiagnostics } from './diagnostics.ts';
import type { FrontierConstruct } from './frontier.ts';
import { LazyChecks } from './lazy-checks.ts';
import { disposalOf } from './rules/disposal.ts';
import { errorType, type NominalType, type Type, unitType } from './types/type.ts';
import { notSupported } from './unsupported.ts';

export class ProgramChecker implements CheckerContext {
  readonly program: Program;
  readonly bindings: Bindings;
  /** Every module's top-level items, with the module declaring each. */
  readonly #modules = new Map<NodeOf<string>, ModuleId>();
  readonly #diagnostics = new Map<ModuleId, Diagnostic[]>();
  readonly #parameters = new Map<FunctionDeclaration, readonly SignatureParameter[]>();
  readonly #declaredResults = new Map<FunctionDeclaration, Type | undefined>();
  readonly #results = new Map<FunctionDeclaration, Type>();
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
      new BodyChecker(this, module, { isAsync: false, declaredResult }).checkValue(initializer),
  });
  readonly #checkedModules = new Set<ModuleId>();
  readonly #layouts = new Layouts(this);

  constructor(program: Program) {
    this.program = program;
    this.bindings = bindProgram(program);
    for (const [id, module] of program.modules) {
      for (const item of module.tree.root.items) {
        if (item.kind !== 'Invalid') {
          this.#modules.set(item, id);
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

  moduleOf(declaration: Declaration): ModuleId {
    const module = this.#modules.get(declaration);
    if (module === undefined) {
      throw new Error(`No module declares ${declaration.kind} at ${declaration.span.start}.`);
    }
    return module;
  }

  resolveType(module: ModuleId, node: TypeNode): Type {
    return resolveTypeNode(this, module, node);
  }

  parametersOf(declaration: FunctionDeclaration): readonly SignatureParameter[] {
    return memo(this.#parameters, declaration, () =>
      declaredParameters(this, this.moduleOf(declaration), declaration),
    );
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
      const kind = {
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

  constantNamed(module: ModuleId, name: Identifier): CheckedConstant | undefined {
    return this.#constants.constantNamed(module, name);
  }

  fieldsOf(type: NominalType): readonly FieldMember[] | undefined {
    return this.#layouts.fieldsOf(type);
  }

  variantsOf(type: NominalType): readonly VariantMember[] | undefined {
    return this.#layouts.variantsOf(type);
  }

  disposalOf(type: NominalType): Disposal {
    return disposalOf(this, type);
  }

  declaredFieldsOf(declaration: StructDeclaration): readonly FieldMember[] {
    return this.#layouts.declaredFieldsOf(declaration);
  }

  declaredVariantsOf(declaration: EnumDeclaration): readonly VariantMember[] {
    return this.#layouts.declaredVariantsOf(declaration);
  }

  preludeFunctions(name: string): readonly FunctionDeclaration[] {
    const entity = this.#languageExport('prelude', name);
    return entity?.kind === 'functions' ? this.bindings.overloadsOf(entity) : [];
  }

  /** Every diagnostic of `module`, after checking all of its declarations. */
  diagnosticsOf(module: ModuleId): readonly Diagnostic[] {
    if (!this.#checkedModules.has(module)) {
      this.#checkedModules.add(module);
      for (const item of this.program.modules.get(module)?.tree.root.items ?? []) {
        if (item.kind !== 'Invalid') {
          checkDeclaration(this, module, item);
        }
      }
    }
    return this.#diagnostics.get(module) ?? [];
  }

  #declaredBodyResult(declaration: FunctionDeclaration): Type | undefined {
    return memo(this.#declaredResults, declaration, () =>
      declaredBodyResult(this, this.moduleOf(declaration), declaration),
    );
  }

  wellKnownType(
    { module, name }: WellKnownDeclaration,
    typeArguments: readonly Type[] = [],
  ): Type | undefined {
    const entity = this.#languageExport(module, name);
    return entity?.kind === 'type'
      ? { kind: 'nominal', entity: entity as NominalType['entity'], arguments: typeArguments }
      : undefined;
  }

  /** What language module `module` exports as `name`, when the program has that module. */
  #languageExport(module: LanguageModule, name: string) {
    const id = this.program.roles[module];
    return id === undefined ? undefined : this.bindings.exportsOf(id).get(name);
  }
}
