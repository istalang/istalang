/**
 * Code lowering writes with no syntax behind it (docs/arch/boundary.md): a type's codecs, a host
 * extern's wrapper, a start wrapper. It works through the same CodeContext as code with a body, so
 * the helpers both share build its variants and calls, and every instruction carries the span of
 * the declaration it stands for, which is where a trace through it points.
 *
 * Its registers are its parameters, in order, then temporaries; it captures nothing, and holds no
 * cells, since it never takes a value by `&`.
 */

import type { CodeFunction } from '../../../definition/functions.ts';
import type { FunctionId, Register } from '../../../definition/operands.ts';
import type { Value } from '../../../definition/values.ts';
import { resultVariants } from '../../../language/well-known.ts';
import type { Span } from '../../../text/span.ts';
import type { Checker } from '../../checker/check.ts';
import type { FunctionCall } from '../../checker/resolved-call.ts';
import type { AnonymousStructType, NominalType } from '../../checker/types/type.ts';
import { CodeWriter } from '../code-writer.ts';
import type { CodeContext } from '../context.ts';
import { emitCall } from '../emit-call.ts';
import {
  branchOnVariant,
  buildVariant,
  payloadOf,
  variantTestOf,
} from '../expressions/variants.ts';
import { instanceOfCall } from '../instances.ts';
import type { DefinitionTables, EntryHeader } from '../tables.ts';

/** What a call names: an entry already numbered, or a closed call to number. */
export type Callee = FunctionId | FunctionCall;

export class SynthesizedCode implements CodeContext {
  readonly checker: Checker;
  readonly tables: DefinitionTables;
  readonly code = new CodeWriter();
  readonly parameters: readonly Register[];
  /** Where every instruction points: the declaration the code stands for. */
  readonly span: Span;

  constructor(context: Pick<CodeContext, 'checker' | 'tables'>, span: Span, parameters: number) {
    this.checker = context.checker;
    this.tables = context.tables;
    this.span = span;
    this.parameters = Array.from({ length: parameters }, () => this.code.allocate());
  }

  constant(value: Value): Register {
    const dst = this.code.allocate();
    this.code.emit({
      kind: 'constant',
      span: this.span,
      dst,
      constant: this.tables.constant(value),
    });
    return dst;
  }

  call(callee: Callee, values: readonly Register[]): Register {
    return emitCall(this, { span: this.span, callee: this.#indexOf(callee), arguments: values });
  }

  variant(type: NominalType, name: string, fields: readonly Register[]): Register {
    return buildVariant(this, { type, name }, fields, this.span);
  }

  struct(type: NominalType | AnonymousStructType, fields: readonly Register[]): Register {
    const dst = this.code.allocate();
    this.code.emit({
      kind: 'struct',
      span: this.span,
      dst,
      type: this.tables.types.index(type),
      fields: [...fields],
    });
    return dst;
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
    const dst = this.code.allocate();
    this.code.emit({ kind: 'tuple', span: this.span, dst, elements: [...elements] });
    return dst;
  }

  equal(left: Register, right: Register): Register {
    const dst = this.code.allocate();
    this.code.emit({ kind: 'equal', span: this.span, dst, left, right });
    return dst;
  }

  /** Field `index` of the struct, variant or tuple in `value`. */
  field(value: Register, index: number): Register {
    const dst = this.code.allocate();
    this.code.emit({ kind: 'field', span: this.span, dst, src: value, index });
    return dst;
  }

  /**
   * The value an `Ok` in `result`, of the `Result` type `type`, holds; for an `Err`, `failed`
   * writes what happens to its `Error`, and must leave the code.
   */
  ok(result: Register, type: NominalType, failed: (error: Register) => void): Register {
    const ok = this.code.newLabel();
    const err = this.code.newLabel();
    branchOnVariant(
      this,
      variantTestOf(this.checker, result, type, resultVariants.ok),
      { matched: ok, otherwise: err },
      this.span,
    );
    this.code.place(err);
    failed(payloadOf(this, result, this.span));
    this.code.place(ok);
    return payloadOf(this, result, this.span);
  }

  await(future: Register): Register {
    const dst = this.code.allocate();
    this.code.await(dst, future, this.span);
    return dst;
  }

  return(value: Register): void {
    this.code.emit({ kind: 'return', span: this.span, value });
  }

  /** The finished entry, named and placed by `header`. */
  entry(header: EntryHeader, isAsync: boolean): CodeFunction {
    const { registers, instructions } = this.code.finish();
    return {
      kind: 'code',
      ...header,
      async: isAsync,
      parameters: this.parameters.map(() => ({ reference: false })),
      captures: 0,
      registers,
      cells: [],
      instructions,
    };
  }

  #indexOf(callee: Callee): FunctionId {
    return typeof callee === 'number' ? callee : this.tables.functionIndex(instanceOfCall(callee));
  }
}
