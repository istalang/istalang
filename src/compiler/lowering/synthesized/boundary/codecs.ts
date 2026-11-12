/**
 * The derived codecs (§9; docs/arch/boundary.md): the body of each `json._toJson<T>` and
 * `json._fromJson<T>` instance, written from `T`'s derived form (checker
 * rules/boundary/json-forms.ts).
 *
 * Writing (encoder.ts) and reading (decoder.ts) take a form apart the same way: a struct, an enum
 * and a tuple part by part, each through its own type's codec, and a host type through the json
 * module's helper. A recursive type's derived codecs call themselves. Which way an instance goes
 * is which function it is (tables/own-entries.ts); what it takes and gives are that function's own.
 */

import type { CodeFunction } from '../../../../definition/tables/functions.ts';
import { unreachable } from '../../../../foundation/structures/unreachable.ts';
import type { Checker } from '../../../checker/check.ts';
import type { DerivedForm, JsonDirection } from '../../../checker/surface/json-form.ts';
import { type FunctionInstance, substitutionOf } from '../../../checker/surface/witness-closing.ts';
import { substitute } from '../../../checker/types/parts/substitution.ts';
import type { Type } from '../../../checker/types/type/index.ts';
import type { DefinitionTables } from '../../tables/tables.ts';
import { SynthesizedCode } from '../index.ts';
import { Decoder } from './decoder.ts';
import { Encoder } from './encoder.ts';

/** What writing a codec reads: the checker, the tables, and the instance whose body it is. */
export interface CodecLowering {
  readonly checker: Checker;
  readonly tables: DefinitionTables;
  readonly instance: FunctionInstance;
}

/** How each way's body is written from a form, into `code` giving `result`: a Json, or a Result. */
const bodyWriters = {
  write: (code, result, form) => new Encoder(code, result).write(form),
  read: (code, result, form) =>
    new Decoder(
      code,
      result.kind === 'nominal' ? result : unreachable('A decoder returns a Result.'),
    ).read(form),
} as const satisfies Record<
  JsonDirection,
  (code: SynthesizedCode, result: Type, form: DerivedForm) => void
>;

/** The entry of a derived codec instance, which crosses `direction`. */
export function derivedCodecEntry(lowering: CodecLowering, direction: JsonDirection): CodeFunction {
  const { checker, tables, instance } = lowering;
  const [type] = instance.typeArguments;
  if (type === undefined) {
    unreachable('A derived codec instance has no type argument.');
  }
  const { declaration } = instance;
  const parameters = checker.parametersOf(declaration).length;
  const code = new SynthesizedCode(lowering, declaration.name.span, parameters);
  const result = substitute(
    checker.resultOf(declaration),
    substitutionOf(instance),
    checker.typeRules,
  );
  bodyWriters[direction](code, result, checker.json.formOf(type));
  return code.entry(tables.entryHeader(instance), 'simple');
}
