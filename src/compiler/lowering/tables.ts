/**
 * The tables a Definition is assembled from, each entry made once (docs/arch/definition.md).
 *
 * - Function instances (instances.ts) are numbered when first referenced and lowered afterwards
 *   from a worklist, so a call can name one that isn't lowered yet, including itself. Only what
 *   `main` reaches is lowered: generics are compiled per instantiation (§3.5), which only
 *   reachability can enumerate.
 * - Types and constants are interned: one entry per distinct type (type-table.ts) or value, a
 *   value keyed by its persisted text.
 */

import { z } from 'zod';
import { encodeJson } from '../../definition/codec.ts';
import type { FunctionDefinition } from '../../definition/functions.ts';
import type { FunctionId } from '../../definition/operands.ts';
import type { Tables } from '../../definition/tables.ts';
import { type Value, value } from '../../definition/values.ts';
import { memo } from '../../structures/memo.ts';
import { unreachable } from '../../structures/unreachable.ts';
import { lineMapOf } from '../../text/line-map.ts';
import type { Span } from '../../text/span.ts';
import type { Checker } from '../checker/check.ts';
import type { RequiredField } from '../checker/checked-field.ts';
import { passesAll } from '../checker/resolved-call.ts';
import type { AnyType, Type } from '../checker/types/type.ts';

import { type ModuleId, programModule } from '../program/program.ts';
import type {
  ConstantDeclaration,
  ExternConstantDeclaration,
  FunctionDeclaration,
} from '../syntax/declarations.ts';
import { annotationValues } from './constants.ts';
import {
  type AsyncFit,
  asyncFitKey,
  asyncFitName,
  type BodyOwner,
  type ClosedCall,
  type Dispatch,
  type FunctionInstance,
  instanceKey,
  instanceName,
  type NestedInstance,
  nestedKey,
  nestedName,
  ownerDeclaration,
  takingPassed,
} from './instances.ts';
import { qualifiedNameOf } from './names.ts';
import { TypeTable } from './type-table.ts';

/**
 * A function-table entry waiting to be lowered: a top-level function's instance, a nested one, an
 * extern a host implements as its native sees it (boundary/host-externs.ts), the read of an extern
 * constant, the wrapper a host starts a function through (boundary/starts.ts), or the async entry
 * of a plain function made async (async-fits.ts).
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
      readonly kind: 'externConstant';
      readonly declaration: ExternConstantDeclaration;
      readonly type: Type;
    }
  | { readonly kind: 'start'; readonly target: StartTarget }
  | { readonly kind: 'asyncFit'; readonly fit: AsyncFit };

/**
 * An entry switching over every variant of an `any` type's enum (§3.10): a dispatch on a value's
 * own type, a conversion into another `any` type, or the read of a field a trait requires. It is
 * written once the worklist is empty, when lowering has reached every type converted into its
 * `any` type so far, and written again whenever a later entry converts another.
 */
export type ClosingEntry =
  | { readonly kind: 'dispatch'; readonly dispatch: Dispatch }
  | { readonly kind: 'anyConversion'; readonly from: AnyType; readonly to: AnyType }
  | { readonly kind: 'anyField'; readonly on: AnyType; readonly required: RequiredField };

/** An extern a host implements: a function, or a constant. */
export type HostExternDeclaration = FunctionDeclaration | ExternConstantDeclaration;

/** What a host may start (§9): a top-level function, or a constant holding a sendable lambda. */
export type StartTarget = FunctionDeclaration | ConstantDeclaration;

/** What every function-table entry starts with: its name, and where it is declared. */
export type EntryHeader = Pick<FunctionDefinition, 'name' | 'module' | 'span' | 'annotations'>;

export class DefinitionTables {
  readonly #checker: Checker;
  readonly types: TypeTable;
  readonly #modules: Tables['modules'][number][] = [];
  readonly #moduleIndexes = new Map<ModuleId, number>();
  readonly #constants: Value[] = [];
  readonly #constantIndexes = new Map<string, number>();
  readonly #functions: (FunctionDefinition | undefined)[] = [];
  readonly #functionIndexes = new Map<string, FunctionId>();
  readonly #pending: (PendingEntry & { readonly index: FunctionId })[] = [];
  readonly #closing: (ClosingEntry & { readonly index: FunctionId })[] = [];
  /** How many variants its `any` type had when each closing entry was last written. */
  readonly #writtenFor = new Map<FunctionId, number>();
  readonly #starts: Tables['starts'][number][] = [];

  constructor(checker: Checker) {
    this.#checker = checker;
    this.types = new TypeTable(checker, {
      functionIndex: (instance) => this.functionIndex(instance),
      hostNativeIndex: (declaration) => this.hostNativeIndex(declaration),
      annotationValues: (annotations) => annotationValues(this, annotations),
    });
  }

