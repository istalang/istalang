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
import { encodeJson } from '../../../definition/formats/codec.ts';
import type { FunctionId } from '../../../definition/operands.ts';
import type { FunctionDefinition } from '../../../definition/tables/functions.ts';
import type { Tables } from '../../../definition/tables/index.ts';
import { type Value, value } from '../../../definition/values/values.ts';
import { memo } from '../../../foundation/structures/memo.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import { lineMapOf } from '../../../foundation/text/line-map.ts';
import type { Checker } from '../../checker/check.ts';
import { functionPlace } from '../../checker/surface/checked-annotation.ts';
import type { RequiredField } from '../../checker/surface/checked-field.ts';
import { passesAll } from '../../checker/surface/resolved-call.ts';
import type { AnyType, Type } from '../../checker/types/type/index.ts';

import { type ModuleId, programModule } from '../../program/program.ts';
import type {
  ConstantDeclaration,
  ContextConstantDeclaration,
  ExternConstantDeclaration,
  FunctionDeclaration,
} from '../../syntax/declarations/index.ts';
import type { SyntaxTree } from '../../syntax/tree/index.ts';
import { type AnchoredSpan, spanIn } from '../../syntax/tree/positions.ts';
import { type ClosedCall, type Dispatch, leavesOut } from '../calls/closed-calls.ts';
import { nestedSpanOf } from '../functions/bodies.ts';
import { laidOutAs } from '../values/holdings.ts';
import { annotationValues } from './constants.ts';
import {
  type AsyncFit,
  asyncFitKey,
  asyncFitName,
  type BodyOwner,
  type ConversionEntry,
  conversionKey,
  type DeferredFunction,
  deferredKey,
  deferredName,
  type FunctionInstance,
  instanceKey,
  instanceName,
  type NestedInstance,
  nestedKey,
  nestedName,
  ownerDeclaration,
  typedIn,
} from './instances.ts';
import { qualifiedNameOf } from './names.ts';
import { ownEntryOf } from './own-entries.ts';
import { TypeTable } from './type-table.ts';

/**
 * A function-table entry waiting to be lowered: a top-level function's instance, the entry of a
 * native extern's instance computing the defaults a call leaves out before calling it (§3.3), a nested
 * instance, an extern a host implements as its native sees it (synthesized/boundary/host-externs.ts),
 * the read of an extern constant, the wrapper a host starts a function through
 * (synthesized/boundary/starts.ts), a context constant's accessor (§3.4), the async entry of a
 * plain function made async, the
 * function a deferred call gives (constructs/expressions/deferred-calls.ts), or a conversion of
 * parts (functions/fits/).
 */
export type PendingEntry =
  | { readonly kind: 'instance'; readonly instance: FunctionInstance }
  | { readonly kind: 'externDefaults'; readonly instance: FunctionInstance }
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
  | { readonly kind: 'contextConstant'; readonly declaration: ContextConstantDeclaration }
  | { readonly kind: 'asyncFit'; readonly fit: AsyncFit }
  | { readonly kind: 'deferred'; readonly deferred: DeferredFunction }
  | ConversionEntry;

