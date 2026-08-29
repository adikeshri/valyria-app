// Typed wrappers over the host's local-read repository commands
// (apps/desktop/src-tauri/src/bridge_host.rs → crates/valyria-bridge). These
// are a display fallback strictly scoped to the authorized workspace root
// (CORE-INTERFACE §3) and are labeled "served locally" in the UI. Each flips
// to a Core method when G3 lands.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface DirEntry {
  path: string;
  name: string;
  kind: "dir" | "file" | "symlink" | "other";
  size: number;
}

export interface FileView {
  path: string;
  encoding: "utf8" | "binary";
  text: string | null;
  byte_len: number;
  truncated: boolean;
}

export interface GitEntry {
  path: string;
  /** modified | added | deleted | renamed | copied | conflicted | untracked */
  status: string;
  staged: boolean;
}

export interface GitCommit {
  hash: string;
  short_hash: string;
  author: string;
  rel_time: string;
  subject: string;
}

export const repo = {
  listDir: (path: string) => invoke<DirEntry[]>("fs_list_dir", { path }),
  readFile: (path: string) => invoke<FileView>("fs_read_file", { path }),
  search: (query: string, limit = 200) =>
    invoke<string[]>("fs_search", { query, limit }),
  gitStatus: () => invoke<GitEntry[]>("git_status"),
  gitLog: (limit: number) => invoke<GitCommit[]>("git_log", { limit }),
  gitDiff: (path: string | null, staged: boolean) =>
    invoke<string>("git_diff", { path, staged }),
  /** Unified diff for one file, including a synthesized all-additions diff
   *  when the agent's file is still untracked. */
  gitDiffFile: (path: string) => invoke<string>("git_diff_file", { path }),
  /** Contents of a path at HEAD — the "before" side of a review diff.
   *  Empty string when the file is new. */
  gitShowHead: (path: string) => invoke<string>("git_show_head", { path }),
  gitBranch: () => invoke<string>("git_branch"),
  /** `core://fs-changed` → batch of paths (relative, forward-slashed). */
  onFsChanged: (cb: (paths: string[]) => void): Promise<UnlistenFn> =>
    listen<string[]>("core://fs-changed", (e) => cb(e.payload)),
};
