import { describe, expect, it } from "vitest";
import { compareThreadsByRecentActivity } from "../src/thread-order.js";

describe("compareThreadsByRecentActivity", () => {
    it("sorts newest activity first without mutating the source array", () => {
        const threads = [
            { id: "old", updatedAt: 10, createdAt: 10 },
            { id: "new", updatedAt: 30, createdAt: 30 },
            { id: "middle", updatedAt: 20, createdAt: 20 }
        ];

        const sorted = [...threads].sort(compareThreadsByRecentActivity);

        expect(sorted.map((thread) => thread.id)).toEqual(["new", "middle", "old"]);
        expect(threads.map((thread) => thread.id)).toEqual(["old", "new", "middle"]);
    });

    it("uses creation time and id to make equal activity deterministic", () => {
        const sorted = [
            { id: "z", updatedAt: null, createdAt: 10 },
            { id: "b", updatedAt: null, createdAt: null },
            { id: "a", updatedAt: null, createdAt: null },
            { id: "newer-created", updatedAt: null, createdAt: 20 }
        ].sort(compareThreadsByRecentActivity);

        expect(sorted.map((thread) => thread.id)).toEqual([
            "newer-created",
            "z",
            "a",
            "b"
        ]);
    });
});
