/**
 * Code lowering writes with no syntax behind it: a type's codecs, the read of a host's extern
 * constant and a start wrapper (docs/arch/boundary.md), a dispatch on an `any` value's own type
 * (§8.3) and a plain function made async (functions/fits/index.ts). It takes every parameter and
 * computes no default, which is syntax: an entry with defaults is built behind its prologue
 * (functions/built-entries.ts), a host extern's wrapper among them.
 * It works through the same CodeContext as code with a body, so the helpers both share build its
 * variants and calls, and every instruction carries the span of the declaration it stands for,
 * which is where a trace through it points.
 *
 * Its registers are its parameters, in order, then its captures, each borrowed and typed by its
 * signature, then temporaries. A parameter it takes by `&`, as a dispatch does for a method's
 * `&self` (§8.2), holds a reference already, which it passes on as it is or into a part of it
 * (`passedOn`); a value it has no place for, a union member's one value (§4.2), it passes by `&`
 * from a cell of its own (`inCell`). It builds structs, tuples and `==` with the helpers code with
 * a body uses, so each instruction has one writer.
 */

import type { Argument } from '../../../definition/instructions/calls.ts';
import type { PlaceStep } from '../../../definition/instructions/places.ts';
import type { FunctionId, Register } from '../../../definition/operands.ts';
import type { CodeFunction, CodeMode } from '../../../definition/tables/functions.ts';
import type { TypeReference } from '../../../definition/tables/types.ts';
import type { Value } from '../../../definition/values/values.ts';
import type { Persistence } from '../../../foundation/language/well-known/index.ts';
import { resultVariants } from '../../../foundation/language/well-known/variants.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { Checker } from '../../checker/check.ts';
import type { AnonymousStructType, NominalType, Type } from '../../checker/types/type/index.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import { type ClosedCall, resultOfCall } from '../calls/closed-calls.ts';
import { emitCall, emitFunctionCall, referenceTo } from '../calls/emit-call.ts';
import { awaitFuture } from '../calls/waits.ts';
import type { CodeContext, Lowering } from '../context.ts';
import { codeEntry } from '../functions/code-entry.ts';
import { CodeWriter } from '../functions/code-writer.ts';
import { emitConstant } from '../tables/constants.ts';
import type { DefinitionTables, EntryHeader } from '../tables/tables.ts';
import { equal } from '../values/operators.ts';
import { construct, tupleOf } from '../values/struct-values.ts';
import { buildVariant, payloadOf, payloadOr } from '../values/variant-values.ts';

/** What a call names: an entry already numbered, or a closed call to number. */
type Callee = FunctionId | ClosedCall;

/** What synthesized code takes and gives, and how it runs. */
interface SynthesizedSignature {
  readonly parameters: readonly TypeReference[];
  readonly captures?: readonly TypeReference[];
  readonly result: TypeReference;
  readonly mode: CodeMode;
}

export class SynthesizedCode implements CodeContext {
  readonly checker: Checker;
  readonly tables: DefinitionTables;
  readonly code: CodeWriter;
  readonly parameters: readonly Register[];
  readonly captures: readonly Register[];
  readonly mode: CodeMode;
  /** Where every instruction points: the declaration the code stands for. */
  readonly span: AnchoredSpan;

  /** Code at `span` with `signature`, as a closure's entry when it has captures. */
  constructor(context: Lowering, span: AnchoredSpan, signature: SynthesizedSignature) {
    this.checker = context.checker;
    this.tables = context.tables;
    this.span = span;
    this.mode = signature.mode;
    this.code = new CodeWriter(signature.result);
    this.parameters = signature.parameters.map((type) => this.code.borrow(type));
    this.captures = (signature.captures ?? []).map((type) => this.code.borrow(type));
  }

  /** The reference of `type`, as registers state it. */
  typed(type: Type): TypeReference {
    return this.tables.types.reference(type);
  }

  waitingMode(): Persistence {
    return this.mode === 'simple' ? unreachable('Synthesized simple code waits.') : this.mode;
  }

  constant(value: Value, type: Type, span: AnchoredSpan = this.span): Register {
    return emitConstant(this, value, type, span);
  }

  /**
   * Calls `callee` with `values`, each a register or an argument as written; what it gives, of
   * `result`, which a closed call's own result type is unless given.
   */
  call(callee: Callee, values: readonly (Register | Argument)[], result?: Type): Register {
    const { span } = this;
    if (typeof callee === 'number') {
      const given = result ?? unreachable('A call of a numbered entry names its result.');
      return emitCall(this, { span, callee, arguments: values }, this.typed(given));
    }
    const reference = this.typed(result ?? resultOfCall(this.checker, callee));
    return emitFunctionCall(this, { span, call: callee, arguments: values }, reference);
  }

