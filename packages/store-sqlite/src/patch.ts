// SPDX-License-Identifier: Apache-2.0
import { canonical, ensure } from '@asf/protocol';

export interface Patch {
  path: string[];
  value?: unknown;
  remove?: true;
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function difference(before: unknown, after: unknown, path: string[] = []): Patch[] {
  if (canonical(before) === canonical(after)) return [];
  if (!object(before) || !object(after)) return [{ path, value: after }];
  const result: Patch[] = [];
  for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    if (!Object.hasOwn(after, key)) result.push({ path: [...path, key], remove: true });
    else if (!Object.hasOwn(before, key)) result.push({ path: [...path, key], value: after[key] });
    else result.push(...difference(before[key], after[key], [...path, key]));
  }
  return result;
}
export function applyPatch(before: unknown, patches: Patch[]): unknown {
  let result = structuredClone(before);
  for (const patch of patches) {
    ensure(
      patch.path.every((key) => !['__proto__', 'constructor', 'prototype'].includes(key)),
      'UNSAFE_PATCH',
    );
    if (patch.path.length === 0) {
      ensure(!patch.remove, 'INVALID_ROOT_PATCH');
      result = structuredClone(patch.value);
      continue;
    }
    let target = result;
    for (const key of patch.path.slice(0, -1)) {
      ensure(object(target) && Object.hasOwn(target, key), 'INVALID_PATCH_PATH');
      target = target[key];
    }
    const key = patch.path.at(-1);
    ensure(key !== undefined && object(target), 'INVALID_PATCH_PATH');
    if (patch.remove) delete target[key];
    else target[key] = structuredClone(patch.value);
  }
  return result;
}
