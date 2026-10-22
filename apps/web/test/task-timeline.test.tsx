import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatComposer } from "../src/components/ChatComposer";
import { WorkingSummary } from "../src/components/WorkingSummary";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(window, "webkitSpeechRecognition");
  Reflect.deleteProperty(window, "isSecureContext");
});

describe("smart task timeline", () => {
  it("renders a controlled shared draft and publishes edits", () => {
    const onDraftChange = vi.fn();
    const { rerender } = render(
      <ChatComposer
        canSend
        draft="draft from Desktop"
        isBusy={false}
        isGenerating={false}
        isWaitingForResponse={false}
        onDraftChange={onDraftChange}
        onInterrupt={() => undefined}
        onSend={() => undefined}
      />
    );

    const composer = screen.getByPlaceholderText("Message Codex…") as HTMLTextAreaElement;
    expect(composer.value).toBe("draft from Desktop");
    fireEvent.change(composer, { target: { value: "edited on mobile" } });
    expect(onDraftChange).toHaveBeenCalledWith("edited on mobile");

    rerender(
      <ChatComposer
        canSend
        draft="newer Desktop draft"
        isBusy={false}
        isGenerating={false}
        isWaitingForResponse={false}
        onDraftChange={onDraftChange}
        onInterrupt={() => undefined}
        onSend={() => undefined}
      />
    );
    expect(composer.value).toBe("newer Desktop draft");
  });

  it("clears a controlled draft only after send acknowledgement", async () => {
    const onDraftChange = vi.fn();
    const onSend = vi.fn().mockResolvedValue(true);
    render(
      <ChatComposer
        canSend
        draft="queue this"
        isBusy={false}
        isGenerating
        isWaitingForResponse={false}
        onDraftChange={onDraftChange}
        onInterrupt={() => undefined}
        onSend={onSend}
      />
    );

    fireEvent.click(screen.getByLabelText("Queue follow-up"));
    await waitFor(() => expect(onDraftChange).toHaveBeenCalledWith(""));
  });

  it("shows an updating working duration", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_125_000);
    render(
      <WorkingSummary
        status="inProgress"
        startedAtMs={1_000_000}
      />
    );

    expect(screen.getByText("Working for 2m 5s")).toBeTruthy();
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByText("Working for 2m 6s")).toBeTruthy();
  });

  it("freezes completed work at its recorded end time", () => {
    render(
      <WorkingSummary
        status="completed"
        startedAtMs={1_000_000}
        endedAtMs={1_240_000}
        now={2_000_000}
      />
    );

    expect(screen.getByText("Worked for 4m 0s")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Worked for 4m 0s" })).toBeNull();
  });

  it("queues a follow-up without using the stop action", () => {
    const onSend = vi.fn();
    const onInterrupt = vi.fn();
    render(
      <ChatComposer
        canSend
        isBusy={false}
        isGenerating
        isWaitingForResponse={false}
        onInterrupt={onInterrupt}
        onSend={onSend}
      />
    );

    fireEvent.change(screen.getByPlaceholderText("Ask for follow-up changes"), {
      target: { value: "Commit and push" }
    });
    fireEvent.click(screen.getByLabelText("Queue follow-up"));

    expect(onSend).toHaveBeenCalledWith("Commit and push", "queue", []);
    expect(onInterrupt).not.toHaveBeenCalled();
  });

  it("can steer a running task and preserves non-mobile slash commands verbatim", () => {
    const onSend = vi.fn();
    render(
      <ChatComposer
        canSend
        isBusy={false}
        isGenerating
        isWaitingForResponse={false}
        onInterrupt={() => undefined}
        onSend={onSend}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "steer" }));
    fireEvent.change(screen.getByPlaceholderText("Ask for follow-up changes"), {
      target: { value: "/review" }
    });
    fireEvent.click(screen.getByLabelText("Steer follow-up"));

    expect(onSend).toHaveBeenCalledWith("/review", "steer", []);
  });

  it("shows and keyboard-navigates the mobile command menu", () => {
    const onCommand = vi.fn();
    const onSend = vi.fn();
    render(
      <ChatComposer
        canSend
        isBusy={false}
        isGenerating={false}
        isWaitingForResponse={false}
        onCommand={onCommand}
        onInterrupt={() => undefined}
        onSend={onSend}
      />
    );

    const composer = screen.getByPlaceholderText("Message Codex…");
    fireEvent.change(composer, { target: { value: "/" } });
    expect(screen.getByRole("option", { name: /status/i })).toBeTruthy();
    expect(screen.getByRole("option", { name: /compact/i })).toBeTruthy();
    expect(screen.getByRole("option", { name: /side/i })).toBeTruthy();

    fireEvent.keyDown(composer, { key: "ArrowDown" });
    fireEvent.keyDown(composer, { key: "Enter" });

    expect(onCommand).toHaveBeenCalledWith("compact");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("handles /status as a command instead of model text", () => {
    const onCommand = vi.fn();
    const onSend = vi.fn();
    render(
      <ChatComposer
        canSend
        isBusy={false}
        isGenerating={false}
        isWaitingForResponse={false}
        onCommand={onCommand}
        onInterrupt={() => undefined}
        onSend={onSend}
      />
    );

    const composer = screen.getByPlaceholderText("Message Codex…");
    fireEvent.change(composer, {
      target: { value: "/status" }
    });
    composer.focus();
    expect(document.activeElement).toBe(composer);
    fireEvent.click(screen.getByLabelText("Send message"));

    expect(onCommand).toHaveBeenCalledWith("status");
    expect(onSend).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(composer);
  });

  it("disables Side when the current task has not started", () => {
    render(
      <ChatComposer
        canSend
        canStartSide={false}
        isBusy={false}
        isGenerating={false}
        isWaitingForResponse={false}
        onCommand={() => undefined}
        onInterrupt={() => undefined}
        onSend={() => undefined}
      />
    );

    fireEvent.change(screen.getByPlaceholderText("Message Codex…"), {
      target: { value: "/" }
    });
    expect(screen.getByRole("option", { name: /side/i }).getAttribute("aria-disabled")).toBe(
      "true"
    );
  });

  it("uses Escape to stop while waiting for a response", () => {
    const onInterrupt = vi.fn();
    render(
      <ChatComposer
        canSend
        isBusy={false}
        isGenerating={false}
        isWaitingForResponse
        onInterrupt={onInterrupt}
        onSend={() => undefined}
      />
    );

    expect(screen.getByLabelText("Pause thread")).toBeTruthy();
    fireEvent.keyDown(screen.getByPlaceholderText("Ask for follow-up changes"), {
      key: "Escape",
      repeat: false
    });
    expect(onInterrupt).toHaveBeenCalledOnce();
  });

  it("uses Escape to stop even when the composer textarea is not focused", () => {
    const onInterrupt = vi.fn();
    render(
      <ChatComposer
        canSend
        isBusy={false}
        isGenerating
        isWaitingForResponse={false}
        onInterrupt={onInterrupt}
        onSend={() => undefined}
      />
    );
    fireEvent.keyDown(document, { key: "Escape", repeat: false });
    expect(onInterrupt).toHaveBeenCalledOnce();
  });

  it("sends the current prompt with Enter", () => {
    const onSend = vi.fn();
    render(
      <ChatComposer
        canSend
        isBusy={false}
        isGenerating={false}
        isWaitingForResponse={false}
        onInterrupt={() => undefined}
        onSend={onSend}
      />
    );
    const composer = screen.getByPlaceholderText("Message Codex…");
    fireEvent.change(composer, { target: { value: "Start the task" } });
    fireEvent.keyDown(composer, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("Start the task", "queue", []);
  });

  it("keeps Shift+Enter available for a newline", () => {
    const onSend = vi.fn();
    render(
      <ChatComposer
        canSend
        isBusy={false}
        isGenerating={false}
        isWaitingForResponse={false}
        onInterrupt={() => undefined}
        onSend={onSend}
      />
    );
    const composer = screen.getByPlaceholderText("Message Codex…");
    fireEvent.change(composer, { target: { value: "First line" } });
    expect(fireEvent.keyDown(composer, { key: "Enter", shiftKey: true })).toBe(true);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("uses the opposite follow-up behavior for Ctrl+Shift+Enter", () => {
    const onSend = vi.fn();
    render(
      <ChatComposer
        canSend
        isBusy={false}
        isGenerating
        isWaitingForResponse={false}
        onInterrupt={() => undefined}
        onSend={onSend}
      />
    );
    const composer = screen.getByPlaceholderText("Ask for follow-up changes");
    fireEvent.change(composer, { target: { value: "urgent change" } });
    fireEvent.keyDown(composer, { key: "Enter", ctrlKey: true, shiftKey: true });
    expect(onSend).toHaveBeenCalledWith("urgent change", "steer", []);
  });

  it("keeps stop as a distinct action while work is active", () => {
    const onInterrupt = vi.fn();
    render(
      <ChatComposer
        canSend
        isBusy={false}
        isGenerating
        isWaitingForResponse={false}
        onInterrupt={onInterrupt}
        onSend={() => undefined}
      />
    );

    fireEvent.click(screen.getByLabelText("Pause thread"));
    expect(onInterrupt).toHaveBeenCalledOnce();
  });

  it("shows Pause for rollout-active work without a live turn", () => {
    const onInterrupt = vi.fn();
    render(
      <ChatComposer
        canSend
        isBusy={false}
        isGenerating={false}
        isWaitingForResponse={false}
        isThreadActive
        onInterrupt={onInterrupt}
        onSend={() => undefined}
      />
    );

    fireEvent.click(screen.getByLabelText("Pause thread"));
    expect(onInterrupt).toHaveBeenCalledOnce();
  });

  it("finalizes mobile dictation every ten seconds", () => {
    vi.useFakeTimers();
    const stop = vi.fn();
    const recognition = {
      continuous: false,
      interimResults: false,
      lang: "",
      onresult: null,
      onerror: null,
      onend: null,
      start: vi.fn(),
      stop,
      abort: vi.fn()
    };
    Object.defineProperty(window, "webkitSpeechRecognition", {
      configurable: true,
      value: vi.fn(() => recognition)
    });
    render(
      <ChatComposer
        canSend
        isBusy={false}
        isGenerating={false}
        isWaitingForResponse={false}
        onInterrupt={() => undefined}
        onSend={() => undefined}
      />
    );

    fireEvent.click(screen.getByLabelText("Start dictation"));
    expect(recognition.start).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(9_999);
    expect(stop).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(stop).toHaveBeenCalledOnce();
  });

  it("explains that voice requires the Tailscale HTTPS address", () => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
    render(
      <ChatComposer
        canSend
        isBusy={false}
        isGenerating={false}
        isWaitingForResponse={false}
        onInterrupt={() => undefined}
        onSend={() => undefined}
      />
    );
    fireEvent.click(screen.getByLabelText("Start dictation"));
    expect(screen.getByLabelText("Start dictation").getAttribute("title")).toContain(
      "Tailscale Serve HTTPS"
    );
  });

  it("does not restart an old recognizer after cancel and immediate restart", () => {
    const recognizers: Array<{
      continuous: boolean;
      interimResults: boolean;
      lang: string;
      onresult: null;
      onerror: null;
      onend: (() => void) | null;
      start: ReturnType<typeof vi.fn>;
      stop: ReturnType<typeof vi.fn>;
      abort: ReturnType<typeof vi.fn>;
    }> = [];
    Object.defineProperty(window, "webkitSpeechRecognition", {
      configurable: true,
      value: vi.fn(() => {
        const recognition = {
          continuous: false,
          interimResults: false,
          lang: "",
          onresult: null,
          onerror: null,
          onend: null,
          start: vi.fn(),
          stop: vi.fn(),
          abort: vi.fn()
        };
        recognizers.push(recognition);
        return recognition;
      })
    });
    render(
      <ChatComposer
        canSend
        isBusy={false}
        isGenerating={false}
        isWaitingForResponse={false}
        onInterrupt={() => undefined}
        onSend={() => undefined}
      />
    );
    fireEvent.click(screen.getByLabelText("Start dictation"));
    const oldOnEnd = recognizers[0]?.onend;
    fireEvent.keyDown(document, { key: "Escape", repeat: false });
    fireEvent.click(screen.getByLabelText("Start dictation"));
    oldOnEnd?.();
    expect(recognizers).toHaveLength(2);
    expect(recognizers[0]?.start).toHaveBeenCalledOnce();
    expect(recognizers[1]?.start).toHaveBeenCalledOnce();
  });
});
