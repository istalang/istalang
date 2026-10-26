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
import type {
  EnumRole,
  ExternRole,
  TypeDefinition,
  TypeReference,
} from '../../definition/types.ts';
import { type Value, value } from '../../definition/values.ts';
import { type WellKnownDeclaration, wellKnown } from '../../language/well-known.ts';
import { memo } from '../../structures/memo.ts';
import { unreachable } from '../../structures/unreachable.ts';
import { lineMapOf } from '../../text/line-map.ts';
import type { Checker, Disposal } from '../checker/check.ts';
import type { CheckedAnnotation } from '../checker/checked-annotation.ts';
import type { AnonymousStructType, FieldMember, NominalType, Type } from '../checker/types/type.ts';

import type { ModuleId } from '../program/program.ts';
import type {
  ConstantDeclaration,
  ExternConstantDeclaration,
  FunctionDeclaration,
} from '../syntax/declarations.ts';
import { constantValue } from './constants.ts';
import {
  type FunctionInstance,
  instanceKey,
  instanceName,
  instanceOfCall,
  type NestedInstance,
  nestedKey,
  nestedName,
  ownerDeclaration,
} from './instances.ts';
import { loadedModule, qualifiedNameOf } from './names.ts';

/**
 * A function-table entry waiting to be lowered: a top-level function's instance, a nested one, an
 * extern a host implements as its native sees it (boundary/host-externs.ts), or a host handle's
 * function, the read of an extern constant, or the wrapper a host starts a function through
 * (boundary/starts.ts).
 */
export type PendingEntry =
  | { readonly kind: 'instance'; readonly instance: FunctionInstance }
  | { readonly kind: 'nested'; readonly nested: NestedInstance }
  | { readonly kind: 'hostNative'; readonly declaration: FunctionDeclaration }
  | {
      /** An extern constant's native, which its declared type is given with. */
      readonly kind: 'constantNative';
      readonly declaration: ExternConstantDeclaration;
      readonly type: Type;
    }
  | {
      /** The native of field `field` of the host handle `declaration` returns (§3.6). */
      readonly kind: 'handleFieldNative';
      readonly declaration: FunctionDeclaration;
      readonly field: string;
    }
  | {
      /** A function of the host handle `instance` returns, which calls its native (§3.6). */
      readonly kind: 'handleField';
      readonly instance: FunctionInstance;
      readonly field: string;
    }
  | {
      readonly kind: 'externConstant';
      readonly declaration: ExternConstantDeclaration;
      readonly type: Type;
    }
  | { readonly kind: 'start'; readonly target: StartTarget };

/** An extern a host implements: a function, or a constant. */
export type HostExternDeclaration = FunctionDeclaration | ExternConstantDeclaration;

/** What a host may start (§9): a top-level function, or a constant holding a sendable lambda. */
export type StartTarget = FunctionDeclaration | ConstantDeclaration;

/** What every function-table entry starts with: its name, and where it is declared. */
export type EntryHeader = Pick<FunctionDefinition, 'name' | 'module' | 'span' | 'annotations'>;

/** A type with an entry of its own: a declared struct, enum or extern type, or an anonymous struct. */
type EntryType = NominalType | AnonymousStructType;

/** The std type each role of an extern type entry is (definition/types.ts). */
const externRoles = {
  cell: wellKnown.shared,
  future: wellKnown.future,
} as const satisfies Record<ExternRole, WellKnownDeclaration>;

