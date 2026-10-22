import type { ServerResponse } from "node:http";

const MAX_QUEUED_SSE_BYTES = 256 * 1024;

export function registerSseClient(clients: Set<ServerResponse>, res: ServerResponse): void {
    clients.add(res);
    res.once("close", () => clients.delete(res));
}

export function encodeSseEvent(payload: object, eventName?: string): string {
    const eventLine = eventName ? `event: ${eventName}\n` : "";
    return `${eventLine}data: ${JSON.stringify(payload)}\n\n`;
}

/** A stalled mobile connection must not keep an unbounded output queue alive. */
export function writeSseEvent(res: ServerResponse, encoded: string): boolean {
    if (res.destroyed || res.writableEnded) return false;
    if (res.writableLength + Buffer.byteLength(encoded) > MAX_QUEUED_SSE_BYTES) {
        res.destroy();
        return false;
    }
    res.write(encoded);
    return true;
}
