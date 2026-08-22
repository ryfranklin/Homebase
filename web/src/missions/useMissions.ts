import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { makeMissionsApi } from "./api";
import { isTerminal, type LaunchInput, type Run, type RunChanges, type RunEvent } from "./types";

export interface UseMissions {
  runs: Run[];
  selected: Run | null;
  events: RunEvent[];
  // The selected run's diff, loaded once it is at the gate or terminal (else null).
  changes: RunChanges | null;
  error: string | null;
  refresh: () => Promise<void>;
  launch: (input: LaunchInput) => Promise<void>;
  select: (id: string) => Promise<void>;
  decide: (id: string, decision: "approve" | "reject" | "scrub" | "cancel") => Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Drives the Mission Control deck: the run list, launching, the go/no-go gate, and a
// selected run's live telemetry (SSE) plus status polling until it terminates.
export function useMissions(apiBaseUrl: string, getToken: () => Promise<string>, enabled: boolean, fetchImpl?: typeof fetch): UseMissions {
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  const api = useMemo(() => makeMissionsApi(apiBaseUrl, () => getTokenRef.current(), fetchImpl), [apiBaseUrl, fetchImpl]);

  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState<Run | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [changes, setChanges] = useState<RunChanges | null>(null);
  const [error, setError] = useState<string | null>(null);
  const watchRef = useRef<AbortController | null>(null);

  // Load the diff for review once the selected run reaches the gate or a terminal state
  // (before that the worker has not committed anything, so there is nothing to show).
  useEffect(() => {
    const s = selected;
    if (!s || !(s.status === "awaiting_gate" || isTerminal(s.status))) {
      setChanges(null);
      return;
    }
    let alive = true;
    api
      .changes(s.run_id)
      .then((c) => alive && setChanges(c))
      .catch(() => alive && setChanges(null));
    return () => {
      alive = false;
    };
  }, [selected?.run_id, selected?.status, api]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(async () => {
    try {
      setRuns(await api.list());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not load runs");
    }
  }, [api]);

  useEffect(() => {
    if (enabled) void refresh();
  }, [enabled, refresh]);

  // Abort any in-flight watcher on unmount.
  useEffect(() => () => watchRef.current?.abort(), []);

  const select = useCallback(
    async (id: string) => {
      watchRef.current?.abort();
      const controller = new AbortController();
      watchRef.current = controller;
      setEvents([]);
      try {
        const run = await api.get(id);
        if (controller.signal.aborted) return;
        setSelected(run);
        if (isTerminal(run.status)) return;

        // Live telemetry (best effort) alongside status polling until terminal.
        const stream = (async () => {
          try {
            for await (const evt of api.events(id, { signal: controller.signal })) {
              if (controller.signal.aborted) return;
              setEvents((prev) => [...prev, evt]);
            }
          } catch {
            /* telemetry is best-effort; polling still tracks status */
          }
        })();
        const poll = (async () => {
          while (!controller.signal.aborted) {
            await sleep(3000);
            if (controller.signal.aborted) return;
            try {
              const latest = await api.get(id);
              setSelected(latest);
              if (isTerminal(latest.status)) {
                void refresh();
                return;
              }
            } catch {
              /* transient; keep polling */
            }
          }
        })();
        await Promise.race([stream, poll]);
      } catch (e) {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "could not open run");
      }
    },
    [api, refresh],
  );

  const launch = useCallback(
    async (input: LaunchInput) => {
      try {
        const run = await api.launch(input);
        setError(null);
        await refresh();
        void select(run.run_id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "launch failed");
      }
    },
    [api, refresh, select],
  );

  const decide = useCallback(
    async (id: string, decision: "approve" | "reject" | "scrub" | "cancel") => {
      try {
        await api.decide(id, decision);
        const latest = await api.get(id);
        setSelected(latest);
        void refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "gate action failed");
      }
    },
    [api, refresh],
  );

  return { runs, selected, events, changes, error, refresh, launch, select, decide };
}
