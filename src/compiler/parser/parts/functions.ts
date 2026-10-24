/**
 * The head every function form begins with: `fn`, or `async fn`. Lambdas, function types and
 * function declarations share it (§3.3, §3.14).
 */

import type { Parser } from '../parser.ts';

/** `fn` or `async fn`, starting at either keyword: whether the function is async. */
export function parseFunctionKeyword(parser: Parser): boolean {
  const isAsync = parser.cursor.eat('async') !== undefined;
  parser.expect('fn');
  return isAsync;
}
