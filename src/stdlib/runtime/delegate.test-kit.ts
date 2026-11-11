/**
 * The host `delegate`'s tests share: a program's `charge`, a live extern only a job reaches, and a
 * host answering it with a receipt, counting its calls.
 */

import type { HostExterns } from '../../runtime/boundary/host-natives.ts';

export const chargeKey = 'main.charge(String)';

export const header = [
  "import * as runtime from 'runtime'",
  'extern live async fn charge(id: String) -> String',
];

/** A host's `charge`, its arguments the call's. */
type Charge = (arguments_: readonly unknown[]) => Promise<string>;

/** A host whose `charge` answers with a receipt naming its id, counting its calls by id. */
export function countingHost(): {
  readonly host: HostExterns;
  readonly charge: Charge;
  readonly calls: Map<string, number>;
} {
  const calls = new Map<string, number>();
  const charge: Charge = ([id]) => {
    calls.set(String(id), (calls.get(String(id)) ?? 0) + 1);
    return Promise.resolve(`receipt for ${String(id)}`);
  };
  return { host: { [chargeKey]: charge }, charge, calls };
}
