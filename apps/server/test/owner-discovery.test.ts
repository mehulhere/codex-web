import { describe, expect, it, vi } from "vitest";
import { OwnerDiscoveryCoordinator } from "../src/owner-discovery.js";

describe("OwnerDiscoveryCoordinator", () => {
    it("shares one discovery request for concurrent callers", async () => {
        let resolveDiscovery: ((ownerClientId: string) => void) | undefined;
        const discoverThreadOwner = vi.fn(
            () =>
                new Promise<string>((resolve) => {
                    resolveDiscovery = resolve;
                })
        );
        const coordinator = new OwnerDiscoveryCoordinator(discoverThreadOwner);

        const first = coordinator.discover("thread-1");
        const second = coordinator.discover("thread-1");
        expect(discoverThreadOwner).toHaveBeenCalledTimes(1);

        resolveDiscovery?.("desktop-client");
        await expect(Promise.all([first, second])).resolves.toEqual([
            "desktop-client",
            "desktop-client"
        ]);
        expect(coordinator.get("thread-1")).toBe("desktop-client");
    });

    it("does not reuse a stale owner after invalidation", async () => {
        const discoverThreadOwner = vi
            .fn<(threadId: string) => Promise<string>>()
            .mockResolvedValueOnce("desktop-client-1")
            .mockResolvedValueOnce("desktop-client-2");
        const coordinator = new OwnerDiscoveryCoordinator(discoverThreadOwner);

        await expect(coordinator.discover("thread-1")).resolves.toBe("desktop-client-1");
        coordinator.invalidate("thread-1", "desktop-client-1");
        await expect(coordinator.discover("thread-1")).resolves.toBe("desktop-client-2");
        expect(discoverThreadOwner).toHaveBeenCalledTimes(2);
    });

    it("does not invalidate a newer owner when an older target fails", async () => {
        const coordinator = new OwnerDiscoveryCoordinator(vi.fn());
        coordinator.remember("thread-1", "new-owner");

        coordinator.invalidate("thread-1", "old-owner");

        expect(coordinator.get("thread-1")).toBe("new-owner");
    });

    it("clears all live owners when the IPC connection is lost", async () => {
        const coordinator = new OwnerDiscoveryCoordinator(vi.fn());
        coordinator.remember("thread-1", "desktop-client");
        coordinator.clear();

        expect(coordinator.get("thread-1")).toBeNull();
    });
});
