import { useEffect, useRef, useState } from "react";
import { blockedTasks } from "@valyria/state";
import { useLive } from "../core/liveStore";

const CONNECTION_MESSAGE: Partial<Record<string, string>> = {
  reconnecting: "Reconnecting to Core.",
  degraded: "Core connection degraded — some updates may be delayed.",
  incompatible: "Incompatible Core — see About and Compatibility.",
  ready: "Connected to Core.",
  failed: "Could not connect to Core.",
};

/** A single polite live region (docs/PLAN.md D10 / §46). The app has a lot of
 *  state that changes silently for a screen-reader user — connection
 *  transitions, an approval coming in. This announces the ones that matter. */
export default function LiveRegion() {
  const connection = useLive((s) => s.connection);
  const store = useLive((s) => s.store);
  const [message, setMessage] = useState("");

  const prevConnection = useRef(connection);
  useEffect(() => {
    if (connection !== prevConnection.current) {
      prevConnection.current = connection;
      const m = CONNECTION_MESSAGE[connection];
      if (m) setMessage(m);
    }
  }, [connection]);

  const blockedCount = blockedTasks(store).length;
  const prevBlocked = useRef(blockedCount);
  useEffect(() => {
    if (blockedCount > prevBlocked.current) {
      setMessage(
        blockedCount === 1
          ? "Approval required — a task is waiting on your decision."
          : `${blockedCount} tasks are waiting on your approval.`,
      );
    }
    prevBlocked.current = blockedCount;
  }, [blockedCount]);

  return (
    <div aria-live="polite" role="status" className="visually-hidden">
      {message}
    </div>
  );
}
