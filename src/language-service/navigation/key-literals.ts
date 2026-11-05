/**
 * The String literals a program writes as keys (§3.1): a key naming a field is a String literal of a
 * literal type, compared, matched, converted into `keyof S` or read by as any value is (§3.9), so
 * nothing records which field it names once its type is reduced or inferred. Renaming a field, or
 * giving one a name, would part it from such a literal, so rename.ts refuses both for every value
 * a literal of a literal type spells, keys and members of other literal unions alike.
 *
 * Std modules are left out: they can't spell a field of the program's own structs, and reading their
 * bodies would check every one.
 */

import { checkProgram } from '../../compiler/checker/check.ts';
import { isStdModule, type ModuleId, type Program } from '../../compiler/program/program.ts';
import { nodesUnder, type SyntaxNode } from '../../compiler/syntax/tree.ts';
import { memo } from '../../structures/memo.ts';

const literalsByProgram = new WeakMap<Program, ReadonlySet<string>>();

/**
 * The values of the String literals of a literal type `program` writes outside std: literal types
 * written in types, and literals checked as one.
 */
export function keyLiterals(program: Program): ReadonlySet<string> {
  return memo(literalsByProgram, program, () => {
    const { lookup } = checkProgram(program);
    const literalIn = (module: ModuleId, node: SyntaxNode): readonly string[] => {
      if (node.kind === 'LiteralType') {
        return node.value.kind === 'StringLiteral' ? [node.value.value] : [];
      }
      const isLiteral =
        node.kind === 'StringLiteral' &&
        lookup.bodyHolding(module, node)?.typeOf(node)?.kind === 'literal';
      return isLiteral ? [node.value] : [];
    };
    return new Set(
      [...program.modules]
        .filter(([module]) => !isStdModule(program, module))
        .flatMap(([module, { tree }]) =>
          nodesUnder(tree, tree.root).flatMap((node) => literalIn(module, node)),
        ),
    );
  });
}
