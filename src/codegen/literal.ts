/**
 * JavaScript source for the data an instruction carries inline: a primitive constant, a place's
 * path, a switch's targets, a name (docs/arch/codegen.md). A composite constant is never spelled:
 * code reads it from the run's constants (`K`, emit.ts), built once from the Definition.
 *
 * - Values as they are in memory (definition/values/values.ts): an `Int` a bigint literal, a
 *   `Float` a number, NaN, the infinities and -0 included, which JSON can't spell.
 * - Strings and keys are quoted as JSON quotes them, so no key needs to be an identifier, with the
 *   line and paragraph separators escaped too: JavaScript counts them as line breaks, which would
 *   move every line after and so the instruction each line names (entry.ts).
 */

/** `data`, built of JSON, bigints and numbers, as a JavaScript expression. */
export function literal(data: unknown): string {
  switch (typeof data) {
    case 'bigint':
      return `${data}n`;
    case 'number':
      // NaN and the infinities print as the globals of those names.
      return Object.is(data, -0) ? '-0' : String(data);
    case 'string':
      return stringLiteral(data);
    case 'boolean':
      return JSON.stringify(data);
    case 'object':
      return objectLiteral(data);
    case 'undefined':
      return 'undefined';
    default:
      throw new TypeError(`No literal of a ${typeof data}.`);
  }
}

function objectLiteral(data: object | null): string {
  if (data === null) {
    return 'null';
  }
  if (Array.isArray(data)) {
    return `[${data.map(literal).join(',')}]`;
  }
  const fields = Object.entries(data).map(
    ([key, value]) => `${stringLiteral(key)}:${literal(value)}`,
  );
  return `{${fields.join(',')}}`;
}

/** `text` as a JavaScript string literal on one line. */
function stringLiteral(text: string): string {
  return JSON.stringify(text).replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
}
