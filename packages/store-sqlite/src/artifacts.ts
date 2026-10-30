// SPDX-License-Identifier: Apache-2.0

import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Lease } from '@asf/core';
import type { Evidence, LabId } from '@asf/protocol';
import { canonical, ensure } from '@asf/protocol';

interface Artifact {
  schemaVersion: 1;
  missionId: string;
  taskId: string;
  attemptId: string;
  planHash: string;
  lab: LabId;
  kind: 'output' | 'evidence';
  body: unknown;
}
export class ArtifactStore {
  readonly root: string;
  readonly #fault: ((stage: string) => void) | undefined;
  constructor(root: string, fault?: (stage: string) => void) {
    this.root = resolve(root);
    this.#fault = fault;
    for (let parent = this.root; ; parent = dirname(parent)) {
      if (existsSync(parent)) ensure(!lstatSync(parent).isSymbolicLink(), 'ARTIFACT_SYMLINK');
      if (dirname(parent) === parent) break;
    }
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    ensure(lstatSync(this.root).uid === process.getuid?.(), 'ARTIFACT_OWNERSHIP');
  }
  #directory(missionId: string): string {
    ensure(
      /^(?!(?:constructor|prototype)$)[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(missionId),
      'ARTIFACT_SCOPE',
    );
    const directory = join(this.root, missionId);
    if (existsSync(directory))
      ensure(
        lstatSync(directory).isDirectory() && !lstatSync(directory).isSymbolicLink(),
        'ARTIFACT_SYMLINK',
      );
    return directory;
  }
  #file(missionId: string, hash: string): string {
    ensure(/^[a-f0-9]{64}$/.test(hash), 'ARTIFACT_DIGEST');
    return join(this.#directory(missionId), hash);
  }
  #put(lease: Lease, lab: LabId, kind: Artifact['kind'], body: unknown): string {
    const record: Artifact = {
      schemaVersion: 1,
      missionId: lease.missionId,
      taskId: lease.taskId,
      attemptId: lease.attemptId,
      planHash: lease.planHash,
      lab,
      kind,
      body,
    };
    const bytes = Buffer.from(canonical(record));
    ensure(bytes.length <= 8 * 1024 * 1024, 'ARTIFACT_SIZE');
    const hash = createHash('sha256').update(bytes).digest('hex');
    const directory = this.#directory(lease.missionId);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const target = this.#file(lease.missionId, hash);
    if (existsSync(target)) {
      this.read(lease.missionId, hash);
      return hash;
    }
    const used = readdirSync(directory).reduce((sum, name) => {
      const entry = lstatSync(join(directory, name));
      ensure(entry.isFile() && !entry.isSymbolicLink(), 'ARTIFACT_SYMLINK');
      return sum + entry.size;
    }, 0);
    ensure(used + bytes.length <= 128 * 1024 * 1024, 'ARTIFACT_MISSION_BUDGET');
    const temporary = join(directory, `.tmp-${randomUUID()}`);
    let fd: number | undefined;
    try {
      fd = openSync(
        temporary,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600,
      );
      writeFileSync(fd, bytes);
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      this.#fault?.('before-artifact-rename');
      renameSync(temporary, target);
      const parent = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY);
      try {
        fsyncSync(parent);
      } finally {
        closeSync(parent);
      }
      this.#fault?.('after-artifact-rename');
      return hash;
    } finally {
      if (fd !== undefined) closeSync(fd);
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }
  putOutput(lease: Lease, lab: LabId, body: unknown): string {
    return this.#put(lease, lab, 'output', body);
  }
  putEvidence(lease: Lease, lab: LabId, body: Omit<Evidence, 'artifactDigest'>): Evidence {
    ensure(
      ['qa', 'security'].includes(lab) &&
        body.missionId === lease.missionId &&
        body.planHash === lease.planHash &&
        body.producingAttemptId === lease.attemptId,
      'RECEIPT_SCOPE',
    );
    return { ...body, artifactDigest: this.#put(lease, lab, 'evidence', body) };
  }
  read(missionId: string, hash: string): Artifact {
    const file = this.#file(missionId, hash);
    const entry = lstatSync(file);
    ensure(
      entry.isFile() && !entry.isSymbolicLink() && entry.size <= 8 * 1024 * 1024,
      'ARTIFACT_FILE_POLICY',
    );
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const bytes = readFileSync(fd);
      ensure(createHash('sha256').update(bytes).digest('hex') === hash, 'ARTIFACT_TAMPERED');
      const record = JSON.parse(bytes.toString()) as Artifact;
      ensure(record.schemaVersion === 1 && record.missionId === missionId, 'ARTIFACT_SCOPE');
      return record;
    } finally {
      closeSync(fd);
    }
  }
  verifyOutput(lease: Lease, hash: string, expectedLab?: LabId): boolean {
    try {
      const record = this.read(lease.missionId, hash);
      return (
        record.kind === 'output' &&
        record.taskId === lease.taskId &&
        record.attemptId === lease.attemptId &&
        record.planHash === lease.planHash &&
        (expectedLab === undefined || record.lab === expectedLab)
      );
    } catch {
      return false;
    }
  }
  verifyEvidence(evidence: Evidence, producerTaskId: string): boolean {
    try {
      const record = this.read(evidence.missionId, evidence.artifactDigest);
      const { artifactDigest: _hash, ...body } = evidence;
      return (
        record.kind === 'evidence' &&
        ['qa', 'security'].includes(record.lab) &&
        record.taskId === producerTaskId &&
        record.attemptId === evidence.producingAttemptId &&
        record.planHash === evidence.planHash &&
        canonical(record.body) === canonical(body)
      );
    } catch {
      return false;
    }
  }
}
