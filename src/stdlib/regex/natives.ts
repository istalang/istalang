/**
 * The `regex` module's natives (regex.ista): RE2's engine through re2js, a pure JavaScript port
 * whose matching takes time linear in the text, so no pattern can make an instance hang.
 *
 * A regex is its pattern's text, so its compiled program derives from that text alone: it is
 * memoized by it, in a bounded cache every instance shares. An invalid pattern is an `Err` from
 * `parse`, and a panic everywhere else, since one written into the program is its bug (§3.12).
 *
 * re2js counts UTF-16 units and steps over code points, so positions convert to code points at
 * the edge (text/code-points.ts).
 */

import { LRUCache } from 'lru-cache';
import { RE2JS, RE2JSException } from 're2js';
import {
  fieldTypeOf,
  namedType,
  optionalOf,
  structOf,
  typeArgumentOf,
} from '../../definition/declared-values.ts';
import { mapOf } from '../../definition/equality.ts';
import type { TypeId } from '../../definition/operands.ts';
import type { TypeDefinition } from '../../definition/types.ts';
import type { Value } from '../../definition/values.ts';
import { type NativeContext, type Natives, Panic } from '../../runtime/natives.ts';
import { memo } from '../../structures/memo.ts';
import { codePointPositions } from '../../text/code-points.ts';
import {
  arrayOf,
  fieldNamed,
  okStruct,
  parseFailure,
  resultOk,
  resultOptional,
  resultTypeArgument,
  text,
} from '../native-values.ts';
import type { NativeKeys } from '../std-module.ts';
import { split } from './split.ts';

const regexTypeName = 'Regex';

/**
 * Each pattern's compiled program, or what is wrong with it: enough for a program's own patterns,
 * bounded for the ones that come from outside.
 */
const compiled = new LRUCache<string, RE2JS | string>({ max: 256 });

export const regexNatives = (keys: NativeKeys): Natives<NativeContext> => {
  const regex = keys.type(regexTypeName);
  return {
    [keys.ofStatic(regexTypeName, 'parse', 'string')]: ([source], context) => {
      const pattern = text(source);
      const program = compile(pattern);
      return typeof program === 'string'
        ? parseFailure(context, invalidPattern(pattern, program))
        : resultOk(context, okStruct(context, { pattern }));
    },
    [keys.of('test', regex, 'string')]: ([pattern, s], context) =>
      programOf(context, pattern).test(text(s)),
    [keys.of('find', regex, 'string')]: ([pattern, s], context) => {
      const whole = text(s);
      const [found] = programOf(context, pattern).matchAll(whole);
      const build = matchBuilder(context.types, resultTypeArgument(context, 0), whole);
      return resultOptional(context, found === undefined ? undefined : build(found));
    },
    [keys.of('findAll', regex, 'string')]: ([pattern, s], context) => {
      const whole = text(s);
      const build = matchBuilder(context.types, resultTypeArgument(context, 0), whole);
      return arrayOf([...programOf(context, pattern).matchAll(whole)].map(build));
    },
    [keys.of('replace', regex, 'string', 'string')]: ([pattern, s, replacement], context) =>
      programOf(context, pattern).matcher(text(s)).replaceFirst(text(replacement)),
    [keys.of('replaceAll', regex, 'string', 'string')]: ([pattern, s, replacement], context) =>
      programOf(context, pattern).matcher(text(s)).replaceAll(text(replacement)),
    [keys.of('split', regex, 'string')]: ([pattern, s], context) =>
      arrayOf(split(programOf(context, pattern), text(s))),
    [keys.of('escape', 'string')]: ([s]) => RE2JS.quote(text(s)),
  };
};

/** The compiled program of `pattern`, or what is wrong with it. */
function compile(pattern: string): RE2JS | string {
  return memo(compiled, pattern, () => {
    try {
      return RE2JS.compile(pattern);
    } catch (error) {
      if (error instanceof RE2JSException) {
        return error.message;
      }
      throw error;
    }
  });
}

/** What a parse's `Err` and a use's panic both say of an invalid `pattern`. */
function invalidPattern(pattern: string, reason: string): string {
  return `'${pattern}' is not a regular expression (${reason}).`;
}

/** The compiled program of a `Regex` argument, whose pattern must be valid. */
function programOf(context: Pick<NativeContext, 'types'>, regex: Value | undefined): RE2JS {
  const pattern = text(fieldNamed(context, regex, 'pattern'));
  const program = compile(pattern);
  if (typeof program === 'string') {
    throw new Panic(invalidPattern(pattern, program));
  }
  return program;
}

/** Builds each `Match` (type entry `match`) found in `whole`, given in the order they occur. */
function matchBuilder(
  types: readonly TypeDefinition[],
  match: TypeId,
  whole: string,
): (found: RegExpMatchArray) => Value {
  const capture = typeArgumentOf(types, namedType(fieldTypeOf(types, match, 'captures')), 0);
  const position = codePointPositions(whole);
  return (found) => {
    const [matched = '', ...groups] = found;
    const named = Object.entries(found.groups ?? {}).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    );
    return structOf(types, match, {
      text: matched,
      index: BigInt(position(found.index ?? 0)),
      captures: arrayOf(groups.map((group) => optionalOf(types, capture, group))),
      named: mapOf(named),
    });
  };
}