  /** The index of `module` in the module table, with its line starts for spans. */
  moduleIndex(module: ModuleId): number {
    return memo(this.#moduleIndexes, module, () => this.#addModule(module));
  }

  #addModule(module: ModuleId): number {
    const { lineStarts } = lineMapOf(programModule(this.#checker.program, module).tree.source);
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
      annotations: annotationValues(
        this,
        this.#checker.annotations.of(module, declaration, { kind: 'function' }),
      ),
    };
  }

  /** The header of a nested function's entry: named after its owner, where its node is. */
  nestedHeader(nested: NestedInstance): EntryHeader {
    return this.#ownedHeader(nested.owner, nested.node.span, (where) =>
      nestedName(this.#checker, nested, where),
    );
  }

  /** The header of an async fit's entry: named after its owner, where its site is. */
  asyncFitHeader(fit: AsyncFit): EntryHeader {
    return this.#ownedHeader(fit.owner, fit.site.span, (where) =>
      asyncFitName(this.#checker, fit, where),
    );
  }

  /** The header of an entry a body owns, at `span`, named by `nameAt` from where it stands. */
  #ownedHeader(owner: BodyOwner, span: Span, nameAt: (where: string) => string): EntryHeader {
    const module = this.#checker.moduleOf(ownerDeclaration(owner));
    const { source } = programModule(this.#checker.program, module).tree;
    const { line, column } = lineMapOf(source).positionAt(span.start);
    return {
      name: nameAt(`${line + 1}:${column + 1}`),
      module: this.moduleIndex(module),
      span,
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

  /**
   * The index of the entry taking a closed call's arguments as it passes them, for a caller that
   * gets an entry to call later: its function's own or a filling one (instances.ts), or its
   * dispatch's (§3.10).
   */
  callIndex(call: ClosedCall): FunctionId {
    if (call.kind === 'function') {
      return this.functionIndex(takingPassed(call));
    }
    if (!passesAll(call.binding)) {
      unreachable(
        'A requirement is never spawned or named as a value with its arguments reordered.',
      );
    }
    return this.dispatchIndex(call.dispatch);
  }

  /** The index of the entry calling `dispatch`'s function for each type its value may have. */
  dispatchIndex(dispatch: Dispatch): FunctionId {
    const { typeKeys } = this.#checker;
    const typeArguments = dispatch.typeArguments.map((type) => typeKeys.typeKey(type));
    const key = `dispatch:${typeKeys.typeKey(dispatch.on)}.${dispatch.constraint}.${dispatch.member}<${typeArguments.join(',')}>`;
    return this.#closingIndex(key, { kind: 'dispatch', dispatch });
  }

  /** The index of the entry converting a value of the `any` type `from` into `to` (§3.10). */
  anyConversionIndex(from: AnyType, to: AnyType): FunctionId {
    const { typeKeys } = this.#checker;
    const key = `convert:${typeKeys.typeKey(from)}->${typeKeys.typeKey(to)}`;
    return this.#closingIndex(key, { kind: 'anyConversion', from, to });
  }

  /** The index of the entry reading a field a trait of `on` requires from an `on` value. */
  anyFieldIndex(on: AnyType, required: RequiredField): FunctionId {
    const key = `field:${this.#checker.typeKeys.typeKey(on)}.${required.field.name.text}`;
    return this.#closingIndex(key, { kind: 'anyField', on, required });
  }

  /** The index `instance` is called by; it is lowered later, from the worklist. */
  functionIndex(instance: FunctionInstance): FunctionId {
    const key = instanceKey(this.#checker.typeKeys, instance);
    return this.#entryIndex(key, { kind: 'instance', instance });
  }

  /** The index of the async entry of a plain function made async (§3.14), lowered later too. */
  asyncFitIndex(fit: AsyncFit): FunctionId {
    return this.#entryIndex(asyncFitKey(this.#checker.typeKeys, fit), { kind: 'asyncFit', fit });
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

  /** The index of the entry reading the extern constant `declaration`, of type `type` (§3.6). */
  externConstantIndex(declaration: ExternConstantDeclaration, type: Type): FunctionId {
    const key = `constant:${this.#checker.typeKeys.identityOf(declaration)}`;
    return this.#entryIndex(key, { kind: 'externConstant', declaration, type });
  }

  /**
   * The index of the entry a host starts `target` through, listed under `key` with the `encoder` of
   * its outcome (§9).
   */
  startIndex(target: StartTarget, key: string, encoder: FunctionId): FunctionId {
    const index = this.#entryIndex(`start:${this.#checker.typeKeys.identityOf(target)}`, {
      kind: 'start',
      target,
    });
    if (!this.#starts.some((start) => start.function === index)) {
      this.#starts.push({ key, function: index, encoder });
    }
    return index;
  }

  /**
   * The next referenced entry still to be lowered, with its index: one lowering reached, then,
   * once none is left, a closing entry not yet written for every variant its `any` type has.
   */
  nextPending(): ((PendingEntry | ClosingEntry) & { readonly index: FunctionId }) | undefined {
    return this.#pending.shift() ?? this.#nextStale();
  }

  #nextStale(): (ClosingEntry & { readonly index: FunctionId }) | undefined {
    for (const entry of this.#closing) {
      const variants = this.types.anyMembers(closedOver(entry)).length;
      if (this.#writtenFor.get(entry.index) !== variants) {
        this.#writtenFor.set(entry.index, variants);
        return entry;
      }
    }
    return undefined;
  }

  #entryIndex(key: string, entry: PendingEntry): FunctionId {
    return this.#numbered(key, (index) => this.#pending.push({ ...entry, index }));
  }

  #closingIndex(key: string, entry: ClosingEntry): FunctionId {
    return this.#numbered(key, (index) => this.#closing.push({ ...entry, index }));
  }

  /** The index of the entry `key` names, numbered and queued by `queue` the first time. */
  #numbered(key: string, queue: (index: FunctionId) => void): FunctionId {
    return memo(this.#functionIndexes, key, () => {
      const index = this.#functions.push(undefined) - 1;
      queue(index);
      return index;
    });
  }

  define(index: FunctionId, entry: FunctionDefinition): void {
    this.#functions[index] = entry;
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
      types: [...this.types.entries],
      functions,
      constants: this.#constants,
      starts: this.#starts,
      ...withMain,
    };
  }
}

/** The `any` type whose variants a closing entry switches over. */
function closedOver(entry: ClosingEntry): AnyType {
  switch (entry.kind) {
    case 'dispatch':
      return entry.dispatch.on;
    case 'anyConversion':
      return entry.from;
    case 'anyField':
      return entry.on;
    default: {
      const unhandled: never = entry;
      return unhandled;
    }
  }
}
