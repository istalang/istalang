/**
 * The call rule over code's marks (proposal 8, Rule 2), as the Definition's validation and the
 * runtime read it of entries: code calls simple code and code of its own kind. The checker judges
 * it over types, kind variables among them (compiler/checker/types/type/mark-orders.ts).
 */

import type { Mark } from './well-known/index.ts';

/** Whether code of mark `code` may call code of mark `callee`. */
export function mayCall(code: Mark, callee: Mark): boolean {
  return callee === 'simple' || callee === code;
}
