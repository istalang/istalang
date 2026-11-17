/**
 * The tables a Definition is assembled from, each entry made once (docs/arch/definition.md).
 *
 * - Function instances (instances.ts) are numbered when first referenced and lowered afterwards
 *   from a worklist, so a call can name one that isn't lowered yet, including itself. Only what
 *   `main` reaches is lowered: generics are compiled per instantiation (§3.5), which only
 *   reachability can enumerate.
 * - An entry is numbered by its kind and its identity within it, which the kind table gives
 *   (entries.ts), so one asked for twice is one entry.
 * - Types and constants are interned: one entry per distinct type (type-table.ts) or value, a
 *   value keyed by its persisted text.
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
import type { Type } from '../../checker/types/type/index.ts';
import { type ModuleId, programModule } from '../../program/program.ts';
import type { ContextConstantDeclaration } from '../../syntax/declarations/index.ts';
import type { SyntaxTree } from '../../syntax/tree/index.ts';
import { type AnchoredSpan, spanIn } from '../../syntax/tree/positions.ts';
import { type ClosedCall, leavesOut } from '../calls/closed-calls.ts';
import { nestedSpanOf } from '../functions/bodies.ts';
import { laidOutAs } from '../values/members/holdings.ts';
import { annotationValues } from './constants.ts';
import {
  type EntryIdentities,
  type HostExternDeclaration,
  identityOf,
  type LoweredEntry,
  type StartTarget,
} from './entries.ts';
import {
  type BodyOwner,
  instanceName,
  type NestedInstance,
  nestedName,
  ownerDeclaration,
} from './instances.ts';
import { qualifiedNameOf } from './names.ts';
import { ownEntryOf } from './own-entries.ts';
import { TypeTable } from './type-table.ts';

/** What every function-table entry starts with: its name, and where it is declared. */
export type EntryHeader = Pick<FunctionDefinition, 'name' | 'module' | 'span' | 'annotations'>;

/** An entry with the index it was numbered. */
type Numbered = LoweredEntry & { readonly index: FunctionId };

export class DefinitionTables {
  readonly #checker: Checker;
  readonly types: TypeTable;
  readonly #modules: (Definition['modules'][number] & { readonly id: ModuleId })[] = [];
  readonly #moduleIndexes = new Map<ModuleId, number>();
  readonly #constants: Value[] = [];
  readonly #constantIndexes = new Map<string, number>();
  readonly #functions: (FunctionDefinition | undefined)[] = [];
  readonly #functionIndexes = new Map<string, FunctionId>();
  readonly #identities: EntryIdentities;
  readonly #pending: Numbered[] = [];
  readonly #closing: Numbered[] = [];
  /** How many variants its `any` type had when each closing entry was last written. */
  readonly #writtenFor = new Map<FunctionId, number>();
  readonly #starts: Definition['starts'][number][] = [];

  /** Whether the Definition runs tests, whose functions a mock may replace (§10). */
  readonly mocking: boolean;

  /** Tables for `checker`'s program, telling entries apart by the kind table's `identities`. */
  constructor(
    checker: Checker,
    { mocking, identities }: { readonly mocking: boolean; readonly identities: EntryIdentities },
  ) {
    this.#checker = checker;
    this.mocking = mocking;
    this.#identities = identities;
    this.types = new TypeTable(checker, {
      functionIndex: (instance) => this.index({ kind: 'instance', instance }),
      callIndex: (call) => this.callIndex(call),
      hostNativeIndex: (declaration) => this.index({ kind: 'hostNative', declaration }),
      annotationValues: (annotations) => annotationValues(this, annotations),
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
  index(entry: LoweredEntry): FunctionId {
    const { identity, closedOver } = identityOf(this.#identities, entry);
    const key = `${entry.kind}:${identity(this.#checker.typeKeys, entry)}`;
    const queue = closedOver === undefined ? this.#pending : this.#closing;
    return this.#numbered(key, (index) => queue.push({ ...entry, index }));
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

  /**
   * The next referenced entry still to be lowered, with its index: one lowering reached, then,
   * once none is left, a closing entry not yet written for every variant its `any` type has.
   */
  nextPending(): Numbered | undefined {
    return this.#pending.shift() ?? this.#nextStale();
  }

  #nextStale(): Numbered | undefined {
    for (const entry of this.#closing) {
      const { closedOver } = identityOf(this.#identities, entry);
      const variants = this.#variantsOf(
        closedOver?.(entry) ?? unreachable('A closing entry closes over a type.'),
      );
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

  /** The finished tables, every referenced function lowered, for `purpose`. */
  finish(purpose: Purpose): Definition {
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
      purpose,
    };
  }
}
