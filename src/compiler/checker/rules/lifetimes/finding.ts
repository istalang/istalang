/**
 * What the lifetime rule finds (design.md §7): where a cycle may close through a disposable, and
 * in whose code.
 */

import type {
  ContextConstantDeclaration,
  FunctionDeclaration,
} from '../../../syntax/declarations/index.ts';
import type { VariableDeclaration } from '../../../syntax/statements/index.ts';
import type { NodeOf } from '../../../syntax/tree/node.ts';
import type { Type } from '../../types/type/index.ts';

/**
 * Where the lifetime rule finds a cycle may close through a disposable (design.md §7): a write, a
 * call whose callee's write of what it is given would, an escaping closure or a witness whose
 * would, or a call at whose types its callee's own code makes one (`instance`).
 */
export interface LifetimeFinding {
  readonly kind: 'write' | 'call' | 'closure' | 'witness' | 'instance';
  readonly site: NodeOf<string>;
  /** What holds the cycle: the type of the holder written, or of what is written into it. */
  readonly holderType: Type;
  readonly callee: FunctionDeclaration | undefined;
  /** The function, or the constant, whose code it is in. */
  readonly declaration: FindingDeclaration;
}

/**
 * What code a lifetime finding is in: a function's, or a constant's initializer, a context
 * constant's or a top-level one's, which nothing calls with anything.
 */
export type FindingDeclaration =
  | FunctionDeclaration
  | ContextConstantDeclaration
  | VariableDeclaration;
