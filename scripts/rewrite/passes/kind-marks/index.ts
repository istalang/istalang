/**
 * The pass writing the kind marks the call rule needs (proposal 8, implementation note 9): it
 * checks a source as a program's one module, and wherever an error asks for a function's mark
 * ("declare it 'ista fn'"), writes that kind on the head of the function whose code made it; then
 * checks again, since a mark makes its callers need one, until no error asks for more.
 *
 * - The checker decides which functions need which kind, so the pass holds no rule of its own: it
 *   reads the errors of the call, wait and signature rules that ask for a mark, by their codes, and
 *   the kind each names, from the arguments it was made with, never from its wording.
 * - A lambda given no kind runs in its function's, so an error inside one marks that function; a
 *   function already of a kind is never marked again, and a lambda its position gives a kind of
 *   its own keeps its errors for a person to read.
 * - A source is checked alone, against the toolchain's modules: a call into a module of its own
 *   program can't be judged, so what it would need is left to whoever reads the remaining errors.
 */

import { checkerDiagnostics } from '../../../../src/compiler/checker/diagnostics/index.ts';
import { diagnoseModule } from '../../../../src/compiler/compile.ts';
import {
  buildProgram,
  type LocatedModule,
  moduleIdOf,
  type Program,
} from '../../../../src/compiler/program/program.ts';
import type { FunctionDeclaration } from '../../../../src/compiler/syntax/declarations/index.ts';
import { bodyOf, nodesUnder } from '../../../../src/compiler/syntax/tree/index.ts';
import { spanIn } from '../../../../src/compiler/syntax/tree/positions.ts';
import type { Diagnostic } from '../../../../src/foundation/diagnostics/diagnostic.ts';
import { persistences } from '../../../../src/foundation/language/well-known/index.ts';
import { isTestModulePath } from '../../../../src/foundation/language/well-known/testing.ts';
import type { Span } from '../../../../src/foundation/text/span.ts';
import { stdlibLoader, stdRoles } from '../../../../src/stdlib/stdlib-loader.ts';
import { applyEdits } from '../../edits.ts';
import { type IstaSource, insertion, type Pass, type Rewrite, readIsta } from '../../pass.ts';

/** The errors asking the function holding them for a mark, each naming the kind second. */
const askingForMark = [
  checkerDiagnostics.unmarkedCalls,
  checkerDiagnostics.unmarkedWaits,
  checkerDiagnostics.unmarkedHolds,
];

/** The kinds a mark writes; an error naming another (a mark parameter's) asks for none. */
const markKinds: ReadonlySet<string> = new Set(persistences);

/** The offset an embedded source's label ends with, which its path doesn't. */
const embeddedAt = /:\d+$/u;

/** Where a mark goes in the source the pass was given, and the kind it writes. */
type Marks = ReadonlyMap<number, string>;

export const kindMarks: Pass = (source) => {
  const marks = marksNeeded(source);
  return [...marks].map(
    ([offset, kind]): Rewrite => ({ rule: 'mark', edits: [insertion(offset, `${kind} `)] }),
  );
};

/** The marks `source` needs, found by checking it marked so far until no error asks for more. */
function marksNeeded(source: IstaSource): Marks {
  const path = source.source.path.replace(embeddedAt, '');
  const marks = new Map<number, string>();
  for (;;) {
    const marked = readIsta(source.source.path, markedText(source.source.text, marks));
    const added = [...askedMarks(marked, path)]
      .map(([at, kind]) => [unmarkedOffset(at, marks), kind] as const)
      .filter(([offset]) => !marks.has(offset));
    if (added.length === 0) {
      return marks;
    }
    for (const [offset, kind] of added) {
      marks.set(offset, kind);
    }
  }
}

/** `text` with `marks` written in. */
function markedText(text: string, marks: Marks): string {
  return applyEdits(
    text,
    [...marks].map(([offset, kind]) => insertion(offset, `${kind} `)),
  );
}

/** Where `at`, an offset in the text marked by `marks`, stands in the text unmarked. */
function unmarkedOffset(at: number, marks: Marks): number {
  let offset = at;
  for (const [start, kind] of [...marks].sort(([first], [second]) => first - second)) {
    if (start + `${kind} `.length > offset) {
      break;
    }
    offset -= `${kind} `.length;
  }
  return offset;
}

/** The marks the errors of `source` ask for: by where each function's head word is, its kind. */
function askedMarks(source: IstaSource, path: string): Marks {
  const { diagnostics } = diagnoseModule(programOf(source.source.text, path), mainModule.id);
  const functions = nodesUnder(source.tree, source.tree.root).filter(
    (node): node is FunctionDeclaration => node.kind === 'FunctionDeclaration',
  );
  const asked = new Map<number, string>();
  for (const diagnostic of diagnostics) {
    const kind = askedKind(diagnostic);
    const holder =
      kind === undefined ? undefined : innermostAt(source, functions, diagnostic.span.start);
    // A function of a kind, written or named (`M fn`), holds the error elsewhere: in a lambda of a
    // kind of its own, or where its named mark meets another.
    const unmarked =
      holder?.qualifiers.kind === undefined && holder?.mark === undefined ? holder : undefined;
    const at = unmarked === undefined ? undefined : headWordOf(source, unmarked);
    if (kind !== undefined && at !== undefined && !asked.has(at)) {
      asked.set(at, kind);
    }
  }
  return asked;
}

/** The kind `diagnostic` asks the function holding it to be declared with, if it asks for one. */
function askedKind(diagnostic: Diagnostic<Span, string>): string | undefined {
  const kind = askingForMark
    .map((asking) => asking.argumentsOf(diagnostic)?.[1])
    .find((named) => named !== undefined);
  return kind !== undefined && markKinds.has(kind) ? kind : undefined;
}

const mainModule = { id: moduleIdOf(new URL('memory:main')), name: 'main', label: 'main' };

function programOf(text: string, path: string): Program {
  const root: LocatedModule = { ...mainModule, isTest: isTestModulePath(path), read: () => text };
  return buildProgram({ roots: [root], loaders: [stdlibLoader()], roles: stdRoles() });
}

/** The innermost function of `functions` whose header or body holds `offset`. */
function innermostAt(
  { tree }: IstaSource,
  functions: readonly FunctionDeclaration[],
  offset: number,
): FunctionDeclaration | undefined {
  let innermost: { declaration: FunctionDeclaration; length: number } | undefined;
  for (const declaration of functions) {
    const body = bodyOf(tree, declaration);
    const { start } = spanIn(tree, declaration.span);
    const { end } = spanIn(tree, (body ?? declaration).span);
    if (
      start <= offset &&
      offset < end &&
      (innermost === undefined || end - start < innermost.length)
    ) {
      innermost = { declaration, length: end - start };
    }
  }
  return innermost?.declaration;
}

/** Where a kind goes in `declaration`'s head: before its `async`, or its `fn` (Rule 4's order). */
function headWordOf(
  { tokens, tree }: IstaSource,
  declaration: FunctionDeclaration,
): number | undefined {
  const { start } = spanIn(tree, declaration.span);
  return tokens.find(
    (token) => token.span.start >= start && (token.kind === 'async' || token.kind === 'fn'),
  )?.span.start;
}
