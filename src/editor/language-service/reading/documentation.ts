/**
 * What documents a declaration, as hover and completion show it: the comments written right above
 * it, then its docstring (§2.3), as Markdown.
 *
 * The comments above a declaration are the block of `#` comments, each on a line of its own,
 * whose last ends on the line before the declaration's first, with no blank line in the block: a
 * comment a blank line parts from the declaration, as a module's banner, is about something else.
 * A declaration sharing its first line with what comes before it, as a field of `{ a: Int }` does,
 * has none, since a comment above that line is about what starts it. Each comment shows without
 * its `#` and the one space after it.
 */

import { localFunctionOf } from '../../../compiler/binder/entities.ts';
import type { Checker } from '../../../compiler/checker/check.ts';
import type { Denotation } from '../../../compiler/checker/surface/denotation.ts';
import { programModule } from '../../../compiler/program/program.ts';
import { extentIn, type SyntaxNode, type SyntaxTree } from '../../../compiler/syntax/tree/index.ts';
import { lineMapOf } from '../../../foundation/text/line-map.ts';
import { textOf } from '../../../foundation/text/span.ts';
import { declaringNameOf, declaringNodeOf } from './declaring-node.ts';
import { importedModule } from './namespaces.ts';

type Declared = Denotation['declared'];

/** What documents what `declared` names (banner); undefined for nothing. */
export function documentationOf(checker: Checker, declared: Declared): string | undefined {
  const parts = [commentsAboveDeclaration(checker, declared), docstringOf(checker, declared)];
  const written = parts.filter((part) => part !== undefined);
  return written.length === 0 ? undefined : written.join('\n\n');
}

/** The docstring of what `declared` names, for the declarations that may have one (§2.3). */
function docstringOf(checker: Checker, declared: Declared): string | undefined {
  switch (declared.kind) {
    case 'function':
      return declared.declaration.doc?.value;
    case 'type': {
      const { entity } = declared;
      return entity.kind === 'type' && 'doc' in entity.declaration
        ? entity.declaration.doc?.value
        : undefined;
    }
    case 'namespace':
      return importedModule(checker, declared.entity)?.tree.root.doc?.value;
    case 'variable': {
      const local = localFunctionOf(declared.entity);
      return local?.kind === 'FunctionDeclaration' ? local.doc?.value : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * The comments above the declaration `declared` names; none for a namespace, whose import's
 * comments are about the import.
 */
function commentsAboveDeclaration(checker: Checker, declared: Declared): string | undefined {
  const place = declared.kind === 'namespace' ? undefined : declaringNameOf(checker, declared);
  if (place === undefined) {
    return undefined;
  }
  const { tree } = programModule(checker.program, place.module);
  return commentsAbove(tree, declaringNodeOf(tree, place.name));
}

const commentMark = /^# ?/u;

/** The comments of `tree` right above `node` (banner), one line each. */
function commentsAbove(tree: SyntaxTree, node: SyntaxNode): string | undefined {
  const { source } = tree;
  const lines = lineMapOf(source);
  const ownLine = (offset: number) => {
    const { line } = lines.positionAt(offset);
    return textOf(source, { start: lines.lineSpan(line).start, end: offset }).trim() === '';
  };
  const { start } = extentIn(tree, node);
  if (!ownLine(start)) {
    return undefined;
  }
  const byLine = new Map(
    tree.comments
      .filter(({ span }) => ownLine(span.start))
      .map(({ span }) => [lines.positionAt(span.start).line, textOf(source, span)]),
  );
  const block: string[] = [];
  for (let line = lines.positionAt(start).line - 1; byLine.has(line); line -= 1) {
    block.unshift((byLine.get(line) ?? '').replace(commentMark, ''));
  }
  return block.length === 0 ? undefined : block.join('\n');
}
