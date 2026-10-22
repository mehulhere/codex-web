import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatComposer } from "../src/components/ChatComposer";
import { deleteComposerImage, uploadComposerImage } from "../src/lib/api";

vi.mock("../src/lib/api", () => ({
  uploadComposerImage: vi.fn(),
  deleteComposerImage: vi.fn()
}));

const image = {
  id: "00000000-0000-4000-8000-000000000003",
  filename: "clipboard.png",
  mediaType: "image/png" as const,
  size: 4,
  url: "/api/uploads/00000000-0000-4000-8000-000000000003"
};

beforeEach(() => {
  vi.mocked(uploadComposerImage).mockResolvedValue(image);
  vi.mocked(deleteComposerImage).mockResolvedValue(undefined);
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:preview"),
    revokeObjectURL: vi.fn()
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function pasteImage(target: HTMLElement, file: File, text = ""): void {
  fireEvent.paste(target, {
    clipboardData: {
      items: [{ kind: "file", getAsFile: () => file }],
      getData: (type: string) => type === "text/plain" ? text : ""
    }
  });
}

describe("composer image paste", () => {
  it("opens a file picker from the plus control and uploads selected images", async () => {
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

    const picker = screen.getByLabelText("Choose images or files");
    fireEvent.change(picker, {
      target: {
        files: [new File(["png"], "selected.png", { type: "image/png" })]
      }
    });

    expect(screen.getByRole("button", { name: "Attach images or files" })).toBeTruthy();
    expect(await screen.findByRole("img", { name: "selected.png" })).toBeTruthy();
    expect(uploadComposerImage).toHaveBeenCalledTimes(1);
  });

  it("attaches a selected text file to the outgoing message", async () => {
    const onSend = vi.fn().mockResolvedValue(true);
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

    fireEvent.change(screen.getByLabelText("Choose images or files"), {
      target: {
        files: [new File(["hello from file"], "notes.txt", { type: "text/plain" })]
      }
    });

    expect(await screen.findByText("notes.txt")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Send message"));

    await waitFor(() => expect(onSend).toHaveBeenCalledWith(
      "[Attached file: notes.txt]\nhello from file",
      "queue",
      []
    ));
  });

  it("uploads a pasted image and sends its opaque id with normal text", async () => {
    const onSend = vi.fn().mockResolvedValue(true);
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
    fireEvent.change(composer, { target: { value: "inspect this" } });
    pasteImage(composer, new File(["png"], "clipboard.png", { type: "image/png" }));

    await screen.findByRole("img", { name: "clipboard.png" });
    fireEvent.click(screen.getByLabelText("Send message"));

    await waitFor(() => expect(onSend).toHaveBeenCalledWith(
      "inspect this",
      "queue",
      [image.id]
    ));
  });

  it("supports image-only queued sends and keeps the image when delivery fails", async () => {
    const onSend = vi.fn().mockResolvedValue(false);
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
    pasteImage(composer, new File(["png"], "clipboard.png", { type: "image/png" }));
    await screen.findByRole("img", { name: "clipboard.png" });
    fireEvent.click(screen.getByLabelText("Queue follow-up"));

    await waitFor(() => expect(onSend).toHaveBeenCalledWith("", "queue", [image.id]));
    expect(screen.getByRole("img", { name: "clipboard.png" })).toBeTruthy();
  });

  it("deletes a ready upload when its preview is removed", async () => {
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

    const composer = screen.getByPlaceholderText("Message Codex…");
    pasteImage(composer, new File(["png"], "clipboard.png", { type: "image/png" }));
    await screen.findByRole("img", { name: "clipboard.png" });
    await waitFor(() => expect(
      (screen.getByLabelText("Send message") as HTMLButtonElement).disabled
    ).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Remove clipboard.png" }));

    await waitFor(() => expect(deleteComposerImage).toHaveBeenCalledWith(image.id));
    expect(screen.queryByRole("img", { name: "clipboard.png" })).toBeNull();
  });
});
