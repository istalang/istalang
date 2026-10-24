/**
 * The tables a Definition is assembled from, each entry made once (docs/arch/definition.md).
 *
 * - Functions are numbered when first referenced and lowered afterwards from a worklist, so a call
 *   can name a function that isn't lowered yet, including itself. Only what `main` reaches is
 *   lowered: generics are compiled per instantiation (§3.5), which only reachability can enumerate.
 * - Types and constants are interned: one entry per distinct type or value. A nominal type's
 *   identity is its declaration's entity plus its arguments, as in the checker (types/type.ts).
 * - A type entry is numbered before its fields are lowered, so a recursive type refers to itself
 *   through the table (§3.1). Every nominal type can be laid out: a struct by its fields, an enum
 *   by its variants, an extern type by how it is disposed.
 */

import type { FunctionDefinition } from '../../definition/functions.ts';
import type { FunctionId, TypeId } from '../../definition/operands.ts';
import type { Tables } from '../../definition/tables.ts';
import type { TypeDefinition, TypeReference } from '../../definition/types.ts';
import type { Value } from '../../definition/values.ts';
import { lineMapOf } from '../../text/line-map.ts';
import type { Checker, FieldMember } from '../checker/check.ts';
import type { NominalType, Type } from '../checker/types/type.ts';
import type { ModuleId } from '../program/program.ts';
import type { FunctionDeclaration } from '../syntax/declarations.ts';
import { loadedModule, qualifiedNameOf } from './names.ts';

/**
 * The extern types the runtime itself disposes (§7, docs/arch/definition.md "Types and
 * locations"): a future and a slot die with their last holder. The rest are disposed by no one,
 * until a type gets a declared `dispose`.
 */
const runtimeDisposed: ReadonlySet<string> = new Set(['prelude.Future', 'prelude.Slot']);

/** A constant the lowering emits: a primitive value (§2). */
export type ConstantValue = null | boolean | string | bigint | number;

export class DefinitionTables {
  readonly #checker: Checker;
  readonly #modules: Tables['modules'][number][] = [];
  readonly #moduleIndexes = new Map<ModuleId, number>();
  readonly #types: TypeDefinition[] = [];
  readonly #typeIndexes = new Map<string, TypeId>();
  readonly #entityKeys = new Map<NominalType['entity'], number>();
  readonly #constants: Value[] = [];
  readonly #constantIndexes = new Map<string, number>();
  readonly #functions: (FunctionDefinition | undefined)[] = [];
  readonly #functionIndexes = new Map<FunctionDeclaration, FunctionId>();
  readonly #pending: FunctionDeclaration[] = [];

  constructor(checker: Checker) {
    this.#checker = checker;
  }

