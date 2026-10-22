import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SideTaskDrawer } from "../src/components/SideTaskDrawer.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function renderSideTask(): void {
  render(<SideTaskDrawer threadId="side-1" title="Side conversation"
    onClose={() => undefined} onError={() => undefined} />);
}

function sideTaskFetch() {
  const previousTurn = { id: "old-turn", status: "completed", items: [
    { id: "old-message", type: "agentMessage", text: "Previous answer" }
  ] };
  const liveTurn = { id: "live-turn", status: "completed", items: [
    { id: "live-message", type: "agentMessage", text: "Recent answer" }
  ] };
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/uploads" && init?.method === "POST") {
      return Response.json({ ok: true, image: {
        id: "00000000-0000-4000-8000-000000000003", filename: "test.png",
        mediaType: "image/png", size: 4, url: "/api/uploads/00000000-0000-4000-8000-000000000003"
      } });
    }
    if (url.includes("/messages")) return Response.json({ ok: true, threadId: "side-1", ownerClientId: null });
    if (url.includes("/live-state")) return Response.json({ ok: true, threadId: "side-1", ownerClientId: null,
      conversationState: { id: "side-1", turns: [liveTurn], requests: [], cwd: "/workspace/side" } });
    return Response.json({ ok: true, thread: { id: "side-1", turns: [previousTurn, liveTurn], requests: [], cwd: "/workspace/side" } });
  });
}

describe("SideTaskDrawer", () => {
  it("merges recent live turns with older durable messages", async () => {
    vi.stubGlobal("fetch", sideTaskFetch());
    renderSideTask();
    expect(await screen.findByText("Previous answer")).toBeTruthy();
    expect(screen.getByText("Recent answer")).toBeTruthy();
  });

  it("forwards attached images and the side workspace on send", async () => {
    const fetchMock = sideTaskFetch();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", { createObjectURL: () => "blob:preview", revokeObjectURL: vi.fn() });
    renderSideTask();
    await screen.findByText("Recent answer");
    fireEvent.change(screen.getByLabelText("Choose images or files"), { target: {
      files: [new File(["png"], "test.png", { type: "image/png" })]
    } });
    const send = screen.getByLabelText<HTMLButtonElement>("Send message");
    await waitFor(() => expect(send.disabled).toBe(false));
    fireEvent.click(send);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/threads/side-1/messages", expect.objectContaining({
      body: JSON.stringify({ text: "", images: ["00000000-0000-4000-8000-000000000003"], cwd: "/workspace/side", isSteering: false })
    })));
  });

  it("waits for a slow poll before starting the next one", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetchMock);
    renderSideTask();
    await act(() => vi.advanceTimersByTimeAsync(6_000));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps an empty side task independent and sends only to its thread", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/messages") && init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({ ok: true, threadId: "side-1", ownerClientId: null })
        } as Response;
      }
      if (url.includes("/live-state")) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            threadId: "side-1",
            ownerClientId: null,
            conversationState: { id: "side-1", turns: [], requests: [] }
          })
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          ok: true,
          thread: { id: "side-1", turns: [], requests: [] }
        })
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <SideTaskDrawer
        threadId="side-1"
        title="Side conversation"
        onClose={() => undefined}
        onError={() => undefined}
      />
    );

    expect(await screen.findByText("Ask a quick question without disrupting the main task.")).toBeTruthy();
    const composer = screen.getByPlaceholderText("Message Codex…");
    fireEvent.change(composer, { target: { value: "Quick question" } });
    fireEvent.click(screen.getByLabelText("Send message"));

    await waitFor(() => {
      const sendCall = fetchMock.mock.calls.find((call) =>
        String(call[0]).includes("/api/threads/side-1/messages")
      );
      expect(sendCall?.[1]).toMatchObject({ method: "POST" });
    });

    fireEvent.change(composer, { target: { value: "/" } });
    expect(screen.getByRole("option", { name: /side/i }).getAttribute("aria-disabled")).toBe(
      "true"
    );
  });

  it("keeps the draft when side-task delivery fails", async () => {
    const onError = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/messages") && init?.method === "POST") {
        return {
          ok: false,
          status: 503,
          json: async () => ({ ok: false, error: "Desktop IPC is not connected" })
        } as Response;
      }
      if (url.includes("/live-state")) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            threadId: "side-1",
            ownerClientId: null,
            conversationState: { id: "side-1", turns: [], requests: [] }
          })
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          ok: true,
          thread: { id: "side-1", turns: [], requests: [] }
        })
      } as Response;
    }));

    render(
      <SideTaskDrawer
        threadId="side-1"
        title="Side conversation"
        onClose={() => undefined}
        onError={onError}
      />
    );

    const composer = await screen.findByPlaceholderText("Message Codex…");
    fireEvent.change(composer, { target: { value: "Quick question" } });
    fireEvent.click(screen.getByLabelText("Send message"));

    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith("ApiRequestError: Desktop IPC is not connected")
    );
    expect((composer as HTMLTextAreaElement).value).toBe("Quick question");
  });
});
