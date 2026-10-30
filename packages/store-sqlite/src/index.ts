// SPDX-License-Identifier: Apache-2.0
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  statfsSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Change, JournalEvent, Ledger, Mission, Snapshot, View } from '@asf/core';
import { activeTasks, digest } from '@asf/core';
import { canonical, ensure } from '@asf/protocol';
import Database from 'better-sqlite3';
import { MIGRATIONS } from './migrations.js';
import type { Patch } from './patch.js';
import { applyPatch, difference } from './patch.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TOOLCHAIN = JSON.parse(readFileSync(join(ROOT, 'toolchain.json'), 'utf8')) as {
  node: { version: string };
  sqlite: { version: string; source_id: string };
};
interface Owner {
  pid: number;
  start: string;
  boot: string;
  host: string;
  token: string;
}
interface Metadata {
  ledgerId: string;
  epoch: number;
  owner: Owner | null;
  round: number;
  cursor: number;
  hash: string;
  lastAt: number;
}
export interface StoreOptions {
  path: string;
  readonly?: boolean;
  binding?: string;
  fault?: (stage: string) => void;
}
interface Row {
  cursor: number;
  ledger_id: string;
  mission_id: string;
  kind: string;
  plan_hash: string;
  at: number;
  previous_hash: string;
  hash: string;
  payload: string;
}

