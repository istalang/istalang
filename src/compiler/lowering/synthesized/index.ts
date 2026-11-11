/**
 * Code lowering writes with no syntax behind it: a type's codecs, the read of a host's extern
 * constant and a start wrapper (docs/arch/boundary.md), a dispatch on an `any` value's own type
 * (§3.10) and a plain function made async (functions/fits/index.ts). It takes every parameter and
 * computes no default, which is syntax: an entry with defaults is built behind its prologue
 * (functions/built-entries.ts), a host extern's wrapper among them.
 * It works through the same CodeContext as code with a body, so the helpers both share build its
 * variants and calls, and every instruction carries the span of the declaration it stands for,
 * which is where a trace through it points.
 *
 * Its registers are its parameters, in order, then its captures, then temporaries. A parameter it
 * takes by `&`, as a dispatch does for a method's `&self` (§3.10), holds a reference already, which
 * it passes on by `&` as it is or into a part of it (`passedOn`); a value it has no place for, a
 * union member's one value (§6), it passes by `&` from a cell of its own (`inCell`). It
 * builds structs, tuples and `==` with the helpers code with a body uses, so each instruction has
 * one writer.
 */

import type { Argument } from '../../../definition/instructions/places.ts';
import type { FunctionId, Register } from '../../../definition/operands.ts';
import type { CodeFunction, CodeMode } from '../../../definition/tables/functions.ts';
import type { Value } from '../../../definition/values/values.ts';
import { resultVariants } from '../../../foundation/language/well-known/variants.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { Checker } from '../../checker/check.ts';
import type { AnonymousStructType, NominalType, Type } from '../../checker/types/type/index.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import type { ClosedCall } from '../calls/closed-calls.ts';
import { emitCall, emitFunctionCall } from '../calls/emit-call.ts';
import { awaitFuture } from '../calls/waits.ts';
import { tupleOf } from '../constructs/expressions/literals/tuples.ts';
import { equal } from '../constructs/expressions/operators.ts';
import { payloadOf, payloadOr } from '../constructs/expressions/structs/variants.ts';
import type { CellRegister } from '../constructs/statements/variables.ts';
import type { CodeContext } from '../context.ts';
import { CodeWriter } from '../functions/code-writer.ts';
import { emitConstant } from '../tables/constants.ts';
import type { DefinitionTables, EntryHeader } from '../tables/tables.ts';
import { construct } from '../values/struct-values.ts';
import { buildVariant } from '../values/variant-values.ts';

/** What a call names: an entry already numbered, or a closed call to number. */
export type Callee = FunctionId | ClosedCall;

export class SynthesizedCode implements CodeContext {
  readonly checker: Checker;
  readonly tables: DefinitionTables;
  readonly code = new CodeWriter();
  readonly parameters: readonly Register[];
  readonly captures: readonly Register[];
  readonly #cells: CellRegister[] = [];
  /** Where every instruction points: the declaration the code stands for. */
  readonly span: AnchoredSpan;

  /**
   * Code at `span` taking `parameters` arguments, then `captures` captures, as a closure's entry.
   */
  constructor(
    context: Pick<CodeContext, 'checker' | 'tables'>,
    span: AnchoredSpan,
    parameters: number,
    captures = 0,
  ) {
    this.checker = context.checker;
    this.tables = context.tables;
    this.span = span;
    this.parameters = Array.from({ length: parameters }, () => this.code.allocate());
    this.captures = Array.from({ length: captures }, () => this.code.allocate());
  }

  constant(value: Value, span: AnchoredSpan = this.span): Register {
    return emitConstant(this, value, span);
  }

  /** Calls `callee` with `values`, each a register passed by value or an argument as written. */
  call(callee: Callee, values: readonly (Register | Argument)[]): Register {
    const { span } = this;
    return typeof callee === 'number'
      ? emitCall(this, { span, callee, arguments: values })
      : emitFunctionCall(this, { span, call: callee, arguments: values });
  }

  variant(type: NominalType, name: string, fields: readonly Register[]): Register {
    return buildVariant(this, { type, name, fields }, this.span);
  }

  /** A struct of `type`, each field taken by its name from `named` (structs.ts). */
  struct(type: NominalType | AnonymousStructType, named: ReadonlyMap<string, Register>): Register {
    return construct(this, type, named, this.span);
  }

  array(items: readonly Register[]): Register {
    const dst = this.code.allocate();
    const elements = items.map((value) => ({ kind: 'item' as const, value }));
    this.code.emit({ kind: 'array', span: this.span, dst, elements });
    return dst;
  }

  map(entries: readonly (readonly [key: Register, value: Register])[]): Register {
    const dst = this.code.allocate();
    const written = entries.map(([key, value]) => ({ kind: 'entry' as const, key, value }));
    this.code.emit({ kind: 'map', span: this.span, dst, entries: written });
    return dst;
  }

  tuple(elements: readonly Register[]): Register {
    return tupleOf(this, elements, this.span);
  }

  equal(left: Register, right: Register): Register {
    return equal(this, this.span, [left, right]);
  }

  /**
   * Its parameter `index` as it passes it on: one it takes by `&`, as `references` says, by `&`,
   * as it is or into its part at `path`; any other by value.
   */
  passedOn(index: number, references: readonly boolean[], path: readonly number[] = []): Argument {
    const register =
      this.parameters[index] ?? unreachable(`Synthesized code has no parameter ${index}.`);
    return references[index] === true
      ? { kind: 'reference', place: { register, path: [...path] } }
      : { kind: 'value', register };
  }

  /** `value`, of `type`, moved into a cell of its own, which it is passed by `&` from. */
  inCell(value: Register, type: Type): Argument {
    const register = this.code.allocate();
    this.#cells.push({ register, type: this.tables.types.index(this.checker.cellOf(type)) });
    this.code.emit({ kind: 'move', span: this.span, dst: register, src: value });
    return { kind: 'reference', place: { register, path: [] } };
  }

  /** Field `index` of the struct, variant or tuple in `value`. */
  field(value: Register, index: number): Register {
    return this.code.field(value, index, this.span);
  }

  /**
   * The value an `Ok` in `result`, of the `Result` type `type`, holds; for an `Err`, `failed`
   * writes what happens to its `Error`, and must leave the code.
   */
  ok(result: Register, type: NominalType, failed: (error: Register) => void): Register {
    const tested = { register: result, type, name: resultVariants.ok };
    return payloadOr(this, tested, () => failed(payloadOf(this, result, this.span)), this.span);
  }

  /** The value of the future in `future`, of type `type`, awaited. */
  await(future: Register, type: Type): Register {
    return awaitFuture(this, future, type, this.span);
  }

  return(value: Register): void {
    this.code.emit({ kind: 'return', span: this.span, value });
  }

  /**
   * The finished entry, named and placed by `header`; `references` says which parameters are `&`.
   */
  entry(header: EntryHeader, mode: CodeMode, references: readonly boolean[] = []): CodeFunction {
    const { registers, instructions } = this.code.finish(this.tables.treeAt(header.module));
    return {
      kind: 'code',
      ...header,
      mode,
      parameters: this.parameters.map((_, index) => ({
        reference: references[index] === true,
        hasDefault: false,
      })),
      captures: this.captures.length,
      registers,
      cells: [...this.#cells],
      instructions,
    };
  }
}
