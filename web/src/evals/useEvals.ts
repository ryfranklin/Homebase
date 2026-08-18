import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { makeEvalsApi, SAMPLE_PAYLOAD, SAMPLE_SUMMARY } from "./api";
import type { RunPayload, RunSummary } from "./types";

export interface UseEvals {
  runs: RunSummary[];
  selected: RunPayload | null;
  selectedId: string | null;
  error: string | null;
  // True when the shown data is the bundled sample (backend unreachable or empty),
  // so the view can say so honestly.
  sample: boolean;
  refresh: () => Promise<void>;
  select: (id: string) => Promise<void>;
}

// Drives the Evals tab: the run list and a selected run's full payload. Only
// fetches while the tab is open. Falls back to the bundled sample run when the BFF
// is unreachable or has no runs yet, so the tab is always demoable.
export function useEvals(apiBaseUrl: string, getToken: () => Promise<string>, enabled: boolean, fetchImpl?: typeof fetch): UseEvals {
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  const api = useMemo(() => makeEvalsApi(apiBaseUrl, () => getTokenRef.current(), fetchImpl), [apiBaseUrl, fetchImpl]);

  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selected, setSelected] = useState<RunPayload | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sample, setSample] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const list = await api.list();
      if (list.length) {
        setRuns(list);
        setSample(false);
      } else {
        setRuns([SAMPLE_SUMMARY]);
        setSample(true);
      }
      setError(null);
    } catch (e) {
      // No backend yet (stack not deployed / dev): show the sample so the tab works.
      setRuns([SAMPLE_SUMMARY]);
      setSample(true);
      setError(e instanceof Error ? e.message : "could not load runs");
    }
  }, [api]);

  const select = useCallback(
    async (id: string) => {
      setSelectedId(id);
      if (id === SAMPLE_SUMMARY.runId) {
        setSelected(SAMPLE_PAYLOAD);
        setSample(true);
        return;
      }
      try {
        setSelected(await api.get(id));
        setSample(false);
      } catch (e) {
        setSelected(SAMPLE_PAYLOAD);
        setSample(true);
        setError(e instanceof Error ? e.message : "could not load run");
      }
    },
    [api],
  );

  useEffect(() => {
    if (enabled) void refresh();
  }, [enabled, refresh]);

  // Auto-select the newest run once the list arrives and nothing is selected.
  useEffect(() => {
    if (enabled && runs.length && !selectedId) void select(runs[0].runId);
  }, [enabled, runs, selectedId, select]);

  return { runs, selected, selectedId, error, sample, refresh, select };
}
