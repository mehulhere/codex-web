import { describe, expect, it, vi } from "vitest";
import { clearPersistedComposerDrafts } from "../src/local-composer-drafts.js";

function createStorage(initial: Record<string, string> = {}): Storage {
    const values = new Map(Object.entries(initial));
    return {
        get length() {
            return values.size;
        },
        clear: vi.fn(() => values.clear()),
        getItem: vi.fn((key: string) => values.get(key) ?? null),
        key: vi.fn((index: number) => [...values.keys()][index] ?? null),
        removeItem: vi.fn((key: string) => values.delete(key)),
        setItem: vi.fn((key: string, value: string) => values.set(key, value))
    };
}

describe("local composer drafts", () => {
    it("removes legacy persisted composer drafts without touching other preferences", () => {
        const storage = createStorage({
            "farfield:composer-draft:thread-a": "Draft A",
            "farfield:composer-draft:thread-b": "Draft B",
            theme: "dark"
        });

        clearPersistedComposerDrafts(storage);

        expect(storage.getItem("farfield:composer-draft:thread-a")).toBeNull();
        expect(storage.getItem("farfield:composer-draft:thread-b")).toBeNull();
        expect(storage.getItem("theme")).toBe("dark");
    });
});
