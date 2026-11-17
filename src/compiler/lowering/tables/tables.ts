/**
 * The tables a Definition is assembled from, each entry made once (docs/arch/definition.md).
 *
 * - Function instances (instances.ts) are numbered when first referenced and lowered afterwards
 *   (function-table.ts). Only what `main` reaches is lowered: generics are compiled per
 *   instantiation (§3.5), which only reachability can enumerate.
 * - An entry is keyed by its kind and its identity within it, which the kind table gives
 *   (entries.ts), so one asked for twice is one entry.
 * - Types and constants are interned: one entry per distinct type (type-table/) or value, a
 *   value keyed by its persisted text.
 * - An entry the std alone decides, which a program over the same std lowered before, is taken over
 *   from it (std-lowering.ts) in place of being lowered, and once the program is lowered, its own
 *   such entries are offered to the programs after it.
 */

import { z } from 'zod';
import { encodeJson } from '../../../definition/formats/codec.ts';
import type { FunctionId } from '../../../definition/operands.ts';
import type { FunctionDefinition } from '../../../definition/tables/functions.ts';
import type { Definition, Purpose } from '../../../definition/tables/index.ts';
import { type Value, value } from '../../../definition/values/values.ts';
import { memo } from '../../../foundation/structures/memo.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import { lineMapOf } from '../../../foundation/text/line-map.ts';
import type { Checker } from '../../checker/check.ts';
import { functionPlace } from '../../checker/surface/checked-annotation.ts';
import { passesAll } from '../../checker/surface/resolved-call.ts';
import type { FunctionInstance } from '../../checker/surface/witness-closing.ts';
import { type ModuleId, programModule } from '../../program/program.ts';
import type { ContextConstantDeclaration } from '../../syntax/declarations/index.ts';
import type { SyntaxTree } from '../../syntax/tree/index.ts';
import { type AnchoredSpan, spanIn } from '../../syntax/tree/positions.ts';
import { type ClosedCall, leavesOut } from '../calls/closed-calls.ts';
import { nestedSpanOf } from '../functions/bodies.ts';
import { annotationValues } from './constants.ts';
import {
  type EntryIdentities,
  type HostExternDeclaration,
  identityOf,
  type LoweredEntry,
  type StartTarget,
} from './entries.ts';
import { type EntryKeys, entryKeysOf } from './entry-keys.ts';
import { FunctionTable, firstPending, type PendingOrder } from './function-table.ts';
import {
  type BodyOwner,
  instanceName,
  type NestedInstance,
  nestedName,
  ownerDeclaration,
} from './instances.ts';
import type { KeptEntries } from './kept-entries.ts';
import { orderedByKeys } from './key-order.ts';
import { qualifiedNameOf } from './names.ts';
import { ownEntryOf } from './own-entries.ts';
import { type TableRequest, TableRequests } from './requests.ts';
import { StdReuse } from './std-reuse.ts';
import { holdsStandIn, Stencils } from './stencils.ts';
import { TypeTable } from './type-table/index.ts';

/** What every function-table entry starts with: its name, and where it is declared. */
export type EntryHeader = Pick<FunctionDefinition, 'name' | 'module' | 'span' | 'annotations'>;

export class DefinitionTables {
  readonly #checker: Checker;
  readonly types: TypeTable;
  readonly #modules: (Definition['modules'][number] & { readonly id: ModuleId })[] = [];
  readonly #moduleIndexes = new Map<ModuleId, number>();
  readonly #constants: Value[] = [];
  readonly #constantIndexes = new Map<string, number>();
  readonly #functions: FunctionTable;
  readonly #identities: EntryIdentities;
  readonly #keys: EntryKeys;
  readonly #starts: Definition['starts'][number][] = [];
  /** How instances are shared (stencils.ts). */
  readonly #stencils: Stencils;
  /** Each instance entry as shared, by its own key, with what sharing it asked of the tables. */
  readonly #sharedEntries = new Map<
    string,
    { readonly entry: LoweredEntry; readonly requests: readonly TableRequest[] }
  >();
  readonly #requests = new TableRequests();
  /** Entries taken over from programs over the same std, and offered to them (std-reuse.ts). */
  readonly #std: StdReuse;

  /** Whether the Definition runs tests, whose functions' slots may be rebound (§10). */
  readonly rebindable: boolean;