  /** The index of `module` in the module table, with its line starts for spans. */
  moduleIndex(module: ModuleId): number {
    const known = this.#moduleIndexes.get(module);
    if (known !== undefined) {
      return known;
    }
    const lines = lineMapOf(loadedModule(this.#checker, module).tree.source);
    const lineStarts = Array.from({ length: lines.lineCount }, (_, line) =>
      lines.offsetAt({ line, column: 0 }),
    );
    const index = this.#modules.push({ id: module, lineStarts }) - 1;
    this.#moduleIndexes.set(module, index);
    return index;
  }

  /** The index of a constant holding `value`. */
  constant(value: ConstantValue): number {
    const key = constantKey(value);
    const known = this.#constantIndexes.get(key);
    if (known !== undefined) {
      return known;
    }
    const index = this.#constants.push(value) - 1;
    this.#constantIndexes.set(key, index);
    return index;
  }

  /** What every function-table entry for `declaration` starts with: its name and where it is. */
  entryHeader(declaration: FunctionDeclaration) {
    const module = this.#checker.moduleOf(declaration);
    return {
      name: qualifiedNameOf(this.#checker, declaration),
      module: this.moduleIndex(module),
      span: declaration.name.span,
      annotations: [],
    };
  }

  /** The index `declaration` is called by; it is lowered later, from the worklist. */
  functionIndex(declaration: FunctionDeclaration): FunctionId {
    const known = this.#functionIndexes.get(declaration);
    if (known !== undefined) {
      return known;
    }
    const index = this.#functions.push(undefined) - 1;
    this.#functionIndexes.set(declaration, index);
    this.#pending.push(declaration);
    return index;
  }

  /** The next referenced function still to be lowered, with its index. */
  nextPending(): { declaration: FunctionDeclaration; index: FunctionId } | undefined {
    const declaration = this.#pending.shift();
    return declaration === undefined
      ? undefined
      : { declaration, index: this.functionIndex(declaration) };
  }

  define(index: FunctionId, entry: FunctionDefinition): void {
    this.#functions[index] = entry;
  }

  /** How the Definition refers to `type`. */
  typeReference(type: Type): TypeReference {
    switch (type.kind) {
      case 'primitive':
        return { kind: 'primitive', name: type.name };
      case 'nominal':
        return { kind: 'named', type: this.#typeEntry(type) };
      case 'tuple':
        return {
          kind: 'tuple',
          elements: type.elements.map((element) => this.typeReference(element)),
        };
      case 'function':
        return {
          kind: 'function',
          async: type.isAsync,
          parameters: type.parameters.map((parameter) => this.typeReference(parameter.type)),
          result: this.typeReference(type.result),
        };
      case 'parameter':
      case 'error':
        throw new Error(`A ${type.kind} type can't reach lowering.`);
      default: {
        const unhandled: never = type;
        return unhandled;
      }
    }
  }

  /** The index of the type entry for `type`. */
  typeIndex(type: NominalType): TypeId {
    return this.#typeEntry(type);
  }

  /** The finished tables, every referenced function lowered. */
  finish(main: FunctionId | undefined): Tables {
    const functions = this.#functions.map((entry, index) => {
      if (entry === undefined) {
        throw new Error(`Function ${index} was referenced but never lowered.`);
      }
      return entry;
    });
    const withMain = main === undefined ? {} : { main };
    return {
      modules: this.#modules,
      types: this.#types,
      functions,
      constants: this.#constants,
      ...withMain,
    };
  }

  #typeEntry(type: NominalType): TypeId {
    const key = this.#typeKey(type);
    const known = this.#typeIndexes.get(key);
    if (known !== undefined) {
      return known;
    }
    const index = this.#types.length;
    this.#typeIndexes.set(key, index);
    this.#types.push({ kind: 'struct', name: '', arguments: [], fields: [] });
    this.#types[index] = this.#layout(type);
    return index;
  }

  /** The entry describing `type`: its fields, its variants, or how an extern type is disposed. */
  #layout(type: NominalType): TypeDefinition {
    const { declaration } = type.entity;
    const name = qualifiedNameOf(this.#checker, declaration);
    const typeArguments = type.arguments.map((argument) => this.typeReference(argument));
    switch (declaration.kind) {
      case 'StructDeclaration':
        return {
          kind: 'struct',
          name,
          arguments: typeArguments,
          fields: this.#fields(this.#checker.fieldsOf(type) ?? []),
        };
      case 'EnumDeclaration':
        return {
          kind: 'enum',
          name,
          arguments: typeArguments,
          variants: (this.#checker.variantsOf(type) ?? []).map((variant) => ({
            name: variant.name,
            fields: this.#fields(variant.fields),
          })),
        };
      case 'ExternStructDeclaration':
        return {
          kind: 'extern',
          name,
          arguments: typeArguments,
          sendable: declaration.isSendable,
          disposal: runtimeDisposed.has(name) ? { kind: 'runtime' } : { kind: 'none' },
        };
      default: {
        const unhandled: never = declaration;
        return unhandled;
      }
    }
  }

  #fields(fields: readonly FieldMember[]) {
    return fields.map((field) => ({
      name: field.name,
      type: this.typeReference(field.type),
      annotations: [],
    }));
  }

  #typeKey(type: Type): string {
    if (type.kind !== 'nominal') {
      return JSON.stringify(this.typeReference(type));
    }
    let entityKey = this.#entityKeys.get(type.entity);
    if (entityKey === undefined) {
      entityKey = this.#entityKeys.size;
      this.#entityKeys.set(type.entity, entityKey);
    }
    return `${entityKey}<${type.arguments.map((argument) => this.#typeKey(argument)).join(',')}>`;
  }
}

/** One key per distinct constant: kind and value, with `-0` apart from `0` (§2). */
function constantKey(value: ConstantValue): string {
  if (typeof value === 'number') {
    return `float:${Object.is(value, -0) ? '-0' : String(value)}`;
  }
  return `${typeof value}:${String(value)}`;
}
