// SPDX-License-Identifier: Apache-2.0
import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { Coordinator, digest } from '@asf/core';
import { ensure } from '@asf/protocol';
import { ArtifactStore, SqliteLedger } from '@asf/store-sqlite';

export function openContext(state: string) {
  const root = resolve(state);
  const ledger = new SqliteLedger({ path: join(root, 'ledger.sqlite') });
  try {
    const artifacts = new ArtifactStore(join(root, 'artifacts'));
    const workspace = realpathSync(join(root, 'workspaces'));
    const coordinator = new Coordinator(ledger, {
      clock: Date.now,
      operatorId: `local-uid-${process.getuid?.()}`,
      resolveResource(path) {
        ensure(!isAbsolute(path) && !path.split(/[\\/]/).includes('..'), 'ALLOCATION_ESCAPE');
        const target = realpathSync(resolve(workspace, path));
        const inside = relative(workspace, target);
        ensure(!inside.startsWith('..') && !isAbsolute(inside), 'ALLOCATION_ESCAPE');
        const entry = statSync(target);
        ensure(entry.isDirectory(), 'ALLOCATION_NOT_DIRECTORY');
        return digest({ host: 'fixture-local', dev: entry.dev, inode: entry.ino });
      },
      verifyArtifact: (lease, hash, lab) => artifacts.verifyOutput(lease, hash, lab),
      verifyEvidence: (evidence, taskId) => artifacts.verifyEvidence(evidence, taskId),
    });
    return { root, ledger, artifacts, coordinator };
  } catch (error) {
    ledger.close();
    throw error;
  }
}
