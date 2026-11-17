/**
 * The `regex` module's natives (regex.ista): RE2's engine through re2js, a pure JavaScript port
 * whose matching takes time linear in the text, so no pattern can make an instance hang.
 *
 * A regex is its pattern's text, so its compiled program derives from that text alone: it is
 * memoized by it, in a bounded cache every instance shares. An invalid pattern is an `Err` from
 * `parse`, and a panic everywhere else, since one written into the program is its bug (§3.12).
 *
 * re2js counts UTF-16 units and steps over code points, so positions convert to code points at
 * the edge (foundation/text/code-points.ts).
 */

import { LRUCache } from 'lru-cache';
import { RE2JS, RE2JSException } from 're2js';
import type { NativeKeys } from '../../definition/extern-key.ts';
import type { TypeId } from '../../definition/operands.ts';
import type { TypeDefinition } from '../../definition/tables/types.ts';
import { fieldValueOf, structOf } from '../../definition/values/declared-values.ts';
import { closureFreeMap } from '../../definition/values/equality.ts';
import type { Value } from '../../definition/values/values.ts';
import { memo } from '../../foundation/structures/memo.ts';
import { codePointPositions } from '../../foundation/text/code-points.ts';
import { type NativeContext, type Natives, Panic } from '../../runtime/natives.ts';
import { arrayOf, int, text } from '../values/arguments.ts';
import { resultTypeArgument } from '../values/results.ts';
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
    [keys.ofStatic(regexTypeName, '_problem', 'String')]: ([source]) => {
      const program = compile(text(source));
      return typeof program === 'string' ? program : '';
    },
    [keys.of('test', regex, 'String')]: ([pattern, s], context) =>
      programOf(context, pattern).test(text(s)),
    [keys.of('_found', regex, 'String', 'Int')]: ([pattern, s, count], context) => {
      const whole = text(s);
      const build = foundBuilder(context.types, resultTypeArgument(context, 0), whole);
      const limit = int(count) < 0n ? Number.POSITIVE_INFINITY : Number(int(count));
      const taken: Value[] = [];
      for (const match of programOf(context, pattern).matchAll(whole)) {
        if (taken.length >= limit) {
          break;
        }
        taken.push(build(match));
      }
      return arrayOf(taken);
    },
    [keys.of('replace', regex, 'String', 'String')]: ([pattern, s, replacement], context) =>
      programOf(context, pattern).matcher(text(s)).replaceFirst(text(replacement)),
    [keys.of('replaceAll', regex, 'String', 'String')]: ([pattern, s, replacement], context) =>
      programOf(context, pattern).matcher(text(s)).replaceAll(text(replacement)),
    [keys.of('split', regex, 'String')]: ([pattern, s], context) =>
      arrayOf(split(programOf(context, pattern), text(s))),
    [keys.of('escape', 'String')]: ([s]) => RE2JS.quote(text(s)),
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
  const pattern = text(fieldValueOf(context.types, regex, 'pattern'));
  const program = compile(pattern);
  if (typeof program === 'string') {
    throw new Panic(invalidPattern(pattern, program));
  }
  return program;
}

/** Builds each `_Found` (type entry `found`) in `whole`, given in the order they occur. */
function foundBuilder(
  types: readonly TypeDefinition[],
  found: TypeId,
  whole: string,
): (match: RegExpMatchArray) => Value {
  const position = codePointPositions(whole);
  return (match) => {
    const [matched = '', ...groups] = match;
    const named = Object.entries(match.groups ?? {}).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    );
    return structOf(types, found, {
      text: matched,
      index: BigInt(position(match.index ?? 0)),
      captures: arrayOf(groups.map((group) => arrayOf(group === undefined ? [] : [group]))),
      named: closureFreeMap(named),
    });
  };
}
