/**
 * The type expected where a cursor writes a value (§2, §3.11): it ranks what fits first, and it
 * alone admits bare variants, those of the enum expected.
 *
 * - The checker stays the one home of expectations: a place read from the placeholder parse
 *   (placeholder.ts) expects what the checker expects of the placeholder name, once the module
 *   holding it is checked. So a field's value, an annotated declaration, a `return`, a comparison,
 *   an element or a spread each expect what the language says, with no rule repeated here.
 * - That checker takes over from the program's (incremental checking), so a request checks about
 *   the item holding the cursor; it is tentative, so the program's checker keeps what it took over
 *   from, for the next edit's. The module's imports are kept: the placeholder parse keeps the
 *   nodes of every segment it left alike, the imports' among them. A name already written parses
 *   alike with or without the placeholder, so the program's own checker answers for it, unchecked
 *   again.
 * - A place is asked once per request, however many providers ask (memoized by the place).
 */

import { checkProgram } from '../../compiler/checker/check.ts';
import { enumsExpected, sameEnum } from '../../compiler/checker/types/fit.ts';
import type { Type } from '../../compiler/checker/types/type.ts';
import type { ModuleId, Program } from '../../compiler/program/program.ts';
import type { Identifier } from '../../compiler/syntax/node.ts';
import type { SyntaxTree } from '../../compiler/syntax/tree.ts';
import { type Handlers, handlerOf } from '../../structures/kind-table.ts';
import { memo } from '../../structures/memo.ts';
import { argumentParameterAt } from '../call-at.ts';
import { identifierAt } from '../identifier-at.ts';
import type { Candidate } from './candidate.ts';
import type { Cursor } from './cursor.ts';
import type { Place } from './place.ts';
import type { ParsedPlace } from './placeholder.ts';
import { matchedTypeOf } from './places/matched-type.ts';

/** The type expected of what `cursor` writes at `place`; undefined where nothing is expected. */
export function expectedTypeAt(cursor: Cursor, place: Place): Type | undefined {
  return memo(expectations, place, () => handlerOf(expecters, place)(cursor, place));
}

/**
 * The variants that may be written bare at `place`: those of the enums a value expected there may
 * be a variant of, its own and those inside its optionals, outermost first, as checking chooses
 * among them (§3.11); a name two of them share is the outermost's.
 */
export function expectedVariants(cursor: Cursor, place: Place): readonly Candidate[] {
  const { checker } = cursor;
  const expected = expectedTypeAt(cursor, place);
  const candidates = enumsExpected(checker, expected).flatMap((declaration) => {
    const enumType = sameEnum(checker, expected, declaration);
    return enumType === undefined
      ? []
      : (checker.variantsOf(enumType) ?? []).map(
          (variant): Candidate => ({
            name: variant.name,
            subject: { kind: 'variant', variant, enum: enumType },
          }),
        );
  });
  return candidates.filter(
    ({ name }, index) => candidates.findIndex((each) => each.name === name) === index,
  );
}

/** Whether `candidate` is a bare variant name, which only an expected enum admits (§3.11). */
export function isBareVariant({ subject }: Candidate): boolean {
  return (
    subject.kind === 'entity' &&
    (subject.entity.kind === 'variant' || subject.entity.kind === 'variants')
  );
}

const expectations = new WeakMap<Place, Type | undefined>();

const nothingExpected = () => undefined;

/**
 * What each kind of place expects: a value is written where the grammar or an argument is, and a
 * pattern starts where its matched value is tested.
 */
const expecters: Handlers<Cursor, Place, [], Type | undefined> = {
  grammar: expectedOfValue,
  callArgument: expectedOfValue,
  member: nothingExpected,
  literalField: nothingExpected,
  nothing: nothingExpected,
  type: nothingExpected,
  declaredName: nothingExpected,
  pattern: expectedOfPatternStart,
  patternField: nothingExpected,
  import: nothingExpected,
  annotation: nothingExpected,
};

/**
 * What the checker expects of the value written at `place`; for a call's argument, which stops a
 * call being written from resolving, the type of the parameter it gives (call-at.ts).
 */
function expectedOfValue(cursor: Cursor, { parsed }: ParsedPlace): Type | undefined {
  const placeholder = parsed.chain.at(-1);
  if (placeholder?.kind !== 'Identifier') {
    return undefined;
  }
  const written = writtenName(cursor);
  const checked =
    written === undefined
      ? expectedOfPlaceholder(cursor, parsed.tree, placeholder)
      : cursor.checker.lookup.bodyHolding(cursor.module, written)?.expectedOf(written);
  const holder = parsed.chain.at(-2);
  const isArgument = holder?.kind === 'Call' || holder?.kind === 'NamedArgument';
  return checked ?? (isArgument ? argumentParameterAt(cursor, cursor.offset)?.type : undefined);
}

/** Where a pattern starts, the type it matches (places/matched-type.ts); its variants fit. */
function expectedOfPatternStart(cursor: Cursor, { parsed }: ParsedPlace): Type | undefined {
  const holder = parsed.chain.at(-2);
  return holder?.kind === 'NamePattern' ? matchedTypeOf(cursor, parsed, holder) : undefined;
}

/** The name the cursor writes as the program's tree holds it, which its own checker answers for. */
function writtenName({ name, tree, offset }: Cursor): Identifier | undefined {
  return name?.kind === 'identifier' ? identifierAt(tree, offset) : undefined;
}

/** What the checker expects of `placeholder`, `tree` checked in place of the cursor's module's. */
function expectedOfPlaceholder(
  { checker, module }: Cursor,
  tree: SyntaxTree,
  placeholder: Identifier,
): Type | undefined {
  const { program } = checker;
  const tried = checkProgram(withTree(program, module, tree), {
    previous: program,
    tentative: true,
  });
  return tried.lookup.bodyHolding(module, placeholder)?.expectedOf(placeholder);
}

/** `program` with `module` read as `tree`, its imports as they were. */
function withTree(program: Program, module: ModuleId, tree: SyntaxTree): Program {
  const loaded = program.modules.get(module);
  return loaded === undefined
    ? program
    : { ...program, modules: new Map(program.modules).set(module, { ...loaded, tree }) };
}
