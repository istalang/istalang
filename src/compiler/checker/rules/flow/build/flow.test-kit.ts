/**
 * What the flow builder's tests share: the flow of a function written as a test's source.
 */

import { stdProgramOf } from '../../../../binder/bind.test-kit.ts';
import { idOf } from '../../../../program/program.test-kit.ts';
import type { FunctionDeclaration } from '../../../../syntax/declarations/index.ts';
import { bodyOf } from '../../../../syntax/tree/index.ts';
import { inFunction } from '../../../check.test-kit.ts';
import { checkProgram } from '../../../check.ts';
import type { FlowFunction } from '../../../surface/flow-ir.ts';

/** The flow of `subject`, the function `body` is written in, after `declarations`. */
export function subjectFlow(body: string, declarations: readonly string[] = []): FlowFunction {
  const program = stdProgramOf({ main: [...declarations, inFunction(body)].join('\n') });
  const checker = checkProgram(program);
  const module = idOf('main');
  const tree = program.modules.get(module)?.tree;
  const subject = tree?.root.items.find(
    (item): item is FunctionDeclaration =>
      item.kind === 'FunctionDeclaration' && item.name.text === 'subject',
  );
  const checked = subject === undefined ? undefined : checker.bodyOf(subject);
  const block = tree === undefined || subject === undefined ? undefined : bodyOf(tree, subject);
  if (subject === undefined || checked === undefined || block === undefined) {
    throw new Error('The subject was never checked.');
  }
  return checked.flowOf(block);
}
