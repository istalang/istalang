/**
 * Functions as checked (§2): what each declares its body produces, what calling it yields, and its
 * checked body, each an entry of its own, so a body checked again to the same result cuts off at
 * the result (incremental-checking.md §1).
 *
 * A function with no declared result gets the one its body produces. Inferring it checks the body;
 * a call reached while that body is being checked is the function calling itself, directly or
 * through others, which needs a declared result: every result on the cycle stands for the error
 * type, whichever was asked first.
 */

import type { EntryTable } from '../../../../structures/entries/index.ts';
import type { ModuleId } from '../../../program/program.ts';
import type { FunctionDeclaration } from '../../../syntax/declarations/index.ts';
import type { CheckerContext, CheckerNote } from '../../context.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import type { CheckedBody } from '../../surface/checked-body.ts';
import { sameTypeSpelled } from '../../types/parts/type-parts.ts';
import type { Type } from '../../types/type/index.ts';
import { errorType, unitType } from '../../types/type/primitives.ts';
import { callResult, declaredBodyResult } from './signatures.ts';

/** What ProgramChecker gives the unit: how to check a body against its declared result. */
export interface FunctionSeams {
  readonly checker: CheckerContext;
  /**
   * Checks the body of `declaration`, a function with one, in `module`, where it must produce
   * `declaredResult` if given.
   */
  readonly checkBody: (
    module: ModuleId,
    declaration: FunctionDeclaration,
    declaredResult: Type | undefined,
  ) => CheckedBody;
}

/** Whether two answers that may be no type are the same type spelled alike, or both none. */
function sameOptionalType(first: Type | undefined, second: Type | undefined): boolean {
  return (
    first === second ||
    (first !== undefined && second !== undefined && sameTypeSpelled(first, second))
  );
}

export class FunctionChecks {
  readonly #checker: CheckerContext;
  readonly #declaredResults: EntryTable<CheckerNote, FunctionDeclaration, Type | undefined>;
  readonly #results: EntryTable<CheckerNote, FunctionDeclaration, Type>;
  readonly #bodies: EntryTable<CheckerNote, FunctionDeclaration, CheckedBody>;

  constructor({ checker, checkBody }: FunctionSeams) {
    this.#checker = checker;
    const { entries } = checker;
    this.#declaredResults = entries.table({
      name: 'declared results',
      compute: (declaration) =>
        declaredBodyResult(checker, checker.moduleOf(declaration), declaration),
      equal: sameOptionalType,
    });
    this.#results = entries.table({
      name: 'results',
      compute: (declaration) => {
        const declared = this.#declaredResults.get(declaration);
        const inferred =
          declared === undefined ? this.#checkedBody(declaration)?.result : undefined;
        return callResult(checker, declaration, declared ?? inferred ?? unitType);
      },
      equal: sameTypeSpelled,
      cyclic: {
        standIn: () => errorType,
        reportMember: (member) =>
          checker.report(
            checker.moduleOf(member),
            checkerDiagnostics.recursiveReturnType(member.name.span, member.name.text),
          ),
      },
    });
    this.#bodies = entries.table({
      name: 'bodies',
      compute: (declaration) =>
        checkBody(
          checker.moduleOf(declaration),
          declaration,
          this.#declaredResults.get(declaration),
        ),
    });
  }

  /** What calling the function yields: `Future<T>` for an async one. */
  resultOf(declaration: FunctionDeclaration): Type {
    return this.#results.get(declaration);
  }

  /**
   * The checked body of a function with one; undefined for an extern. A body its result is inferred
   * from is reached through that result, so a cycle through it always reaches the result first.
   */
  bodyOf(declaration: FunctionDeclaration): CheckedBody | undefined {
    if (this.#declaredResults.get(declaration) === undefined) {
      this.resultOf(declaration);
    }
    return this.#checkedBody(declaration);
  }

  /** The checked body of a function with one; a function without, such as an extern, has none. */
  #checkedBody(declaration: FunctionDeclaration): CheckedBody | undefined {
    const module = this.#checker.moduleOf(declaration);
    return this.#checker.inputs.bodyOf(module, declaration) === undefined
      ? undefined
      : this.#bodies.get(declaration);
  }
}
