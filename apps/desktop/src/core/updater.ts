// Thin wrapper over Tauri's updater (docs/PLAN.md §4.18). "Core updates arrive
// only with an app update" — this checks the app's own GitHub Releases feed
// (endpoint + pubkey in tauri.conf.json), and on a hit downloads and relaunches
// in place. Model weights are never touched by an app update (§38).

import { inTauri } from "./bridge";

export type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "up-to-date" }
  | { kind: "available"; version: string; notes?: string }
  | { kind: "downloading" }
  | { kind: "error"; message: string };

/** Check for an app update. Returns the status; does not install. */
export async function checkForUpdate(): Promise<UpdateStatus> {
  if (!inTauri) {
    return { kind: "error", message: "Updates are only available in the installed desktop app." };
  }
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return { kind: "up-to-date" };
    return { kind: "available", version: update.version, notes: update.body ?? undefined };
  } catch (e) {
    return { kind: "error", message: String(e) };
  }
}

/** Download the pending update and relaunch. Only call after `checkForUpdate`
 *  returned `available`. */
export async function installUpdate(onProgress?: (s: UpdateStatus) => void): Promise<UpdateStatus> {
  if (!inTauri) {
    return { kind: "error", message: "Updates are only available in the installed desktop app." };
  }
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return { kind: "up-to-date" };
    onProgress?.({ kind: "downloading" });
    await update.downloadAndInstall();
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
    return { kind: "downloading" }; // unreachable — the app is relaunching
  } catch (e) {
    return { kind: "error", message: String(e) };
  }
}
