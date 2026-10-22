import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDictation } from "../src/hooks/useDictation";
import { ChatComposer } from "../src/components/ChatComposer";

class Recognition {
  static latest: Recognition | null = null;
  continuous = false;
  interimResults = false;
  lang = "";
  onresult: ((event: { resultIndex: number; results: Array<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null = null;
  onerror: ((event: { error?: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
  constructor() { Recognition.latest = this; }
  result(...segments: string[]): void {
    this.onresult?.({ resultIndex: 0, results: segments.map(transcript => ({ isFinal: true, 0: { transcript } })) });
  }
}

beforeEach(() => {
  Recognition.latest = null;
  vi.stubGlobal("SpeechRecognition", Recognition);
  vi.stubGlobal("isSecureContext", true);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("dictation session", () => {
  it("uses the latest transcript handler throughout an active recording", async () => {
    const first = vi.fn();
    const latest = vi.fn();
    const hook = renderHook(({ handler }) => useDictation(handler), { initialProps: { handler: first } });
    await act(() => hook.result.current.start());
    hook.rerender({ handler: latest });
    act(() => Recognition.latest?.result("New text"));
    expect(latest).toHaveBeenCalledWith("New text");
    expect(first).not.toHaveBeenCalled();
    hook.unmount();
    expect(Recognition.latest?.abort).toHaveBeenCalledOnce();
  });

  it("preserves multiple final segments and text typed during recording", () => {
    render(<ChatComposer canSend isBusy={false} isGenerating={false} isWaitingForResponse={false}
      onInterrupt={() => undefined} onSend={() => true} />);
    const composer = screen.getByPlaceholderText<HTMLTextAreaElement>("Message Codex…");
    fireEvent.change(composer, { target: { value: "Start" } });
    fireEvent.click(screen.getByLabelText("Start dictation"));
    act(() => Recognition.latest?.result("one", "two"));
    expect(composer.value).toBe("Start one two");
    fireEvent.change(composer, { target: { value: `${composer.value} typed` } });
    act(() => Recognition.latest?.result("three"));
    expect(composer.value).toBe("Start one two typed three");
  });
});
