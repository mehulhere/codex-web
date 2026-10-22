import { afterEach, describe, expect, it, vi } from "vitest";
import { CoalescedTask } from "../src/coalesced-task.js";

describe("CoalescedTask", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("runs during a continuous event burst instead of waiting for quiet", async () => {
        vi.useFakeTimers();
        const task = vi.fn().mockResolvedValue(undefined);
        const coalesced = new CoalescedTask(task, 50);

        coalesced.schedule();
        await vi.advanceTimersByTimeAsync(25);
        coalesced.schedule();
        await vi.advanceTimersByTimeAsync(25);

        expect(task).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(100);
        expect(task).toHaveBeenCalledTimes(1);
    });

    it("coalesces events received while a refresh is already running", async () => {
        vi.useFakeTimers();
        let finishFirst = (): void => {
            throw new Error("First refresh did not start");
        };
        const task = vi.fn().mockImplementation(() => new Promise<void>((resolve) => {
            finishFirst = resolve;
        }));
        const coalesced = new CoalescedTask(task, 50);

        coalesced.schedule();
        await vi.advanceTimersByTimeAsync(50);
        coalesced.schedule();
        coalesced.schedule();
        finishFirst();
        await vi.advanceTimersByTimeAsync(50);

        expect(task).toHaveBeenCalledTimes(2);
    });

    it("cancels a scheduled refresh", async () => {
        vi.useFakeTimers();
        const task = vi.fn().mockResolvedValue(undefined);
        const coalesced = new CoalescedTask(task, 50);

        coalesced.schedule();
        coalesced.cancel();
        await vi.advanceTimersByTimeAsync(50);

        expect(task).not.toHaveBeenCalled();
    });
});
