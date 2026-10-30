// SPDX-License-Identifier: Apache-2.0
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { harness } from './helpers.js';

function cli(...args: string[]) {
  return spawnSync(process.execPath, ['apps/cli/dist/main.js', ...args], { encoding: 'utf8', timeout: 5000 });
}
it('runs built ESM with stable JSON errors and read-only paths that preserve journal/authority', () => {
  const h = harness();
  try {
    h.approve();
    const before = h.ledger.snapshot();
    const status = cli('status', '--state', h.root);
    expect(status.status).toBe(0);
    expect(JSON.parse(status.stdout).result.snapshot).toEqual(before);
    const events = cli(
      'events',
      '--state',
      h.root,
      '--ledger-id',
      before.ledgerId,
      '--after',
      String(before.cursor),
    );
    expect(events.status).toBe(0);
    expect(JSON.parse(events.stdout).result.events).toEqual([]);
    expect(h.ledger.snapshot()).toEqual(before);
    const oversized = join(h.root, 'oversized.json');
    writeFileSync(oversized, ' '.repeat(65537));
    const rejected = cli('plan-preview', '--file', oversized);
    expect(rejected.status).toBe(1);
    expect(JSON.parse(rejected.stderr).error.code).toBe('INPUT_TOO_LARGE');
    for (const args of [
      ['push'],
      ['status', '--state', h.root, '--state', h.root],
      ['events', '--state', h.root, '--ledger-id', 'foreign', '--after', '0'],
      ['status', '--state', join(h.root, 'missing')],
    ]) {
      const result = cli(...args);
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stderr).ok).toBe(false);
    }
    expect(h.ledger.snapshot()).toEqual(before);
    expect(JSON.parse(cli('versions').stdout).result.node).toBe(process.versions.node);
  } finally {
    h.dispose();
  }
});
