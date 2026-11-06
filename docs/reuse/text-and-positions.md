---
description: SourceText, UTF-16 spans, line/column maps, code points and time units — read before working with source text, spans, string indices or durations
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-10-28
last_updated: 2026-11-05
tags: [reuse, text, spans, positions, code-points]
---

# Text, code points and positions

## Units

- create an immutable `SourceText` (strips leading BOM) → `createSourceText`, `SourceText` (`src/foundation/text/source-text.ts`)
- slice the source text under a `Span` → `textOf` (`src/foundation/text/span.ts`)
- test whether one `Span` lies wholly inside another → `encloses` (`src/foundation/text/span.ts`)
- convert between UTF-16 offsets and 0-based `{ line, column }` on a `SourceText` → `lineMapOf`, `LineMap`, `Position` (`src/foundation/text/line-map.ts`)
- find the span of one line's text, without its line break → `LineMap.lineSpan` (`src/foundation/text/line-map.ts`); never `offsetAt` with a column past the line's end
- convert a UTF-16 offset to 0-based `{ line, column }` from `lineStarts` alone → `positionIn` (`src/foundation/text/line-map.ts`)
- measure a line break (`\r\n`, `\n`, `\r`) at a UTF-16 offset → `lineBreakLength` (`src/foundation/text/line-map.ts`)
- find where the line holding an offset starts, with no line map → `lineStartAt` (`src/foundation/text/line-map.ts`)
- split a text into its lines, without their line breaks → `splitLines` (`src/foundation/text/line-map.ts`)
- count the spaces a line or text opens with, or the indentation of the line holding an offset → `leadingSpaceCount`, `indentationAt` (`src/foundation/text/line-map.ts`); never a regex of your own, nor `offset - column` for a line start
- split a string into its Unicode code points → `codePoints` (`src/foundation/text/code-points.ts`)
- count a string's Unicode code points without allocating an array → `codePointCount` (`src/foundation/text/code-points.ts`)
- get the UTF-16 width (1 or 2) of the code point at a UTF-16 offset → `codePointWidth` (`src/foundation/text/code-points.ts`)
- convert a code-point index to a UTF-16 offset → `utf16Offset` (`src/foundation/text/code-points.ts`)
- read the code point at one code-point index (`''` outside the string) → `codePointAtPosition` (`src/foundation/text/code-points.ts`)
- read code points at monotonic code-point indices in O(n) total → `codePointsAt` (`src/foundation/text/code-points.ts`)
- slice a string between two non-negative code-point indices → `codePointSlice` (`src/foundation/text/code-points.ts`)
- map increasing UTF-16 offsets to code-point positions in O(n) total → `codePointPositions` (`src/foundation/text/code-points.ts`)
- convert seconds or minutes to milliseconds (`bigint`) → `millisecondsPerSecond`, `millisecondsPerMinute` (`src/foundation/language/time-units.ts`)
- convert hours or days to milliseconds (`bigint`) → `millisecondsPerHour`, `millisecondsPerDay` (`src/foundation/language/time-units.ts`)
- get time-unit ratios (`60n`, `24n`) → `secondsPerMinute`, `minutesPerHour`, `hoursPerDay` (`src/foundation/language/time-units.ts`)

## One-way rules

- Internal offsets and `Position` values are 0-based UTF-16; convert to 1-based lines/columns or code points only at edges (`docs/arch/architecture.md`).
- `SourceText` is branded and immutable: build it only with `createSourceText` (`src/foundation/text/source-text.ts`), and represent an edit as a new `SourceText`.
