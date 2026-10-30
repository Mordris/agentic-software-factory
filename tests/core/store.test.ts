// SPDX-License-Identifier: Apache-2.0
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, symlinkSync, truncateSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Coordinator, digest } from '@asf/core';
import { canonical } from '@asf/protocol';
import { ArtifactStore, applyPatch, difference, SqliteLedger } from '@asf/store-sqlite';
import Database from 'better-sqlite3';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { harness } from './helpers.js';

const binding = join(process.cwd(), '.factory/native/sqlite-3.54.1/better_sqlite3.node');
function raw(path: string) {
  return new Database(path, { nativeBinding: binding, timeout: 10 });
}
async function crash(path: string, stage: string) {
  const child = spawn(process.execPath, ['evals/core/crash-worker.mjs', path, stage], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let errors = '';
  child.stderr.on('data', (data) => {
    errors += String(data);
  });
  const signal = await new Promise<NodeJS.Signals | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Owned crash worker timed out: ${errors}`));
    }, 5000);
    child.stdout.on('data', (data) => {
      output += String(data);
      if (output.includes(`"stage":"${stage}"`)) child.kill('SIGKILL');
    });
    child.on('error', reject);
    child.on('exit', (code, actual) => {
      clearTimeout(timer);
      if (actual !== 'SIGKILL') reject(new Error(`Boundary failed ${code} ${errors}`));
      else resolve(actual);
    });
  });
  return { signal, output };
}

describe('durable ledger, processes, and artifacts', () => {
  for (const boundary of ['before-commit', 'after-commit', 'before-publication', 'before-acknowledgment'])
    it(`recovers real SIGKILL at ${boundary}`, async () => {
      const h = harness();
      const path = join(h.root, 'ledger.sqlite');
      try {
        h.approve();
        const before = h.mission();
        h.ledger.close();
        const observed = await crash(path, boundary);
        expect(observed.signal).toBe('SIGKILL');
        const reopened = new SqliteLedger({ path });
        try {
          const recovered = reopened.read('mission-a');
          expect(recovered).toBeDefined();
          expect(recovered?.tasks.research?.attempts.length).toBe(boundary === 'before-commit' ? 0 : 1);
          expect(recovered?.version).toBe(before.version + (boundary === 'before-commit' ? 0 : 1));
          if (boundary !== 'before-commit') {
            const attempt = recovered!.tasks.research!.attempts.at(-1)!;
            const coordinator = new Coordinator(reopened, {
              clock: () => 1000,
              operatorId: 'fixture-operator',
              resolveResource: (path) => path,
              verifyArtifact: () => false,
              verifyEvidence: () => false,
            });
            expect(() =>
              coordinator
                .worker({
                  missionId: recovered!.id,
                  taskId: 'research',
                  attemptId: attempt.id,
                  token: attempt.token,
                  planHash: recovered!.planHash,
                  epoch: attempt.epoch,
                })
                .heartbeat('old-epoch'),
            ).toThrow('STALE_ATTEMPT');
          }

          const snapshot = reopened.snapshot();
          const events = reopened.events(snapshot.ledgerId, 0);
          expect(events.filter((event) => event.kind === 'attempt.claimed')).toHaveLength(
            boundary === 'before-commit' ? 0 : 1,
          );
          expect(reopened.pendingOutbox().some((event) => event.kind === 'attempt.claimed')).toBe(
            boundary !== 'before-commit',
          );
          expect(() => reopened.verify()).not.toThrow();
          if (boundary === 'after-commit') {
            const coordinator = new Coordinator(reopened, {
              clock: () => 1000,
              operatorId: 'fixture-operator',
              resolveResource: (path) => path,
              verifyArtifact: () => false,
              verifyEvidence: () => false,
            });
            coordinator.recoverFake('mission-a', 'recover-dead-fake');
            expect(reopened.read('mission-a')?.tasks.research?.attempts[0]?.status).toBe('lost');
            const retry = coordinator.dispatch('retry-after-recovery');
            expect(retry).not.toBeNull();
            expect(reopened.read('mission-a')?.tasks.research?.attempts.at(-1)?.number).toBe(2);
            coordinator.requestStop(retry!, 'stop-retry');
            coordinator.confirmStopped(retry!, 'stopped-retry');
            expect(reopened.read('mission-a')?.tasks.research?.reason).toBe('ATTEMPT_BUDGET');
            expect(coordinator.dispatch('no-third-attempt')).toBeNull();
            reopened.verify();
          }
        } finally {
          reopened.close();
        }
      } finally {
        h.dispose();
      }
    });

  it('rejects a second live owner, supports readonly snapshots, and bounds real write contention', () => {
    const h = harness();
    const path = join(h.root, 'ledger.sqlite');
    try {
      h.approve();
      expect(() => new SqliteLedger({ path })).toThrow('COORDINATOR_ACTIVE');
      const reader = new SqliteLedger({ path, readonly: true });
      try {
        const before = reader.snapshot();
        h.claim();
        const after = reader.events(before.ledgerId, before.cursor);
        let projection: unknown = before.missions[0];
        for (const event of after)
          if (event.missionId === 'mission-a')
            projection = applyPatch(projection, JSON.parse(event.payload).patches);
        expect(canonical(projection)).toBe(canonical(h.mission()));
        expect(() =>
          reader.transact('x', 'y', digest({}), 1000, () => {
            throw new Error('must not decide');
          }),
        ).toThrow('STALE_COORDINATOR');
        expect(() => reader.events('foreign', 0)).toThrow('CURSOR_LEDGER_MISMATCH');
        expect(() => reader.events(before.ledgerId, 99999)).toThrow('CURSOR_LEDGER_MISMATCH');
      } finally {
        reader.close();
      }
      const blocker = raw(path);
      blocker.exec('BEGIN IMMEDIATE');
      const start = performance.now();
      try {
        expect(() => h.coordinator.dispatch('busy')).toThrow(/locked/);
        expect(performance.now() - start).toBeLessThan(1500);
      } finally {
        blocker.exec('ROLLBACK');
        blocker.close();
      }
      h.ledger.verify();
    } finally {
      h.dispose();
    }
  });

  it('deduplicates commits and outbox acknowledgments, rejecting changed input/hash', () => {
    const h = harness();
    try {
      h.approve();
      const first = h.coordinator.dispatch('same');
      const cursor = h.ledger.snapshot().cursor;
      expect(h.coordinator.dispatch('same')).toEqual(first);
      expect(h.ledger.snapshot().cursor).toBe(cursor);
      expect(() =>
        h.ledger.transact('factory:scheduler', 'same', digest({ altered: true }), 1000, () => {
          throw new Error('wrong');
        }),
      ).toThrow('IDEMPOTENCY_CONFLICT');
      const event = h.ledger.pendingOutbox().at(-1);
      expect(event).toBeDefined();
      expect(() => h.ledger.acknowledge(event!.cursor, '0'.repeat(64))).toThrow('OUTBOX_ACK_MISMATCH');
      h.ledger.acknowledge(event!.cursor, event!.hash);
      h.ledger.acknowledge(event!.cursor, event!.hash);
      expect(h.ledger.pendingOutbox().some((item) => item.cursor === event!.cursor)).toBe(false);
    } finally {
      h.dispose();
    }
  });

  for (const mutation of ['altered', 'future', 'journal', 'projection'])
    it(`fails closed on ${mutation} database state`, () => {
      const h = harness();
      const path = join(h.root, 'ledger.sqlite');
      try {
        h.approve();
        h.ledger.close();
        const db = raw(path);
        if (mutation === 'altered')
          db.prepare('UPDATE schema_migrations SET checksum = ? WHERE version = 1').run('bad');
        if (mutation === 'future') db.prepare('INSERT INTO schema_migrations VALUES (99, ?)').run('future');
        if (mutation === 'journal') db.prepare('UPDATE events SET payload = ? WHERE cursor = 2').run('{}');
        if (mutation === 'projection') db.prepare('UPDATE missions SET projection = ?').run('{}');
        db.close();
        expect(() => new SqliteLedger({ path })).toThrow(
          /MIGRATION_CHANGED_OR_FUTURE|JOURNAL_CORRUPTION|PROJECTION_CORRUPTION/,
        );
      } finally {
        h.dispose();
      }
    });

  for (const code of ['SQLITE_FULL', 'SQLITE_IOERR'])
    it(`rolls back all state on injected ${code}`, () => {
      let enabled = false;
      const h = harness({
        fault(stage) {
          if (enabled && stage === 'before-commit') throw Object.assign(new Error(code), { code });
        },
      });
      try {
        h.approve();
        const snapshot = h.ledger.snapshot();
        enabled = true;
        expect(() => h.coordinator.dispatch('fault')).toThrow(code);
        expect(h.ledger.snapshot()).toEqual(snapshot);
        enabled = false;
        expect(h.coordinator.dispatch('fault')).not.toBeNull();
        h.ledger.verify();
      } finally {
        h.dispose();
      }
    });

  it('backs up consistently, restores into new inactive authority, and repeats migrations', async () => {
    const h = harness();
    try {
      h.approve();
      const lease = h.claim();
      await expect(h.ledger.backup('active')).rejects.toThrow('QUIESCENCE');
      h.complete(lease);
      const snapshot = h.ledger.snapshot();
      const path = await h.ledger.backup('qualified');
      const restored = SqliteLedger.restoreInactive(path, join(h.root, 'restored.sqlite'));
      try {
        const result = restored.snapshot();
        expect(result.ledgerId).not.toBe(snapshot.ledgerId);
        expect(result.round).toBe(snapshot.round);
        expect(result.missions[0]?.approval).toBeNull();
        expect(result.missions[0]?.status).toBe('awaiting_plan_approval');
        expect(result.missions[0]?.tasks).toEqual(snapshot.missions[0]?.tasks);
        expect(() => restored.verify()).not.toThrow();
        expect(restored.pendingOutbox().some((event) => event.kind === 'restore.imported_inactive')).toBe(
          true,
        );
      } finally {
        restored.close();
      }
      h.ledger.close();
      const reopened = new SqliteLedger({ path: join(h.root, 'ledger.sqlite') });
      reopened.verify();
      reopened.close();
    } finally {
      h.dispose();
    }
  });

  it('rejects symlinks, scope swaps, oversized artifacts and tampering; exposes orphan bytes after rename', () => {
    const h = harness();
    try {
      h.approve();
      const lease = h.claim();
      expect(() => h.artifacts.putOutput({ ...lease, missionId: '../escape' }, 'research', {})).toThrow(
        'ARTIFACT_SCOPE',
      );
      expect(() => h.artifacts.putOutput(lease, 'research', 'x'.repeat(8 * 1024 * 1024))).toThrow(
        'ARTIFACT_SIZE',
      );
      const orphanStore = new ArtifactStore(join(h.root, 'orphans'), (stage) => {
        if (stage === 'after-artifact-rename') throw new Error('simulated crash after rename');
      });
      expect(() => orphanStore.putOutput(lease, 'research', { orphan: true })).toThrow('simulated crash');
      const names = readdirSync(join(h.root, 'orphans', lease.missionId));
      expect(names).toHaveLength(1);
      expect(names[0]).toMatch(/^[a-f0-9]{64}$/);
      expect(h.mission().tasks.research?.outputDigest).toBeNull();
      const hash = h.artifacts.putOutput(lease, 'research', { facts: true });
      expect(h.artifacts.putOutput(lease, 'research', { facts: true })).toBe(hash);
      const budgetFile = join(h.artifacts.root, lease.missionId, '0'.repeat(64));
      writeFileSync(budgetFile, '');
      truncateSync(budgetFile, 128 * 1024 * 1024);
      expect(() => h.artifacts.putOutput(lease, 'research', { exceedsMissionBudget: true })).toThrow(
        'ARTIFACT_MISSION_BUDGET',
      );
      unlinkSync(budgetFile);
      expect(h.artifacts.verifyOutput({ ...lease, missionId: 'mission-b' }, hash)).toBe(false);
      writeFileSync(join(h.artifacts.root, lease.missionId, hash), 'changed');
      expect(h.artifacts.verifyOutput(lease, hash)).toBe(false);
      mkdirSync(join(h.root, 'outside'));
      symlinkSync(join(h.root, 'outside'), join(h.artifacts.root, 'linked'));
      expect(() => h.artifacts.putOutput({ ...lease, missionId: 'linked' }, 'research', {})).toThrow(
        'ARTIFACT_SYMLINK',
      );
      symlinkSync(join(h.root, 'outside'), join(h.root, 'state-link'));
      expect(() => new SqliteLedger({ path: join(h.root, 'state-link', 'ledger.sqlite') })).toThrow(
        'STATE_SYMLINK',
      );
    } finally {
      h.dispose();
    }
  });

  it('replays generated JSON patches against an independent target', () => {
    const json = fc.letrec<{ value: unknown }>((tie) => ({
      value: fc.oneof(
        fc.constant(null),
        fc.boolean(),
        fc.integer(),
        fc.string(),
        fc.array(tie('value'), { maxLength: 5 }),
        fc.dictionary(
          fc
            .string({ maxLength: 12 })
            .filter((key) => !['__proto__', 'constructor', 'prototype'].includes(key)),
          tie('value'),
          { maxKeys: 5 },
        ),
      ),
    })).value;
    fc.assert(
      fc.property(json, json, (before, after) => {
        expect(canonical(applyPatch(before, difference(before, after)))).toBe(canonical(after));
      }),
      { seed: 20261030, numRuns: 100 },
    );
    expect(() => applyPatch({}, [{ path: ['__proto__'], value: true }])).toThrow();
    expect(applyPatch({ '': 1 }, difference({ '': 1 }, { '': 2 }))).toEqual({ '': 2 });
  });
});
