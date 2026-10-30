// SPDX-License-Identifier: Apache-2.0
/** Reviewed explicit SQL; no runtime schema generation or destructive automatic reset. */
export const MIGRATIONS = [
  `CREATE TABLE metadata (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL);
CREATE TABLE missions (id TEXT PRIMARY KEY, version INTEGER NOT NULL CHECK(version > 0), projection TEXT NOT NULL, hash TEXT NOT NULL);
CREATE TABLE events (cursor INTEGER PRIMARY KEY, ledger_id TEXT NOT NULL, mission_id TEXT NOT NULL, kind TEXT NOT NULL, plan_hash TEXT NOT NULL, at INTEGER NOT NULL, previous_hash TEXT NOT NULL, hash TEXT NOT NULL UNIQUE, payload TEXT NOT NULL);
CREATE TABLE outbox (cursor INTEGER PRIMARY KEY REFERENCES events(cursor), published INTEGER NOT NULL DEFAULT 0 CHECK(published IN (0, 1)));
CREATE TABLE deduplication (scope TEXT NOT NULL, request_id TEXT NOT NULL, input_hash TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY(scope, request_id));`,
  `CREATE INDEX events_mission_cursor ON events(mission_id, cursor);
CREATE INDEX outbox_pending ON outbox(published, cursor);
ALTER TABLE outbox ADD COLUMN acknowledged_at INTEGER;`,
] as const;
