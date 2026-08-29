// Local OS notifications (docs/PLAN.md §31, §4.17). Opt-in per category, no
// push infrastructure, no telemetry. A no-op outside the Tauri shell.

import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { inTauri } from "./bridge";

export type NotifyCategory =
  | "completed"
  | "failed"
  | "blocked"
  | "permission"
  | "tests-failed";

export const NOTIFY_CATEGORIES: { key: NotifyCategory; label: string }[] = [
  { key: "completed", label: "Task completed" },
  { key: "failed", label: "Task failed" },
  { key: "blocked", label: "Task blocked" },
  { key: "permission", label: "Permission required" },
  { key: "tests-failed", label: "Tests failed" },
];

const LS_KEY = "valyria.notify.prefs";

export type NotifyPrefs = Record<NotifyCategory, boolean>;

const ALL_ON: NotifyPrefs = {
  completed: true,
  failed: true,
  blocked: true,
  permission: true,
  "tests-failed": true,
};

export function loadPrefs(): NotifyPrefs {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...ALL_ON };
    const parsed = JSON.parse(raw) as Partial<NotifyPrefs>;
    return { ...ALL_ON, ...parsed };
  } catch {
    return { ...ALL_ON };
  }
}

export function savePrefs(prefs: NotifyPrefs): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(prefs));
  } catch {
    /* private mode / storage disabled — notifications just stay at defaults */
  }
}

let granted: boolean | null = null;

async function ensurePermission(): Promise<boolean> {
  if (!inTauri) return false;
  if (granted !== null) return granted;
  try {
    granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
  } catch {
    granted = false;
  }
  return granted;
}

/** Fire a notification if the category is enabled and the OS granted permission.
 *  Silently does nothing otherwise. */
export async function notify(
  category: NotifyCategory,
  title: string,
  body: string,
  masterEnabled: boolean,
): Promise<void> {
  if (!masterEnabled) return;
  if (!loadPrefs()[category]) return;
  if (!(await ensurePermission())) return;
  try {
    sendNotification({ title, body });
  } catch {
    /* not fatal */
  }
}
