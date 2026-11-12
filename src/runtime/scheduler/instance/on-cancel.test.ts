/**
 * A resolver's `onCancel` callbacks (proposal 8, Rule 5) run as a `Resolver.of` callback does
 * (callbacks.test.ts), once, when their resolver is cancelled: its wait decided by another case, or
 * the future it is registered on disposed first; at once when it was cancelled already, never once
 * it resolved.
 */

import { describe, expect, it } from 'vitest';
import { compiledText } from '../../../compiler/compile.test-kit.ts';
import { testRuntime } from '../../runtime.test-kit.ts';
import { ended } from './callbacks.test-kit.ts';

describe("a resolver's onCancel", () => {
  it('runs once another case decides its wait', async () => {
    const main = [
      'live async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:',
      '  const seen = new Seen{value: 0}',
      '  const got = await select:',
      '    case Watched{seen, kept: new Kept{}} as slow:',
      '      slow',
      '    case runtime.commit():',
      '      5',
      '  await runtime.commit()',
      '  got * 10 + seen->value',
    ];
    expect(await ended(main)).toEqual({ kind: 'finished', outcome: '49' });
  });

  it('never runs once its resolver resolved', async () => {
    const main = [
      'live async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:',
      '  const seen = new Seen{value: 0}',
      '  const got = await Watched{seen, kept: new Kept{}}',
      '  await runtime.commit()',
      '  got * 10 + seen->value',
    ];
    expect(await ended(main)).toEqual({ kind: 'finished', outcome: '10' });
  });

  it('runs at once when given to a resolver cancelled already', async () => {
    const main = [
      'live async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:',
      '  const seen = new Seen{value: 0}',
      '  const kept = new Kept{}',
      '  _ = await select:',
      '    case Watched{seen, kept} as slow:',
      '      slow',
      '    case runtime.commit():',
      '      5',
      '  await runtime.commit()',
      '  _ = kept->resolver?.onCancel(fn(): see(seen, -2))',
      '  await runtime.commit()',
      '  seen->value',
    ];
    expect(await ended(main)).toEqual({ kind: 'finished', outcome: '-2' });
  });

  it('disposes resources held only by a readied callback run when the instance finishes or terminates', async () => {
    const code = compiledText(
      [
        "import * as runtime from 'runtime'",
        'extern shared struct Lease',
        'extern fn makeLease() -> Lease',
        'extern fn dispose(self: Lease)',
        'ista async fn finishWithRun() -> Int:',
        '  const lease = makeLease()',
        '  const r = Resolver.of(fn(l: Lease): { _ = l; () })',
        '  r.resolve(lease)',
        '  0',
        'live async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:',
        '  const lease = makeLease()',
        '  const r = Resolver.of(fn(l: Lease): { _ = l; () })',
        '  r.resolve(lease)',
        '  await runtime.commit()',
        '  panic("boom")',
        '# Roots the ista entry the test starts by name: only code a live start reaches is kept.',
        'live async fn reach():',
        '  _ = await runtime.run(runtime.id()) finishWithRun()',
        '  0',
      ].join('\n'),
    );
    let disposed = 0;
    const test = testRuntime({
      host: {
        'main.makeLease()': () => 'lease-1',
        'main.dispose(main.Lease)': () => {
          disposed += 1;
          return null;
        },
      },
    });
    test.startInstance(code, 'finishing', { function: 'main.finishWithRun' });
    expect(disposed).toBe(1);
    test.startInstance(code, 'terminating');
    await test.runtime.terminate('terminating');
    expect(disposed).toBe(2);
  });
});