  variant(type: NominalType, name: string, fields: readonly Register[]): Register {
    return buildVariant(this, { type, name, fields }, this.span);
  }

  /** A struct of `type`, each field taken by its name from `named` (structs.ts). */
  struct(type: NominalType | AnonymousStructType, named: ReadonlyMap<string, Register>): Register {
    return construct(this, type, named, this.span);
  }

  /** An array of `type` of `items`, moved in. */
  array(items: readonly Register[], type: Type): Register {
    const { code } = this;
    const dst = code.allocate(this.typed(type));
    const elements = items.map((value) => ({ value: code.take(value, this.span), spread: false }));
    code.emit({ kind: 'array', span: this.span, dst, elements });
    return dst;
  }

  /** A `Map` of `type` of `entries`, moved in. */
  map(entries: readonly (readonly [key: Register, value: Register])[], type: Type): Register {
    const { code, span } = this;
    const dst = code.allocate(this.typed(type));
    const written = entries.map(([key, value]) => ({
      kind: 'entry' as const,
      key: code.take(key, span),
      value: code.take(value, span),
    }));
    code.emit({ kind: 'map', span, dst, entries: written });
    return dst;
  }

  tuple(elements: readonly Register[]): Register {
    return tupleOf(this, elements, this.span);
  }

  equal(left: Register, right: Register): Register {
    return equal(this, this.span, [left, right]);
  }

  /**
   * Its parameter `index` as it passes it on: one it takes by `&` as the reference it holds, or a
   * reference into the part at `path`, of `type`; any other by value.
   */
  passedOn(index: number, path: readonly PlaceStep[] = [], type?: Type): Argument {
    const register =
      this.parameters[index] ?? unreachable(`Synthesized code has no parameter ${index}.`);
    if (path.length === 0 || type === undefined) {
      return { kind: 'value', register };
    }
    const dst = this.code.borrow({ kind: 'reference', to: this.typed(type) });
    this.code.emit({
      kind: 'reference',
      span: this.span,
      dst,
      place: { root: { kind: 'reference', register }, path: [...path] },
    });
    return { kind: 'value', register: dst };
  }

  /** `value`, of `type`, moved into a cell of its own, which it is passed by `&` from. */
  inCell(value: Register, type: Type): Argument {
    const { code, span } = this;
    const cell = code.allocate(this.typed(this.checker.cellOf(type)));
    code.emit({ kind: 'newCell', span, dst: cell, value: code.take(value, span) });
    return { kind: 'value', register: referenceTo(this, cell, this.typed(type), span) };
  }

  /** Borrows element `index`, of `type`, of the tuple in `value`. */
  tupleItem(value: Register, index: number, type: Type): Register {
    return this.code.tupleItem(value, index, this.typed(type), this.span);
  }

  /** Borrows field `index`, of `type`, of the struct in `value`. */
  structField(value: Register, index: number, type: Type): Register {
    return this.code.structField(value, index, this.typed(type), this.span);
  }

  /** Borrows field `index`, of `type`, of the variant `variant` the enum value in `value` holds. */
  variantField(value: Register, variant: number, index: number, type: Type): Register {
    return this.code.variantField(value, { variant, field: index }, this.typed(type), this.span);
  }

  /**
   * The value an `Ok` in `result`, of the `Result` type `type`, holds; for an `Err`, `failed`
   * writes what happens to its `Error`, and must leave the code.
   */
  ok(result: Register, type: NominalType, failed: (error: Register) => void): Register {
    const tested = { register: result, type, name: resultVariants.ok };
    const error = { register: result, type, name: resultVariants.err };
    return payloadOr(this, tested, () => failed(payloadOf(this, error, this.span)), this.span);
  }

  /** The value of the future in `future`, of type `type`, awaited. */
  await(future: Register, type: Type): Register {
    return awaitFuture(this, { future, type, mode: this.waitingMode() }, this.span);
  }

  return(value: Register): void {
    this.code.return(value, this.span);
  }

  /** The finished entry, named and placed by `header`. */
  entry(header: EntryHeader): CodeFunction {
    return codeEntry(this.code, {
      header,
      mode: this.mode,
      parameters: this.parameters.map(() => ({ hasDefault: false })),
      captures: this.captures.length,
      tree: this.tables.treeAt(header.module),
      span: this.span,
    });
  }
}