/** The std type each role of an enum entry is (definition/types.ts). */
const enumRoles = {
  json: wellKnown.json,
} as const satisfies Record<EnumRole, WellKnownDeclaration>;

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
  readonly #pending: (PendingEntry & { readonly index: FunctionId })[] = [];
  readonly #starts: { readonly key: string; readonly function: FunctionId }[] = [];

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

  /**
   * What every function-table entry for `instance` starts with: its name, where it is, and the
   * annotations its declaration carries (§3.16).
   */
  entryHeader(instance: FunctionInstance): EntryHeader {
    const { declaration } = instance;
    const module = this.#checker.moduleOf(declaration);
    return {
      name: instanceName(this.#checker, instance),
      module: this.moduleIndex(module),
      span: declaration.name.span,
      annotations: this.#annotationValues(
        this.#checker.annotations.of(module, declaration, { kind: 'function' }),
      ),
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

  /** The header of an entry standing for `declaration` as a whole: its qualified name, its place. */
  declarationHeader(declaration: HostExternDeclaration | StartTarget): EntryHeader {
    const module = this.#checker.moduleOf(declaration);
    const name = qualifiedNameOf(this.#checker, declaration);
    const span =
      declaration.kind === 'VariableDeclaration' ? declaration.span : declaration.name.span;
    return { name, module: this.moduleIndex(module), span, annotations: [] };
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

  /**
   * The index of the extern a host implements, as its native sees it: JSON in and out (§9); a
   * constant's comes with its declared type.
   */
  hostNativeIndex(declaration: FunctionDeclaration): FunctionId {
    const key = `native:${this.#checker.typeKeys.identityOf(declaration)}`;
    return this.#entryIndex(key, { kind: 'hostNative', declaration });
  }

  /** The index of the native of the extern constant `declaration`, declared of type `type`. */
  constantNativeIndex(declaration: ExternConstantDeclaration, type: Type): FunctionId {
    const key = `native:${this.#checker.typeKeys.identityOf(declaration)}`;
    return this.#entryIndex(key, { kind: 'constantNative', declaration, type });
  }

  /** The index of the native of field `field` of the host handle `declaration` returns (§3.6). */
  handleFieldNativeIndex(declaration: FunctionDeclaration, field: string): FunctionId {
    const key = `native:${this.#checker.typeKeys.identityOf(declaration)}.${field}`;
    return this.#entryIndex(key, { kind: 'handleFieldNative', declaration, field });
  }

  /** The index of the function field `field` of the host handle `instance` returns holds. */
  handleFieldIndex(instance: FunctionInstance, field: string): FunctionId {
    const key = `handle:${instanceKey(this.#checker.typeKeys, instance)}.${field}`;
    return this.#entryIndex(key, { kind: 'handleField', instance, field });
  }

  /** The index of the entry reading the extern constant `declaration`, of type `type` (§3.6). */
  externConstantIndex(declaration: ExternConstantDeclaration, type: Type): FunctionId {
    const key = `constant:${this.#checker.typeKeys.identityOf(declaration)}`;
    return this.#entryIndex(key, { kind: 'externConstant', declaration, type });
  }

  /** The index of the wrapper a host starts `target` through, listed under `key` (§9). */
  startIndex(target: StartTarget, key: string): FunctionId {
    const index = this.#entryIndex(`start:${this.#checker.typeKeys.identityOf(target)}`, {
      kind: 'start',
      target,
    });
    if (!this.#starts.some((start) => start.function === index)) {
      this.#starts.push({ key, function: index });
    }
    return index;
  }

  /** The next referenced entry still to be lowered, with its index. */
  nextPending(): (PendingEntry & { readonly index: FunctionId }) | undefined {
    return this.#pending.shift();
  }

  #entryIndex(key: string, entry: PendingEntry): FunctionId {
    return memo(this.#functionIndexes, key, () => {
      const index = this.#functions.push(undefined) - 1;
      this.#pending.push({ ...entry, index });
      return index;
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
        return unreachable(`A ${type.kind} type can't reach lowering.`);
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
        unreachable(`Function ${index} was referenced but never lowered.`);
      }
      return entry;
    });
    const withMain = main === undefined ? {} : { main };
    return {
      modules: this.#modules,
      types: this.#types,
      functions,
      constants: this.#constants,
      starts: this.#starts,
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
      case 'EnumDeclaration': {
        const role = this.#roleOf(enumRoles, type.entity);
        return {
          kind: 'enum',
          name,
          arguments: typeArguments,
          variants: (this.#checker.variantsOf(type) ?? []).map((variant) => ({
            name: variant.name,
            fields: this.#fields(variant.fields),
          })),
          ...(role === undefined ? {} : { role }),
        };
      }
      case 'ExternStructDeclaration': {
        const role = this.#roleOf(externRoles, type.entity);
        return {
          kind: 'extern',
          name,
          arguments: typeArguments,
          sendable: declaration.isSendable,
          disposal: this.#disposal(this.#checker.disposalOf(type)),
          ...(role === undefined ? {} : { role }),
        };
      }
      default: {
        const unhandled: never = declaration;
        return unhandled;
      }
    }
  }

  /** Which of `roles` the type `entity` declares has: what the runtime makes of its values. */
  #roleOf<Role extends string>(
    roles: Readonly<Record<Role, WellKnownDeclaration>>,
    entity: NominalType['entity'],
  ): Role | undefined {
    return (Object.keys(roles) as Role[]).find(
      (role) => this.#checker.wellKnownEntity(roles[role]) === entity,
    );
  }

  /** A type entry's disposal: a declared `dispose` is the entry of its instance (§7). */
  #disposal(disposal: Disposal): Extract<TypeDefinition, { kind: 'extern' }>['disposal'] {
    return disposal.kind === 'function'
      ? { kind: 'function', function: this.functionIndex(instanceOfCall(disposal.call)) }
      : disposal;
  }

  #fields(fields: readonly FieldMember[]) {
    return fields.map((field) => ({
      name: field.name,
      type: this.typeReference(field.type),
      annotations: this.#annotationValues(this.#checker.annotations.ofField(field)),
    }));
  }

  /** The values of `annotations`, as an entry carries them for tools to read. */
  #annotationValues(annotations: readonly CheckedAnnotation[]): Value[] {
    return annotations.map(({ form }) => constantValue(this, form));
  }
}
