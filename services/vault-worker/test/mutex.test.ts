import { describe, expect, it } from "vitest";

import { Mutex } from "../src/mutex.ts";

describe("Mutex", () => {
  it("serializes operations: no two run concurrently", async () => {
    const mutex = new Mutex();
    let active = 0;
    let maxActive = 0;
    const order: number[] = [];
    const task = (n: number) =>
      mutex.run(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 5));
        order.push(n);
        active -= 1;
      });
    await Promise.all([task(1), task(2), task(3)]);
    expect(maxActive).toBe(1); // never overlapped
    expect(order).toEqual([1, 2, 3]); // FIFO
  });

  it("keeps the chain going after a rejection", async () => {
    const mutex = new Mutex();
    const results: string[] = [];
    const bad = mutex.run(async () => {
      throw new Error("boom");
    });
    const good = mutex.run(async () => {
      results.push("ran");
    });
    await expect(bad).rejects.toThrow("boom");
    await good;
    expect(results).toEqual(["ran"]);
  });
});
