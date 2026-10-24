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
 * - Diagnostics are kept per module, in the order found; the coordinator sorts them.
 */

import type { Diagnostic } from '../../diagnostics/diagnostic.ts';
import { bindProgram } from '../binder/bind.ts';
import type { Bindings } from '../binder/entities.ts';
import type { ModuleId, Program } from '../program/program.ts';
import type {
  Declaration,
  EnumDeclaration,
  FunctionDeclaration,
  StructDeclaration,
} from '../syntax/declarations.ts';
import type { NodeOf } from '../syntax/node.ts';
import type { TypeNode } from '../syntax/types.ts';
import { BodyChecker } from './body-checker.ts';
import type { CheckedBody, FieldMember, SignatureParameter, VariantMember } from './check.ts';
import type { CheckerContext } from './context.ts';
import { checkDeclaration } from './declarations/declarations.ts';
import { resolveTypeNode } from './declarations/resolve-type.ts';
import {
  callResult,
  declaredBodyResult,
  declaredFields,
  declaredParameters,
} from './declarations/signatures.ts';
import { checkerDiagnostics } from './diagnostics.ts';
import {
  errorType,
  type NominalType,
  type Substitution,
  substitute,
  type Type,
  unitType,
} from './types/type.ts';
import { notSupported } from './unsupported.ts';

export class ProgramChecker implements CheckerContext {
  readonly program: Program;
  readonly bindings: Bindings;
  readonly #modules = new Map<Declaration, ModuleId>();
  readonly #diagnostics = new Map<ModuleId, Diagnostic[]>();
  readonly #parameters = new Map<FunctionDeclaration, readonly SignatureParameter[]>();
  readonly #declaredResults = new Map<FunctionDeclaration, Type | undefined>();
  readonly #results = new Map<FunctionDeclaration, Type>();
  readonly #bodies = new Map<FunctionDeclaration, CheckedBody>();
  readonly #fields = new Map<StructDeclaration, readonly FieldMember[]>();
  readonly #checkedModules = new Set<ModuleId>();
  readonly #variants = new Map<EnumDeclaration, readonly VariantMember[]>();
  /** The functions whose bodies are being checked right now, innermost last. */
  readonly #checking: FunctionDeclaration[] = [];
  readonly #reportedRecursive = new Set<FunctionDeclaration>();

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

  unsupported(module: ModuleId, node: NodeOf<string>, construct?: string): Type {
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
    return memoized(this.#parameters, declaration, () =>
      declaredParameters(this, this.moduleOf(declaration), declaration),
    );
  }

  resultOf(declaration: FunctionDeclaration): Type {
    const known = this.#results.get(declaration);
    if (known !== undefined) {
      return known;
    }
    const declared = this.#declaredBodyResult(declaration);
    const cycleStart = this.#checking.indexOf(declaration);
    if (declared === undefined && cycleStart >= 0) {
      this.#reportRecursion(this.#checking.slice(cycleStart));
      return errorType;
    }
    const bodyResult = declared ?? this.bodyOf(declaration)?.result ?? unitType;
    const result = callResult(this, declaration, bodyResult);
    this.#results.set(declaration, result);
    return result;
  }

  /** The checked body of a function with one; undefined for an extern. */
  bodyOf(declaration: FunctionDeclaration): CheckedBody | undefined {
    const { body } = declaration;
    if (body === undefined) {
      return undefined;
    }
    return memoized(this.#bodies, declaration, () => {
      this.#checking.push(declaration);
      try {
        return new BodyChecker(this, this.moduleOf(declaration), body).check(
          this.parametersOf(declaration),
          this.#declaredBodyResult(declaration),
        );
      } finally {
        this.#checking.pop();
      }
    });
  }

  fieldsOf(type: NominalType): readonly FieldMember[] | undefined {
    const { declaration } = type.entity;
    if (declaration.kind !== 'StructDeclaration') {
      return undefined;
    }
    return instantiateFields(this.declaredFieldsOf(declaration), substitutionOf(type));
  }

  variantsOf(type: NominalType): readonly VariantMember[] | undefined {
    const { declaration } = type.entity;
    if (declaration.kind !== 'EnumDeclaration') {
      return undefined;
    }
    const substitution = substitutionOf(type);
    return this.declaredVariantsOf(declaration).map((variant) => ({
      name: variant.name,
      fields: instantiateFields(variant.fields, substitution),
    }));
  }

  declaredFieldsOf(declaration: StructDeclaration): readonly FieldMember[] {
    return memoized(this.#fields, declaration, () =>
      declaredFields(this, declaration, declaration.fields),
    );
  }

  declaredVariantsOf(declaration: EnumDeclaration): readonly VariantMember[] {
    return memoized(this.#variants, declaration, () =>
      declaration.variants.flatMap((variant) =>
        variant.kind === 'Variant'
          ? [{ name: variant.name.text, fields: declaredFields(this, declaration, variant.fields) }]
          : [],
      ),
    );
  }

  preludeType(name: string, typeArguments: readonly Type[]): Type {
    const entity = this.#preludeExport(name);
    if (entity?.kind !== 'type') {
      return errorType;
    }
    return { kind: 'nominal', entity: entity as NominalType['entity'], arguments: typeArguments };
  }

  preludeFunctions(name: string): readonly FunctionDeclaration[] {
    const entity = this.#preludeExport(name);
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

  /**
   * Every function of an inference cycle needs a declared result. Each is reported at its own name,
   * so the report doesn't depend on which module's diagnostics were asked for first.
   */
  #reportRecursion(cycle: readonly FunctionDeclaration[]): void {
    for (const member of cycle.filter((candidate) => !this.#reportedRecursive.has(candidate))) {
      this.#reportedRecursive.add(member);
      this.report(
        this.moduleOf(member),
        checkerDiagnostics.recursiveReturnType(member.name.span, member.name.text),
      );
    }
  }

  #declaredBodyResult(declaration: FunctionDeclaration): Type | undefined {
    if (!this.#declaredResults.has(declaration)) {
      this.#declaredResults.set(
        declaration,
        declaredBodyResult(this, this.moduleOf(declaration), declaration),
      );
    }
    return this.#declaredResults.get(declaration);
  }

  #preludeExport(name: string) {
    const { prelude } = this.program;
    return prelude === undefined ? undefined : this.bindings.exportsOf(prelude).get(name);
  }
}

function memoized<Key, Value>(cache: Map<Key, Value>, key: Key, compute: () => Value): Value {
  const known = cache.get(key);
  if (known !== undefined) {
    return known;
  }
  const value = compute();
  cache.set(key, value);
  return value;
}

/** The type arguments of `type`, by the type parameters of its declaration. */
function substitutionOf(type: NominalType): Substitution {
  const parameters = type.entity.declaration.typeParameters.filter(
    (parameter) => parameter.kind === 'TypeParameter',
  );
  return new Map(
    parameters.map((parameter, index) => [parameter, type.arguments[index] ?? errorType]),
  );
}

function instantiateFields(
  fields: readonly FieldMember[],
  substitution: Substitution,
): readonly FieldMember[] {
  return fields.map((field) => ({ ...field, type: substitute(field.type, substitution) }));
}
