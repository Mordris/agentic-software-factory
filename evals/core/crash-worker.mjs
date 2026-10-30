// SPDX-License-Identifier: Apache-2.0
// Trusted, synthetic process used only by the owned-process crash tests.
import { writeSync } from 'node:fs';
import { Coordinator } from '@asf/core';
import { SqliteLedger } from '@asf/store-sqlite';

const [path, boundary] = process.argv.slice(2);
const ledger = new SqliteLedger({
  path,
  fault(stage) {
    if (stage === boundary) {
      writeSync(1, `${JSON.stringify({ stage, pid: process.pid, epoch: ledger.epoch })}\n`);
      process.kill(process.pid, 'SIGSTOP');
    }
  },
});
const coordinator = new Coordinator(ledger, {
  clock: () => 1000,
  operatorId: 'fixture-operator',
  resolveResource: (path) => path,
  verifyArtifact: () => false,
  verifyEvidence: () => false,
});
coordinator.dispatch('crash-claim');
if (boundary === 'before-publication') ledger.pendingOutbox();
if (boundary === 'before-acknowledgment') {
  const messages = ledger.pendingOutbox();
  writeSync(1, `${JSON.stringify({ published: messages.map((item) => item.cursor) })}\n`);
  const last = messages.at(-1);
  ledger.acknowledge(last.cursor, last.hash);
}
throw new Error('Crash boundary not reached');
