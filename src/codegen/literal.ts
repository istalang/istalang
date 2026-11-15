/**
 * JavaScript source for the data a program carries: its constants and the tables its runtime reads
 * (docs/work/js-codegen/design.md, "Generated code").
 *
 * - Values as they are in memory (definition/values/values.ts): an `Int` a bigint literal, a
 *   `Float` a number, NaN, the infinities and -0 included, which JSON can't spell. Composites and
 *   the tables are object and array literals, so loading a program runs no decoder.
 * - Keys are quoted as JSON quotes them, so no key needs to be an identifier.
 */

/** `data`, a value or a table built of JSON, bigints and numbers, as a JavaScript expression. */
export function literal(data: unknown): string {
  switch (typeof data) {
    case 'bigint':
      return `${data}n`;
    case 'number':
      // NaN and the infinities print as the globals of those names.
      return Object.is(data, -0) ? '-0' : String(data);
    case 'string':
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
    ([key, value]) => `${JSON.stringify(key)}:${literal(value)}`,
  );
  return `{${fields.join(',')}}`;
}
