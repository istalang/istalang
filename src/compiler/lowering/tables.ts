/**
 * The tables a Definition is assembled from, each entry made once (docs/arch/definition.md).
 *
 * - Function instances (instances.ts) are numbered when first referenced and lowered afterwards
 *   from a worklist, so a call can name one that isn't lowered yet, including itself. Only what
 *   `main` reaches is lowered: generics are compiled per instantiation (§3.5), which only
 *   reachability can enumerate.
 * - Types and constants are interned: one entry per distinct type or value, a type keyed as the
 *   checker keys it (types/type-keys.ts), a value by its persisted text.
 * - A type entry is numbered before its fields are lowered, so a recursive type refers to itself
 *   through the table (§3.1). Every nominal type can be laid out: a struct by its fields, an enum
 *   by its variants, an extern type by who disposes it, which the checker derives from the
 *   `dispose` declared for it (checker/rules/disposal.ts).
 * - An anonymous struct is a struct entry without a name, one per type, so two never share an
 *   entry (§3.1).
 */

import { z } from 'zod';
import { encodeJson } from '../../definition/codec.ts';
import type { FunctionDefinition } from '../../definition/functions.ts';
import type { FunctionId, TypeId } from '../../definition/operands.ts';
import type { Tables } from '../../definition/tables.ts';
import type { TypeDefinition, TypeReference } from '../../definition/types.ts';
import { type Value, value } from '../../definition/values.ts';
import { memo } from '../../structures/memo.ts';
import { lineMapOf } from '../../text/line-map.ts';
import type { Checker } from '../checker/check.ts';
import type { AnonymousStructType, FieldMember, NominalType, Type } from '../checker/types/type.ts';

import type { ModuleId } from '../program/program.ts';
import {
  type FunctionInstance,
  instanceKey,
  instanceName,
  type NestedInstance,
  nestedKey,
  nestedName,
  ownerDeclaration,
} from './instances.ts';
import { loadedModule, qualifiedNameOf } from './names.ts';

/** A function-table entry waiting to be lowered: a top-level function's instance, or a nested one. */
export type PendingEntry =
  | { readonly kind: 'instance'; readonly instance: FunctionInstance }
  | { readonly kind: 'nested'; readonly nested: NestedInstance };

/** What every function-table entry starts with: its name, and where it is declared. */
export type EntryHeader = Pick<FunctionDefinition, 'name' | 'module' | 'span' | 'annotations'>;

/** A type with an entry of its own: a declared struct, enum or extern type, or an anonymous struct. */
type EntryType = NominalType | AnonymousStructType;

export class DefinitionTables {
  readonly #checker: Checker;
  readonly #modules: Tables['modules'][number][] = [];
  readonly #moduleIndexes = new Map<ModuleId, number>();
  readonly #types: TypeDefinition[] = [];
  readonly #typeIndexes = new Map<string, TypeId>();
  readonly #constants: Value[] = [];
  readonly #constantIndexes = new Map<string, number>();
  readonly #functions: (FunctionDefinition | undefined)[] = [];
  readonly #functionIndexes = new Map<string, FunctionId>();
  readonly #pending: PendingEntry[] = [];

  constructor(checker: Checker) {
    this.#checker = checker;
  }

  /** The index of `module` in the module table, with its line starts for spans. */
  moduleIndex(module: ModuleId): number {
    return memo(this.#moduleIndexes, module, () => this.#addModule(module));
  }

  #addModule(module: ModuleId): number {
    const { lineStarts } = lineMapOf(loadedModule(this.#checker, module).tree.source);
    return this.#modules.push({ id: module, lineStarts: [...lineStarts] }) - 1;
  }

  /** The index of a constant holding `value`; equal values, as their persisted texts are, share one. */
  constant(contents: Value): number {
    const key = encodeJson(z.encode(value, contents));
    return memo(this.#constantIndexes, key, () => this.#constants.push(contents) - 1);
  }

  /** What every function-table entry for `instance` starts with: its name and where it is. */
  entryHeader(instance: FunctionInstance): EntryHeader {
    const { declaration } = instance;
    const module = this.#checker.moduleOf(declaration);
    return {
      name: instanceName(this.#checker, instance),
      module: this.moduleIndex(module),
      span: declaration.name.span,
      annotations: [],
    };
  }

  /** The header of a nested function's entry: named after its owner, where its node is. */
  nestedHeader(nested: NestedInstance): EntryHeader {
    const module = this.#checker.moduleOf(ownerDeclaration(nested.owner));
    const { source } = loadedModule(this.#checker, module).tree;
    const { line, column } = lineMapOf(source).positionAt(nested.node.span.start);
    return {
      name: nestedName(this.#checker, nested, `${line + 1}:${column + 1}`),
      module: this.moduleIndex(module),
      span: nested.node.span,
      annotations: [],
    };
  }

  /** The index `instance` is called by; it is lowered later, from the worklist. */
  functionIndex(instance: FunctionInstance): FunctionId {
    const key = instanceKey(this.#checker.typeKeys, instance);
    return this.#entryIndex(key, { kind: 'instance', instance });
  }

  /** The index of a lambda's or local function's entry (§3.14), lowered later too. */
  nestedIndex(nested: NestedInstance): FunctionId {
    return this.#entryIndex(nestedKey(this.#checker.typeKeys, nested), { kind: 'nested', nested });
  }

  /** The next referenced entry still to be lowered, with its index. */
  nextPending(): (PendingEntry & { readonly index: FunctionId }) | undefined {
    const entry = this.#pending.shift();
    if (entry === undefined) {
      return undefined;
    }
    const index =
      entry.kind === 'instance'
        ? this.functionIndex(entry.instance)
        : this.nestedIndex(entry.nested);
    return { ...entry, index };
  }

  #entryIndex(key: string, entry: PendingEntry): FunctionId {
    return memo(this.#functionIndexes, key, () => {
      this.#pending.push(entry);
      return this.#functions.push(undefined) - 1;
    });
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
      case 'anonymous':
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
  typeIndex(type: EntryType): TypeId {
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

  /**
   * Not `memo`: the index is recorded before the layout is computed, because a recursive type's
   * layout refers to the type itself.
   */
  #typeEntry(type: EntryType): TypeId {
    const key = this.#checker.typeKeys.typeKey(type);
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
  #layout(type: EntryType): TypeDefinition {
    if (type.kind === 'anonymous') {
      return { kind: 'struct', name: '', arguments: [], fields: this.#fields(type.fields) };
    }
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
          disposal: { kind: this.#checker.disposalOf(type) },
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
}
