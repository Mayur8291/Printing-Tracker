// Runs the real hook with React DOM's development StrictMode effect replay.
// No upstream writes or requests: fetchPage/fetchAll are controlled promises.
import React, { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { useScottList } from "../src/scott/list/useScottList";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const config = {
  key: "brands-test",
  defaultSort: { key: "rank", direction: "asc" },
  columns: [{ key: "rank", type: "number" }]
};
const records = [{ id: "b", rank: 2 }, { id: "a", rank: 1 }];

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function fixture(run) {
  const container = document.createElement("div");
  document.querySelector("#fixtures").append(container);
  const root = createRoot(container);
  const drains = [];
  let latest;
  let currentConfig = config;
  const fetchAll = () => {
    const request = deferred();
    drains.push(request);
    return request.promise;
  };
  const fetchPage = async () => ({ data: [], totalCount: 0, totalPages: 1 });
  function Probe() {
    latest = useScottList({ config: currentConfig, fetchAll, fetchPage });
    return <output>{JSON.stringify({ loading: latest.loading, error: latest.error, rows: latest.rows })}</output>;
  }
  const render = () => root.render(<StrictMode><Probe /></StrictMode>);
  try {
    await act(render);
    await run({
      drains,
      state: () => latest,
      changeConfig: async (next) => {
        currentConfig = next;
        await act(render);
      }
    });
  } finally {
    await act(() => root.unmount());
    container.remove();
  }
}

const tests = [
  ["StrictMode restarts a cancelled load and ignores its stale result", async () => {
    await fixture(async ({ drains, state }) => {
      check(drains.length === 2, "StrictMode must start a replacement load after cleanup");
      await act(() => drains[1].resolve(records));
      check(!state().loading, "Successful replacement must stop loading");
      check(state().rows.map(row => row.id).join() === "a,b", "Loaded rows must be sorted");
      await act(() => drains[0].resolve([{ id: "stale", rank: 0 }]));
      check(state().rows[0].id === "a", "Cancelled response must not overwrite current rows");
    });
  }],
  ["StrictMode shows a request error and Refresh can recover", async () => {
    await fixture(async ({ drains, state }) => {
      check(drains.length === 2, "Replacement request missing");
      await act(() => drains[1].reject(new Error("Scott credentials not configured")));
      check(!state().loading && state().error.includes("credentials"), "Error must be visible, without a spinner");
      await act(() => state().refresh());
      check(drains.length === 3, "Refresh must retry the failed load");
      await act(() => drains[2].resolve(records));
      check(!state().loading && !state().error && state().rows.length === 2, "Retry must recover");
      await act(() => drains[0].reject(new Error("stale error")));
      check(!state().error, "Cancelled error must not replace successful results");
    });
  }],
  ["Leaving and re-entering full mode retries an unfinished load", async () => {
    await fixture(async ({ drains, state }) => {
      await act(() => state().clearSort());
      check(state().mode === "server", "Clearing sort must use server mode");
      await act(() => state().setSort(config.defaultSort));
      const request = drains.at(-1);
      check(drains.length >= 2, "Re-entering must start another request");
      await act(() => request.resolve(records));
      check(!state().loading && state().rows.length === 2, "Re-entered list must finish loading");
    });
  }],
  ["Successful empty and non-empty datasets stay cached when sorting changes", async () => {
    for (const rows of [[], records]) {
      await fixture(async ({ drains, state }) => {
        await act(() => drains.at(-1).resolve(rows));
        check(!state().loading, "Completed load must stop loading");
        const count = drains.length;
        await act(() => state().clearSort());
        await act(() => state().setSort(config.defaultSort));
        check(drains.length === count, "Completed dataset should be reused, including zero rows");
        check(!state().loading && state().rows.length === rows.length, "Cached list must render");
      });
    }
  }],
  ["Changing entities discards old results and loads the new entity", async () => {
    await fixture(async ({ drains, state, changeConfig }) => {
      const old = [...drains];
      await changeConfig({ ...config, key: "other-brands-test" });
      await act(() => drains.at(-1).resolve([{ id: "new", rank: 3 }]));
      await act(() => old.forEach(request => request.resolve(records)));
      check(!state().loading && state().rows[0]?.id === "new", "Old entity must not overwrite the new one");
    });
  }]
];

let failed = 0;
for (const [name, run] of tests) {
  const result = document.createElement("li");
  try {
    await run();
    result.textContent = `PASS: ${name}`;
  } catch (error) {
    failed += 1;
    result.textContent = `FAIL: ${name}: ${error.message}`;
  }
  document.querySelector("#results").append(result);
}
document.querySelector("h1").textContent = `${tests.length - failed}/${tests.length} Scott list lifecycle tests passed`;
