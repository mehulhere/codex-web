import { describe, expect, it } from "vitest";
import { parseGenericSseEvent, parseThreadLiveStateChangedEvent } from "../src/sse-events.js";

describe("parseThreadLiveStateChangedEvent", () => {
    it("accepts diagnostic invalidation without raw protocol payloads", () => {
        expect(parseGenericSseEvent('{"type":"history","entry":null}')).toEqual({
            type: "history", entry: null
        });
        expect(parseGenericSseEvent('{"type":"history","entry":{"payload":"raw"}}')).toBeNull();
    });
    it("accepts only the minimal named live-state notification", () => {
        expect(parseThreadLiveStateChangedEvent(
            "{\"type\":\"thread-live-state-changed\",\"threadId\":\"thread-1\"}"
        )).toEqual({
            type: "thread-live-state-changed",
            threadId: "thread-1"
        });

        expect(() => parseThreadLiveStateChangedEvent(
            "{\"type\":\"thread-live-state-changed\",\"threadId\":\"thread-1\",\"payload\":{}}"
        )).toThrow();
    });
});
