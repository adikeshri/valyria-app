// Selectors over the normalized store. Every panel is one of these (PLAN D4).
// Pure; sort on `seq`, never wall clock (PLAN §3).

import type { StoreState, TaskProjection, RawEventRow } from "./store.js";

export function tasksByRecency(state: StoreState): TaskProjection[] {
  return Object.values(state.tasks).sort((a, b) => b.lastSeq - a.lastSeq);
}

export function activeTasks(state: StoreState): TaskProjection[] {
  return tasksByRecency(state).filter((t) => !t.terminal);
}

export function taskById(state: StoreState, id: string): TaskProjection | undefined {
  return state.tasks[id];
}

export function eventsForTask(state: StoreState, taskId: string): RawEventRow[] {
  return state.events.filter((e) => e.taskId === taskId);
}

/** Rows the decoder could not type — surfaced with a raw-payload disclosure (D5). */
export function degradedEvents(state: StoreState): RawEventRow[] {
  return state.events.filter((e) => e.degraded);
}

export function needsResubscribe(state: StoreState): boolean {
  return state.gapDetected;
}