function owner(): Owner {
  const stat = readFileSync('/proc/self/stat', 'utf8');
  const start = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
  ensure(start, 'PROCESS_IDENTITY_UNAVAILABLE');
  return {
    pid: process.pid,
    start,
    boot: readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(),
    host: createHash('sha256').update(readFileSync('/etc/machine-id')).digest('hex'),
    token: randomUUID(),
  };
}
function alive(previous: Owner, current: Owner): boolean {
  ensure(previous.host === current.host, 'FOREIGN_COORDINATOR_HOST');
  if (previous.boot !== current.boot) return false;
  try {
    const stat = readFileSync(`/proc/${previous.pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] === previous.start;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    return true;
  }
}
function event(row: Row): JournalEvent {
  return {
    cursor: row.cursor,
    ledgerId: row.ledger_id,
    missionId: row.mission_id,
    kind: row.kind,
    planHash: row.plan_hash,
    at: row.at,
    previousHash: row.previous_hash,
    hash: row.hash,
    payload: row.payload,
  };
}
function eventDigest(value: Omit<JournalEvent, 'hash'>): string {
  return digest(value);
}
function checkDirectory(path: string, readonly: boolean): void {
  for (let current = dirname(path); ; current = dirname(current)) {
    if (existsSync(current)) ensure(!lstatSync(current).isSymbolicLink(), 'STATE_SYMLINK');
    if (dirname(current) === current) break;
  }
  if (!readonly) mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const parent = lstatSync(dirname(path));
  ensure(parent.isDirectory() && parent.uid === process.getuid?.(), 'STATE_OWNERSHIP');
  const local = [0xef53, 0x9123683e, 0x58465342, 0x01021994, 0x794c7630];
  ensure(local.includes(statfsSync(dirname(path)).type), 'UNQUALIFIED_FILESYSTEM');
  if (existsSync(path)) {
    const entry = lstatSync(path);
    ensure(
      entry.isFile() &&
        !entry.isSymbolicLink() &&
        entry.uid === process.getuid?.() &&
        (entry.mode & 0o077) === 0,
      'STATE_FILE_POLICY',
    );
  }
}

export class SqliteLedger implements Ledger {
  readonly #db: Database.Database;
  readonly #options: StoreOptions;
  readonly #owner: Owner;
  #epoch = 0;
  #closed = false;
  #maintenance = false;
  get epoch(): number {
    return this.#epoch;
  }
  constructor(options: StoreOptions) {
    ensure(process.versions.node === TOOLCHAIN.node.version, 'NODE_VERSION_MISMATCH');
    this.#options = options;
    this.#owner = owner();
    const binding =
      options.binding ??
      join(ROOT, '.factory/native', `sqlite-${TOOLCHAIN.sqlite.version}`, 'better_sqlite3.node');
    ensure(existsSync(binding), 'QUALIFIED_SQLITE_BINDING_MISSING');
    const probe = new Database(':memory:', { nativeBinding: binding });
    try {
      const identity = probe.prepare('SELECT sqlite_version() version, sqlite_source_id() source').get() as {
        version: string;
        source: string;
      };
      ensure(
        identity.version === TOOLCHAIN.sqlite.version && identity.source === TOOLCHAIN.sqlite.source_id,
        'SQLITE_IDENTITY_MISMATCH',
      );
    } finally {
      probe.close();
    }
    const path = resolve(options.path);
    checkDirectory(path, options.readonly ?? false);
    if (!existsSync(path) && !options.readonly) writeFileSync(path, '', { flag: 'wx', mode: 0o600 });
    this.#db = new Database(path, {
      nativeBinding: binding,
      readonly: options.readonly ?? false,
      fileMustExist: true,
      timeout: 250,
    });
    try {
      this.#db.pragma('foreign_keys = ON');
      this.#db.pragma('synchronous = FULL');
      if (!options.readonly) this.#db.pragma('journal_mode = WAL');
      const journal = this.#db.pragma('journal_mode', { simple: true });
      ensure(
        (journal === 'wal' || (options.readonly && journal === 'delete')) &&
          this.#db.pragma('synchronous', { simple: true }) === 2 &&
          this.#db.pragma('foreign_keys', { simple: true }) === 1,
        'DATABASE_SETTINGS_MISMATCH',
      );
      this.#migrate(options.readonly ?? false);
      this.verify();
      if (!options.readonly)
        this.#transaction(() => {
          const metadata = this.#metadata();
          ensure(!metadata.owner || !alive(metadata.owner, this.#owner), 'COORDINATOR_ACTIVE');
          metadata.owner = this.#owner;
          metadata.epoch++;
          this.#epoch = metadata.epoch;
          this.#control(metadata, 'coordinator.claimed');
        });
      else this.#epoch = this.#metadata().epoch;
      this.verify();
    } catch (error) {
      this.#db.close();
      throw error;
    }
  }
  #transaction<T>(operation: () => T): T {
    ensure(!this.#closed, 'LEDGER_CLOSED');
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.#db.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.#db.inTransaction) this.#db.exec('ROLLBACK');
      throw error;
    }
  }
  #migrate(readonly: boolean): void {
    if (!readonly)
      this.#db.exec(
        'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, checksum TEXT NOT NULL)',
      );
    const rows = this.#db
      .prepare('SELECT version, checksum FROM schema_migrations ORDER BY version')
      .all() as { version: number; checksum: string }[];
    ensure(
      rows.length <= MIGRATIONS.length &&
        rows.every((row, index) => row.version === index + 1 && row.checksum === digest(MIGRATIONS[index])),
      'MIGRATION_CHANGED_OR_FUTURE',
    );
    if (readonly) {
      ensure(rows.length === MIGRATIONS.length, 'MIGRATION_REQUIRED');
      return;
    }
    this.#transaction(() => {
      for (let index = rows.length; index < MIGRATIONS.length; index++) {
        const migration = MIGRATIONS[index];
        ensure(migration, 'UNKNOWN_MIGRATION');
        this.#db.exec(migration);
        this.#db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(index + 1, digest(migration));
      }
      const existing = this.#db.prepare('SELECT data FROM metadata WHERE id = 1').get();
      if (!existing)
        this.#db.prepare('INSERT INTO metadata VALUES (1, ?)').run(
          canonical({
            ledgerId: randomUUID(),
            epoch: 0,
            owner: null,
            round: 0,
            cursor: 0,
            hash: '0'.repeat(64),
            lastAt: 0,
          }),
        );
    });
  }
  #metadata(): Metadata {
    const row = this.#db.prepare('SELECT data FROM metadata WHERE id = 1').get() as
      | { data: string }
      | undefined;
    ensure(row, 'METADATA_MISSING');
    return JSON.parse(row.data) as Metadata;
  }
  #setMetadata(metadata: Metadata): void {
    this.#db.prepare('UPDATE metadata SET data = ? WHERE id = 1').run(canonical(metadata));
  }
  #control(metadata: Metadata, kind: string): void {
    const payload = canonical({
      schemaVersion: 1,
      patches: [],
      details: { epoch: metadata.epoch, hostId: this.#owner.host },
      round: metadata.round,
    });
    const base = {
      cursor: metadata.cursor + 1,
      ledgerId: metadata.ledgerId,
      missionId: '',
      kind,
      planHash: '0'.repeat(64),
      at: Math.max(Date.now(), metadata.lastAt),
      previousHash: metadata.hash,
      payload,
    };
    const hash = eventDigest(base);
    this.#db
      .prepare('INSERT INTO events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        base.cursor,
        base.ledgerId,
        base.missionId,
        base.kind,
        base.planHash,
        base.at,
        base.previousHash,
        hash,
        payload,
      );
    this.#db.prepare('INSERT INTO outbox (cursor, published) VALUES (?, 0)').run(base.cursor);
    metadata.cursor = base.cursor;
    metadata.hash = hash;
    metadata.lastAt = base.at;
    this.#setMetadata(metadata);
  }
  #owns(metadata: Metadata): void {
    ensure(
      !this.#options.readonly &&
        metadata.epoch === this.#epoch &&
        metadata.owner?.token === this.#owner.token,
      'STALE_COORDINATOR',
    );
  }
  #missions(): Mission[] {
    const rows = this.#db.prepare('SELECT projection, hash FROM missions ORDER BY id').all() as {
      projection: string;
      hash: string;
    }[];
    return rows.map((row) => {
      const mission = JSON.parse(row.projection) as Mission;
      ensure(digest(mission) === row.hash, 'PROJECTION_CORRUPTION');
      return mission;
    });
  }
  read(id: string): Mission | undefined {
    return this.#missions().find((mission) => mission.id === id);
  }
  all(): Mission[] {
    return this.#missions();
  }
  transact<T>(
    scope: string,
    requestId: string,
    inputDigest: string,
    now: number,
    decide: (view: View) => Change<T>,
  ): T {
    ensure(!this.#maintenance, 'MAINTENANCE_ACTIVE');
    ensure(scope.length <= 200 && requestId.length > 0 && requestId.length <= 128, 'COMMAND_ID_SIZE');
    const result = this.#transaction(() => {
      const metadata = this.#metadata();
      this.#owns(metadata);
      const previous = this.#db
        .prepare('SELECT input_hash, response FROM deduplication WHERE scope = ? AND request_id = ?')
        .get(scope, requestId) as { input_hash: string; response: string } | undefined;
      if (previous) {
        ensure(previous.input_hash === inputDigest, 'IDEMPOTENCY_CONFLICT');
        return JSON.parse(previous.response) as T;
      }
      const missions = this.#missions();
      const change = decide({
        missions: structuredClone(missions),
        epoch: this.#epoch,
        round: metadata.round,
      });
      if (change.mission) {
        const mission = change.mission;
        const before = missions.find((item) => item.id === mission.id);
        ensure(mission.version === (before?.version ?? 0) + 1, 'PROJECTION_VERSION');
        const projection = canonical(mission);
        ensure(Buffer.byteLength(projection) <= 2 * 1024 * 1024, 'PROJECTION_SIZE');
        const payload = canonical({
          schemaVersion: 1,
          patches: difference(before ?? null, mission),
          details: change.details,
          round: change.round ?? metadata.round,
        });
        ensure(Buffer.byteLength(payload) <= 65536, 'EVENT_SIZE');
        const base = {
          cursor: metadata.cursor + 1,
          ledgerId: metadata.ledgerId,
          missionId: mission.id,
          kind: change.kind,
          planHash: mission.planHash,
          at: Math.max(now, metadata.lastAt),
          previousHash: metadata.hash,
          payload,
        };
        const hash = eventDigest(base);
        this.#db
          .prepare(
            'INSERT INTO missions VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET version = excluded.version, projection = excluded.projection, hash = excluded.hash',
          )
          .run(mission.id, mission.version, projection, digest(mission));
        this.#db
          .prepare('INSERT INTO events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(
            base.cursor,
            base.ledgerId,
            base.missionId,
            base.kind,
            base.planHash,
            base.at,
            base.previousHash,
            hash,
            payload,
          );
        this.#db.prepare('INSERT INTO outbox (cursor, published) VALUES (?, 0)').run(base.cursor);
        metadata.cursor = base.cursor;
        metadata.hash = hash;
        metadata.lastAt = base.at;
        metadata.round = change.round ?? metadata.round;
        this.#setMetadata(metadata);
      }
      this.#db
        .prepare('INSERT INTO deduplication VALUES (?, ?, ?, ?)')
        .run(scope, requestId, inputDigest, canonical(change.value));
      this.#options.fault?.('before-commit');
      return change.value;
    });
    this.#options.fault?.('after-commit');
    return result;
  }
  snapshot(): Snapshot {
    ensure(!this.#closed, 'LEDGER_CLOSED');
    this.#db.exec('BEGIN');
    try {
      const metadata = this.#metadata();
      const result = {
        ledgerId: metadata.ledgerId,
        cursor: metadata.cursor,
        missions: this.#missions(),
        round: metadata.round,
      };
      this.#db.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.#db.inTransaction) this.#db.exec('ROLLBACK');
      throw error;
    }
  }
  events(ledgerId: string, after: number): JournalEvent[] {
    const metadata = this.#metadata();
    ensure(
      ledgerId === metadata.ledgerId && Number.isSafeInteger(after) && after >= 0 && after <= metadata.cursor,
      'CURSOR_LEDGER_MISMATCH',
    );
    return (
      this.#db.prepare('SELECT * FROM events WHERE cursor > ? ORDER BY cursor').all(after) as Row[]
    ).map(event);
  }
  pendingOutbox(limit = 100): JournalEvent[] {
    ensure(Number.isInteger(limit) && limit >= 1 && limit <= 1000, 'OUTBOX_LIMIT');
    this.#options.fault?.('before-publication');
    return (
      this.#db
        .prepare(
          'SELECT events.* FROM outbox JOIN events USING(cursor) WHERE published = 0 ORDER BY cursor LIMIT ?',
        )
        .all(limit) as Row[]
    ).map(event);
  }
  acknowledge(cursor: number, hash: string): void {
    this.#options.fault?.('before-acknowledgment');
    this.#transaction(() => {
      this.#owns(this.#metadata());
      const row = this.#db.prepare('SELECT hash FROM events WHERE cursor = ?').get(cursor) as
        | { hash: string }
        | undefined;
      ensure(row?.hash === hash, 'OUTBOX_ACK_MISMATCH');
      this.#db
        .prepare('UPDATE outbox SET published = 1, acknowledged_at = ? WHERE cursor = ?')
        .run(Date.now(), cursor);
    });
  }
  verify(): void {
    const metadata = this.#metadata();
    const rows = this.#db.prepare('SELECT * FROM events ORDER BY cursor').all() as Row[];
    const missions = new Map<string, unknown>();
    let hash = '0'.repeat(64);
    let cursor = 0;
    let round = 0;
    for (const row of rows) {
      const value = event(row);
      const { hash: actual, ...base } = value;
      ensure(
        value.cursor === ++cursor && value.previousHash === hash && eventDigest(base) === actual,
        'JOURNAL_CORRUPTION',
      );
      const body = JSON.parse(value.payload) as { schemaVersion: number; patches: Patch[]; round: number };
      ensure(body.schemaVersion === 1, 'EVENT_VERSION');
      if (value.missionId !== '')
        missions.set(value.missionId, applyPatch(missions.get(value.missionId) ?? null, body.patches));
      hash = actual;
      round = body.round;
    }
    ensure(
      metadata.cursor === cursor &&
        metadata.hash === hash &&
        metadata.round === round &&
        canonical(
          [...missions.values()].sort((a, b) =>
            String((a as Mission).id).localeCompare(String((b as Mission).id)),
          ),
        ) === canonical(this.#missions()),
      'SNAPSHOT_JOURNAL_DIVERGENCE',
    );
    const foreignKeys = this.#db.pragma('foreign_key_check');
    ensure(
      this.#db.pragma('integrity_check', { simple: true }) === 'ok' &&
        Array.isArray(foreignKeys) &&
        foreignKeys.length === 0,
      'DATABASE_INTEGRITY',
    );
  }
  async backup(name: string): Promise<string> {
    this.#owns(this.#metadata());
    ensure(/^[a-zA-Z0-9_-]{1,80}$/.test(name), 'BACKUP_NAME');
    ensure(
      this.all().every((mission) => activeTasks(mission).length === 0),
      'BACKUP_REQUIRES_QUIESCENCE',
    );
    const directory = join(dirname(resolve(this.#options.path)), 'backups');
    const target = join(directory, `${name}.sqlite`);
    ensure(!existsSync(target), 'BACKUP_EXISTS');
    checkDirectory(target, false);
    this.#maintenance = true;
    try {
      await this.#db.backup(target);
      chmodSync(target, 0o600);
      return target;
    } finally {
      this.#maintenance = false;
    }
  }
  static restoreInactive(source: string, target: string): SqliteLedger {
    ensure(!existsSync(target), 'RESTORE_TARGET_EXISTS');
    const backup = new SqliteLedger({ path: source, readonly: true });
    const snapshot = backup.snapshot();
    backup.close();
    ensure(
      snapshot.missions.every((mission) => activeTasks(mission).length === 0),
      'RESTORE_ACTIVE_ATTEMPTS',
    );
    const restored = new SqliteLedger({ path: target });
    for (const original of snapshot.missions) {
      const mission = structuredClone(original);
      mission.version = 1;
      mission.approval = null;
      mission.status = 'awaiting_plan_approval';
      for (const approval of mission.actions) approval.revoked = true;
      restored.transact(
        mission.id,
        'restore-import',
        digest({ sourceLedger: snapshot.ledgerId, sourceCursor: snapshot.cursor, mission }),
        Date.now(),
        () => ({
          mission,
          kind: 'restore.imported_inactive',
          round: snapshot.round,
          details: {
            sourceLedger: snapshot.ledgerId,
            sourceCursor: snapshot.cursor,
            sourceSha256: createHash('sha256').update(readFileSync(source)).digest('hex'),
          },
          value: null,
        }),
      );
    }
    restored.verify();
    return restored;
  }
  close(): void {
    if (this.#closed) return;
    if (!this.#options.readonly)
      this.#transaction(() => {
        const metadata = this.#metadata();
        if (metadata.epoch === this.#epoch && metadata.owner?.token === this.#owner.token) {
          metadata.owner = null;
          this.#control(metadata, 'coordinator.released');
        }
      });
    this.#db.close();
    this.#closed = true;
  }
}
export { ArtifactStore } from './artifacts.js';
export { applyPatch, difference } from './patch.js';
