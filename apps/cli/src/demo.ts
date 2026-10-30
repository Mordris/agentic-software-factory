// SPDX-License-Identifier: Apache-2.0
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ensure } from '@asf/protocol';
import { resumeDemo } from './fixtures.js';

export async function runDemo(state: string) {
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL('./main.js', import.meta.url)), 'fixture-pause', '--state', state],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  let errors = '';
  const killed = await new Promise<{ signal: NodeJS.Signals | null; pid: number | undefined }>(
    (resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`OWNED_DEMO_TIMEOUT: ${errors}`));
      }, 8000);
      child.stdout.on('data', (data) => {
        output += String(data);
        if (output.includes('"boundary":"ready-for-owned-kill"')) child.kill('SIGKILL');
      });
      child.stderr.on('data', (data) => {
        errors += String(data);
      });
      child.on('error', reject);
      child.on('exit', (code, signal) => {
        clearTimeout(timer);
        if (signal !== 'SIGKILL') reject(new Error(`DEMO_CHILD_FAILED: ${code} ${errors}${output}`));
        else resolve({ signal, pid: child.pid });
      });
    },
  );
  ensure(killed.signal === 'SIGKILL', 'DEMO_PROCESS_NOT_KILLED');
  return { ...resumeDemo(state), ownedCrash: killed };
}