  /**
   * Tables for `checker`'s program, telling entries apart by the kind table's `identities`, taking
   * over the entries `kept` holds.
   */
  constructor(
    checker: Checker,
    {
      rebindable,
      identities,
      kept,
      order = firstPending,
    }: {
      readonly rebindable: boolean;
      readonly identities: EntryIdentities;
      readonly kept: KeptEntries;
      readonly order?: PendingOrder;
    },
  ) {
    this.#checker = checker;
    this.rebindable = rebindable;
    this.#identities = identities;
    this.#keys = entryKeysOf(checker);
    const requests = this.#requests;
    this.types = new TypeTable(
      checker,
      {
        functionIndex: (instance) => this.index({ kind: 'instance', instance }),
        callIndex: (call) => this.callIndex(call),
        annotationValues: (annotations) => annotationValues(this, annotations),
        holdsStandIn: (type) => holdsStandIn(checker, type),
      },
      requests,
    );
    this.#stencils = new Stencils(checker, this.types);
    this.#functions = new FunctionTable({
      identities,
      keys: this.#keys,
      types: this.types,
      requests,
      order,
    });
    this.#std = new StdReuse(kept, {
      checker,
      identities,
      functions: this.#functions,
      types: this.types,
      requests,
      constant: (contents) => this.constant(contents),
      moduleIndex: (module) => this.moduleIndex(module),
    });
  }

  /** The index of `module` in the module table, with its line starts for spans. */
  moduleIndex(module: ModuleId): number {
    const index = memo(this.#moduleIndexes, module, () => this.#addModule(module));
    this.#requests.record('module', index);
    return index;
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
    const index = memo(this.#constantIndexes, key, () => this.#constants.push(contents) - 1);
    this.#requests.record('constant', index);
    return index;
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
      ),
    };
  }

  /** The header of a nested function's entry: named after its owner, where its node is. */
  nestedHeader(nested: NestedInstance): EntryHeader {
    const module = this.#checker.moduleOf(ownerDeclaration(nested.owner));
    const at = nestedSpanOf(this.#checker.program, module, nested.node);
    return this.#ownedHeader(nested.owner, at, (where) => nestedName(this.#checker, nested, where));
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
        : this.index({ kind: 'instance', instance: call.instance });
    }
    if (!passesAll(call.binding)) {
      unreachable(
        'A requirement is never spawned or named as a value with its arguments reordered.',
      );
    }
    return this.index({ kind: 'dispatch', dispatch: call.dispatch });
  }

  /**
   * The index of `entry`, numbered the first time it is asked for, then lowered from the worklist,
   * or, a closing entry, written once the worklist is empty and again as its `any` type grows.
   */
  index(given: LoweredEntry): FunctionId {
    this.#refuseStandInConversion(given);
    const entry = this.#shared(given);
    return this.#std.index(this.#keyOf(entry), entry);
  }

  /** The index of `entry`; undefined while nothing asked for it. */
  numbered(entry: LoweredEntry): FunctionId | undefined {
    return this.#functions.numbered(this.#keyOf(this.#shared(entry)));
  }

  /** What tells `entry` apart from every other: its kind, then its identity within it. */
  #keyOf(entry: LoweredEntry): string {
    const { identity } = identityOf(this.#identities, entry);
    return `${entry.kind}:${identity(this.#keys, entry)}`;
  }

  /** `entry` as it is keyed and lowered: an instance as shared (stencils.ts). */
  #shared(entry: LoweredEntry): LoweredEntry {
    if (entry.kind !== 'instance' && entry.kind !== 'externDefaults') {
      return entry;
    }
    const key = this.#keyOf(entry);
    const known = this.#sharedEntries.get(key);
    if (known !== undefined) {
      this.#requests.replayed(known.requests);
      return known.entry;
    }
    const { result, requests } = this.#requests.captured(
      (): LoweredEntry => ({ ...entry, instance: this.#stencils.shared(entry.instance) }),
    );
    this.#sharedEntries.set(key, { entry: result, requests });
    return result;
  }

  /**
   * Crashes where a conversion of parts meets a shared instance's stand-in: lowering derives its
   * rebuild from the two types' shapes, which parametricity keeps every parameter of concrete
   * (stencils.ts `holdsStandIn`).
   */
  #refuseStandInConversion(entry: LoweredEntry): void {
    const converting = entry.kind === 'converting' || entry.kind === 'wrapping';
    if (
      converting &&
      (holdsStandIn(this.#checker, entry.from) || holdsStandIn(this.#checker, entry.to))
    ) {
      unreachable(`A conversion of ${entry.kind} parts meets a shared instance's stand-in.`);
    }
  }

  /**
   * The index a call leaving parameters of `instance` out calls (§3.3): its own entry, which
   * computes them; for an extern bound to its native, which computes nothing, an entry computing
   * them, then calling it (own-entries.ts).
   */
  leavingOutIndex(instance: FunctionInstance): FunctionId {
    const native = ownEntryOf(this.#checker, instance).kind === 'native';
    return this.index({ kind: native ? 'externDefaults' : 'instance', instance });
  }

  /** The index of the entry a host starts `target` through, listed under `key` (§9). */
  startIndex(target: StartTarget, key: string): FunctionId {
    const index = this.index({ kind: 'start', target });
    const encode = this.index({ kind: 'startEncode', target });
    if (!this.#starts.some((start) => start.function === index)) {
      this.#starts.push({ key, function: index, encode });
    }
    return index;
  }

  /** Lowers, by `lowerEntry`, every entry asked for so far and every entry those ask for. */
  lowerReached(lowerEntry: (entry: LoweredEntry) => FunctionDefinition): void {
    this.#functions.lowerReached(lowerEntry);
  }

  /** The finished tables, every referenced function lowered, for `purpose`, numbered by key. */
  finish(purpose: Purpose): Definition {
    const { functions, keys } = this.#functions.finished();
    this.#std.offer({ functionKeys: keys, modules: this.#modules, constants: this.#constants });
    return orderedByKeys(
      {
        modules: this.#modules,
        types: [...this.types.entries],
        functions,
        constants: this.#constants,
        starts: this.#starts,
        purpose,
      },
      { functions: keys, types: this.types.keys },
    );
  }
}