/**
 * An entry switching over every variant of an `any` type's enum (§3.10): a dispatch on a value's
 * own type, a conversion into another `any` type, or the read of a field a trait requires. It is
 * written once the worklist is empty, when lowering has reached every type converted into its `any`
 * type so far, and written again whenever a later entry converts another. A dispatch on a union's
 * members (§6) switches over a union's enum, whose variants are known, so it is written once.
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
  readonly #modules: (Tables['modules'][number] & { readonly id: ModuleId })[] = [];
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
      callIndex: (call) => this.callIndex(call),
      hostNativeIndex: (declaration) => this.hostNativeIndex(declaration),
      annotationValues: (annotations, typed) => annotationValues(this, annotations, typed),
    });
  }

  /** The index of `module` in the module table, with its line starts for spans. */
  moduleIndex(module: ModuleId): number {
    return memo(this.#moduleIndexes, module, () => this.#addModule(module));
  }

  /** The tree of the module at `index` of the module table, which an entry's spans point into. */
  treeAt(index: number): SyntaxTree {
    const module = this.#modules[index];
    if (module === undefined) {
      return unreachable(`No module ${index} is in the module table.`);
    }
    return programModule(this.#checker.program, module.id).tree;
  }

  #addModule(module: ModuleId): number {
    const { lineStarts } = lineMapOf(programModule(this.#checker.program, module).tree.source);
    return this.#modules.push({ id: module, lineStarts: [...lineStarts] }) - 1;
  }

  /**
   * The index of a constant holding `value`; equal values, as their persisted texts are, share one.
   */
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
      span: spanIn(programModule(this.#checker.program, module).tree, declaration.name.span),
      annotations: annotationValues(
        this,
        this.#checker.annotations.of(module, declaration, functionPlace(declaration)),
        typedIn(instance, this.#checker.typeRules),
      ),
    };
  }

  /** The header of a nested function's entry: named after its owner, where its node is. */
  nestedHeader(nested: NestedInstance): EntryHeader {
    const module = this.#checker.moduleOf(ownerDeclaration(nested.owner));
    const at = nestedSpanOf(this.#checker.program, module, nested.node);
    return this.#ownedHeader(nested.owner, at, (where) => nestedName(this.#checker, nested, where));
  }

  /** The header of an async fit's entry: named after its owner, where its site is. */
  asyncFitHeader(fit: AsyncFit): EntryHeader {
    return this.#ownedHeader(fit.owner, fit.site.span, (where) =>
      asyncFitName(this.#checker, fit, where),
    );
  }

  /** The header of a deferred call's function's entry: named after its owner, where its call is. */
  deferredHeader(deferred: DeferredFunction): EntryHeader {
    return this.#ownedHeader(deferred.owner, deferred.plan.site.span, (where) =>
      deferredName(this.#checker, deferred, where),
    );
  }

  /** The header of an entry a body owns, at `span`, named by `nameAt` from where it stands. */
  #ownedHeader(owner: BodyOwner, at: AnchoredSpan, nameAt: (where: string) => string): EntryHeader {
    const module = this.#checker.moduleOf(ownerDeclaration(owner));
    const { tree } = programModule(this.#checker.program, module);
    const span = spanIn(tree, at);
    const { line, column } = lineMapOf(tree.source).positionAt(span.start);
    return {
      name: nameAt(`${line + 1}:${column + 1}`),
      module: this.moduleIndex(module),
      span,
      annotations: [],
    };
  }

  /**
   * The header of an entry standing for `declaration` as a whole: its qualified name, its place.
   */
  declarationHeader(
    declaration: HostExternDeclaration | StartTarget | ContextConstantDeclaration,
  ): EntryHeader {
    const module = this.#checker.moduleOf(declaration);
    const name = qualifiedNameOf(this.#checker, declaration);
    const at =
      declaration.kind === 'VariableDeclaration' ? declaration.span : declaration.name.span;
    return this.headerAt(name, module, at);
  }

  /** The header of an entry named `name` that stands at `at` in `module`, with no annotations. */
  headerAt(name: string, module: ModuleId, at: AnchoredSpan): EntryHeader {
    const span = spanIn(programModule(this.#checker.program, module).tree, at);
    return { name, module: this.moduleIndex(module), span, annotations: [] };
  }

  /**
   * The index of the entry taking a closed call's arguments as it passes them, for a caller that
   * gets an entry to call later, a function value's or the runtime's: its function's, which
   * computes what the call leaves out (`leavingOutIndex`), or its dispatch's (§3.10).
   */
  callIndex(call: ClosedCall): FunctionId {
    if (call.kind === 'function') {
      return leavesOut(this.#checker, call)
        ? this.leavingOutIndex(call.instance)
        : this.functionIndex(call.instance);
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
    const { on, through, constraint, member } = dispatch;
    const target = `${typeKeys.typeKey(on)}:${typeKeys.typeKey(through)}.${constraint}.${member}`;
    const key = `dispatch:${target}<${typeArguments.join(',')}>`;
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

  /**
   * The index a call leaving parameters of `instance` out calls (§3.3): its own entry, which
   * computes them; for an extern bound to its native, which computes nothing, an entry computing
   * them, then calling it (own-entries.ts).
   */
  leavingOutIndex(instance: FunctionInstance): FunctionId {
    if (ownEntryOf(this.#checker, instance).kind !== 'native') {
      return this.functionIndex(instance);
    }
    const key = `defaults:${instanceKey(this.#checker.typeKeys, instance)}`;
    return this.#entryIndex(key, { kind: 'externDefaults', instance });
  }

  /** The index of the async entry of a plain function made async (§3.14), lowered later too. */
  asyncFitIndex(fit: AsyncFit): FunctionId {
    return this.#entryIndex(asyncFitKey(this.#checker.typeKeys, fit), { kind: 'asyncFit', fit });
  }

  /** The index of the entry of the function a deferred call gives (§3.14), lowered later too. */
  deferredIndex(deferred: DeferredFunction): FunctionId {
    const key = deferredKey(this.#checker.typeKeys, deferred);
    return this.#entryIndex(key, { kind: 'deferred', deferred });
  }

  /** The index of a conversion's entry (§3.5), one per pair of types, lowered later too. */
  conversionIndex(entry: ConversionEntry): FunctionId {
    return this.#entryIndex(conversionKey(this.#checker.typeKeys, entry), entry);
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

  /** The index of the accessor of the context constant `declaration` (§3.4). */
  contextConstantIndex(declaration: ContextConstantDeclaration): FunctionId {
    const key = `contextConstant:${this.#checker.typeKeys.identityOf(declaration)}`;
    return this.#entryIndex(key, { kind: 'contextConstant', declaration });
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
      const variants = this.#variantsOf(closedOver(entry));
      if (this.#writtenFor.get(entry.index) !== variants) {
        this.#writtenFor.set(entry.index, variants);
        return entry;
      }
    }
    return undefined;
  }

  /** How many types a closing entry switches over: an `any` type's so far, a union's members. */
  #variantsOf(given: Type): number {
    const type = laidOutAs(given);
    if (type.kind === 'any') {
      return this.types.anyMembers(type).length;
    }
    return type.kind === 'union' ? this.types.unionMembers(type).length : 1;
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
  finish(main: FunctionId | undefined, jobServer: FunctionId | undefined): Tables {
    const functions = this.#functions.map((entry, index) => {
      if (entry === undefined) {
        unreachable(`Function ${index} was referenced but never lowered.`);
      }
      return entry;
    });
    return {
      modules: this.#modules,
      types: [...this.types.entries],
      functions,
      constants: this.#constants,
      starts: this.#starts,
      ...(main === undefined ? {} : { main }),
      ...(jobServer === undefined ? {} : { jobServer }),
    };
  }
}

/** The type whose variants a closing entry switches over: an `any` type, or a dispatch's union. */
function closedOver(entry: ClosingEntry): Type {
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
