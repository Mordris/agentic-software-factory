// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto';
import { canonical } from '@asf/protocol';
export function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
