/** Methods (§3.7): a function whose first parameter is `self` takes its receiver there. */

import { receiverParameter } from '../../../foundation/language/well-known/index.ts';
import type { FunctionDeclaration } from './index.ts';

/** Whether `declaration` is a method: its first parameter is named `self` (§3.7). */
export function isMethod(declaration: FunctionDeclaration): boolean {
  const [first] = declaration.parameters;
  return first?.kind === 'Parameter' && first.name?.text === receiverParameter;
}
