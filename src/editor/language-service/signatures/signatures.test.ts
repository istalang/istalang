import { expect, it } from 'vitest';
import { checkProgram } from '../../../compiler/checker/check.ts';
import type { FunctionDeclaration } from '../../../compiler/syntax/declarations/index.ts';
import { nodesUnder } from '../../../compiler/syntax/tree/index.ts';
import { formatTree } from '../../../formatter/format.ts';
import { mainProgram } from '../language-service.test-kit.ts';
import { signatureOf } from './signatures.ts';

it("prints every std function's head as the formatter does", () => {
  const { program } = mainProgram('');
  const checker = checkProgram(program);
  const heads = [...program.modules.values()]
    .filter(({ isStd }) => isStd === true)
    .flatMap(({ tree }) => {
      const formatted = formatTree(tree) ?? '';
      return nodesUnder(tree, tree.root)
        .filter((node): node is FunctionDeclaration => node.kind === 'FunctionDeclaration')
        .map((declaration) => {
          const { label } = signatureOf(checker, declaration);
          const named = label.indexOf(declaration.name.text) + declaration.name.text.length;
          return {
            formatted,
            head: `${declaration.isExtern ? 'extern ' : ''}${label.slice(0, named)}`,
          };
        });
    });
  expect(heads.some(({ head }) => head.includes('async '))).toBe(true);
  expect(heads.filter(({ formatted, head }) => !formatted.includes(head))).toEqual([]);
});
