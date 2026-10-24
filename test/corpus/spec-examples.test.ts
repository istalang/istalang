/**
 * The spec-example classifications stay true to the spec: each names at least one example, so an
 * edit that renames a section or rewrites a first line can't leave a stale entry behind.
 */

import { describe, expect, it } from 'vitest';
import { classifications, classifies, specExamples } from './spec-examples.ts';

describe('classifications', () => {
  it.each(classifications)('$form: $section, $firstLine', (classification) => {
    const matched = specExamples.filter((example) =>
      classifies(classification, example.section, example.code),
    );
    expect(matched.length).toBeGreaterThan(0);
  });
});
