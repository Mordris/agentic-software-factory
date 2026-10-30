// SPDX-License-Identifier: Apache-2.0
import { canonical, ensure, FactoryError } from '@asf/protocol';

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
    ensure(Array.isArray(patch.path), 'INVALID_PATCH_PATH');
    const path = Array.from(patch.path);
    for (const key of path) {
      if (typeof key !== 'string' || key === '__proto__' || key === 'constructor' || key === 'prototype') {
        throw new FactoryError('UNSAFE_PATCH');
      }
    }
    if (path.length === 0) {
      ensure(!patch.remove, 'INVALID_ROOT_PATCH');
      result = structuredClone(patch.value);
      continue;
    }
    let target = result;
    for (const key of path.slice(0, -1)) {
      ensure(object(target) && Object.hasOwn(target, key), 'INVALID_PATCH_PATH');
      target = target[key];
    }
    const key = path.at(-1);
    ensure(key !== undefined && object(target), 'INVALID_PATCH_PATH');
    // Keep the sink guard explicit, and use own data-property operations without setters.
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      throw new FactoryError('UNSAFE_PATCH');
    }
    if (patch.remove) ensure(Reflect.deleteProperty(target, key), 'INVALID_PATCH_PATH');
    else
      Object.defineProperty(target, key, {
        value: structuredClone(patch.value),
        enumerable: true,
        writable: true,
        configurable: true,
      });
  }
  return result;
}
