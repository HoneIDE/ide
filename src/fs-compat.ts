import { statSync } from 'fs';

// Perry's `fs` module dropped its top-level `isDirectory(path)` helper
// (upstream @perryts/perry). Shim it via statSync so existing call sites
// keep their "false for missing/non-dir" semantics.
export function isDirectory(path: string): boolean {
  try {
    const st = statSync(path);
    return st.isDirectory();
  } catch (e: any) {
    return false;
  }
}
