// Typed wrappers over the host's local-read repository commands
// (apps/desktop/src-tauri/src/bridge_host.rs → crates/valyria-bridge). These
// are a display fallback strictly scoped to the authorized workspace root
// (CORE-INTERFACE §3) and are labeled "served locally" in the UI. Each flips
// to a Core method when G3 lands.

import { invoke } from "@tauri-apps/api/core";

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
  gitStatus: () => invoke<GitEntry[]>("git_status"),
  gitLog: (limit: number) => invoke<GitCommit[]>("git_log", { limit }),
  gitDiff: (path: string | null, staged: boolean) =>
    invoke<string>("git_diff", { path, staged }),
  gitBranch: () => invoke<string>("git_branch"),
};
