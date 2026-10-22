import type { Server, ServerResponse } from "node:http";

/** Drain streams, then bound the wait for stalled HTTP peers during a restart. */
export async function closeHttpServer(
  server: Server,
  eventStreams: Iterable<ServerResponse>,
  graceMs = 1_000
): Promise<void> {
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  for (const stream of eventStreams) stream.end();
  const deadline = setTimeout(() => server.closeAllConnections(), graceMs);
  deadline.unref();
  try {
    await closed;
  } finally {
    clearTimeout(deadline);
  }
}
