/**
 * Observing what a phase reported, for tests of every phase.
 *
 * A test compares codes and the source text under each span, never messages or offsets, so it
 * reads as the source it checks and survives rewording.
 */

import type { SourceText } from '../text/source-text.ts';
import { type Span, textOf } from '../text/span.ts';
import type { Diagnostic } from './diagnostic.ts';

export interface Reported {
  readonly codes: readonly number[];
  readonly spanTexts: readonly string[];
}

/** The codes of `diagnostics`, and the text of `source` under each span. */
export function reportedIn(
  source: SourceText,
  diagnostics: readonly Diagnostic<Span, string>[],
): Reported {
  return {
    codes: diagnostics.map((diagnostic) => diagnostic.code),
    spanTexts: diagnostics.map((diagnostic) => textOf(source, diagnostic.span)),
  };
}

/** What a phase reported when it reported nothing. */
export const reportedNothing: Reported = { codes: [], spanTexts: [] };

/** What a phase reported when it reported `code` once, over `spanText`. */
export function reportedOnce(code: number, spanText: string): Reported {
  return { codes: [code], spanTexts: [spanText] };
}
