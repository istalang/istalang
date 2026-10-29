import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { tempProject } from '../../project/project.test-kit.ts';
import { stdModuleSources } from '../../stdlib/std-sources.ts';
import { connectedClient } from '../server.test-kit.ts';
import { stdSourceRequest } from './std-source.ts';

describe('ista/source', () => {
  it('gives each std module its text, by its std: URI', async () => {
    const client = await connectedClient(tempProject({}));
    const names = Object.keys(stdModuleSources);
    const sources = await Promise.all(
      names.map((name) => client.connection.sendRequest(stdSourceRequest, { uri: `std:${name}` })),
    );
    expect(sources).toEqual(Object.values(stdModuleSources));
  });

  it('has nothing for a file, or a std module that does not exist', async () => {
    const root = tempProject({ 'main.ista': '' });
    const client = await connectedClient(root);
    const file = pathToFileURL(`${root}/main.ista`).href;
    expect(await client.connection.sendRequest(stdSourceRequest, { uri: file })).toBeNull();
    expect(
      await client.connection.sendRequest(stdSourceRequest, { uri: 'std:nothing' }),
    ).toBeNull();
  });
});
