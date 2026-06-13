import { spawn, execSync, spawnSync } from 'child_process';
import { openSync } from 'fs';

// Compatibility shims for upstream @perryts/perry, which diverged from the
// custom fork hone was originally built against:
//
//  - execSync/spawnSync now follow Node semantics and return a Buffer unless
//    `{ encoding: 'utf8' }` is passed. The codebase treats the result as a
//    string everywhere, so route every call through these wrappers.
//  - child_process.spawnBackground (a fork-only helper) was removed; reimplement
//    it over the standard `spawn` with { detached: true }.

export function execText(cmd: string): string {
  return execSync(cmd, { encoding: 'utf8' }) as unknown as string;
}

export function spawnText(cmd: string, args: string[]): { stdout: string; stderr: string; status: number } {
  return spawnSync(cmd, args, { encoding: 'utf8' }) as unknown as { stdout: string; stderr: string; status: number };
}

// Fire-and-forget background spawn. The CALLER supplies the platform shell
// (e.g. cmd.exe /c vs /bin/sh -c), so we do NOT re-wrap in a shell here —
// `command`/`args` are spawned directly, which keeps this cross-platform.
//
// The third argument matches the old signature: a string (output-redirect
// target — '/dev/null' or 'NUL' mean discard) or an options object
// { cwd?, logFile? }. When a real logFile is given, output is redirected to it
// via an opened fd (no shell needed); otherwise output is discarded.
export function spawnBackground(command: string, args: string[], options?: string | object): { pid: number; handleId: number } {
  let logFile = '';
  let cwd = '';
  if (typeof options === 'string') {
    const s = options as string;
    if (s.length > 0 && s !== '/dev/null' && s !== 'NUL') logFile = s;
  } else if (options !== null && options !== undefined && typeof options === 'object') {
    const o: any = options;
    if (o.logFile !== undefined && o.logFile !== null) logFile = o.logFile;
    if (o.cwd !== undefined && o.cwd !== null) cwd = o.cwd;
  }

  let stdio: any = 'ignore';
  if (logFile.length > 0) {
    const fd: any = openSync(logFile, 'a');
    stdio = ['ignore', fd, fd];
  }

  const spawnOpts: any = { detached: true, stdio: stdio };
  if (cwd.length > 0) spawnOpts.cwd = cwd;

  const child: any = spawn(command, args, spawnOpts);
  let pid = 0;
  if (child !== null && child !== undefined && child.pid !== undefined && child.pid !== null) {
    pid = child.pid;
  }
  try { child.unref(); } catch (e: any) {}

  return { pid: pid, handleId: 0 };
}
