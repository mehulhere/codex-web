import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationItem } from "../src/components/ConversationItem.js";
import { ReasoningActivityGroup } from "../src/components/ReasoningActivityGroup.js";

afterEach(cleanup);

describe("ConversationItem display preferences", () => {
  it("collapses completed activity when a live process transitions to the final state", async () => {
    const command = {
      id: "command-1",
      type: "commandExecution" as const,
      command: "pnpm test",
      status: "completed" as const
    };
    const { rerender } = render(
      <ReasoningActivityGroup
        title="Ran commands"
        items={[command]}
        isActive={false}
        showDiffs={true}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Ran commands" }));
    fireEvent.click(screen.getByRole("button", { name: "pnpm test" }));
    await waitFor(() => expect(screen.getByText("No output")).toBeTruthy());

    rerender(
      <ReasoningActivityGroup
        title="Ran commands"
        items={[command]}
        isActive={true}
        showDiffs={true}
      />
    );
    rerender(
      <ReasoningActivityGroup
        title="Ran commands"
        items={[command]}
        isActive={false}
        showDiffs={true}
      />
    );

    await waitFor(() => expect(screen.queryByText("No output")).toBeNull());
  });

  it("hides reasoning when disabled", () => {
    render(
      <ConversationItem
        item={{ id: "reasoning-1", type: "reasoning", summary: ["Private thought"], text: "Details" }}
        isLast={true}
        turnIsInProgress={false}
        showReasoning={false}
        showDiffs={true}
        showCommands={true}
      />
    );

    expect(screen.queryByText("Private thought")).toBeNull();
  });

  it("shows a completed activity summary instead of the hidden thinking title", () => {
    render(
      <ConversationItem
        item={{
          id: "command-read",
          type: "commandExecution",
          command: "sed -n '1,80p' src/file.ts",
          status: "completed",
          commandActions: [{ type: "read", path: "src/file.ts" }]
        }}
        reasoningActivityItems={[
          {
            id: "command-read",
            type: "commandExecution",
            command: "sed -n '1,80p' src/file.ts",
            status: "completed",
            commandActions: [{ type: "read", path: "src/file.ts" }]
          },
          {
            id: "change-1",
            type: "fileChange",
            status: "completed",
            changes: [
              {
                path: "src/file.ts",
                kind: { type: "update" },
                diff: "-old\n+new"
              }
            ]
          },
          {
            id: "command-test",
            type: "commandExecution",
            command: "pnpm test",
            status: "completed"
          }
        ]}
        reasoningActivitySummary="Edited files, read files, ran commands"
        renderAsReasoningActivityGroup
        reasoningIsActive={false}
        isLast={false}
        turnIsInProgress={false}
        showReasoning={false}
        showDiffs={true}
        showCommands={true}
      />
    );

    expect(screen.getByText("Edited files, read files, ran commands")).toBeTruthy();
    expect(screen.queryByText("sed -n '1,80p' src/file.ts")).toBeNull();
    fireEvent.click(screen.getByText("Edited files, read files, ran commands"));
    expect(screen.getByText("sed -n '1,80p' src/file.ts")).toBeTruthy();
  });

  it("keeps the latest active thinking title visible when thinking is hidden", () => {
    render(
      <ConversationItem
        item={{ id: "reasoning-live", type: "reasoning", summary: ["Checking live state"] }}
        reasoningActivityItems={[
          {
            id: "command-live",
            type: "commandExecution",
            command: "systemctl --user status codex-mobile.service",
            status: "inProgress"
          }
        ]}
        reasoningActivitySummary="Ran commands"
        reasoningIsActive
        isLast={false}
        turnIsInProgress
        showReasoning={false}
        showDiffs={true}
        showCommands={true}
      />
    );

    expect(screen.getByText("Checking live state")).toBeTruthy();
    expect(screen.queryByText("Ran commands")).toBeNull();
  });

  it("hides file diffs when disabled", () => {
    render(
      <ConversationItem
        item={{
          id: "change-1",
          type: "fileChange",
          status: "completed",
          changes: [
            {
              path: "/workspace/file.ts",
              kind: { type: "update", move_path: null },
              diff: "+secret"
            }
          ]
        }}
        isLast={true}
        turnIsInProgress={false}
        showReasoning={true}
        showDiffs={false}
        showCommands={true}
      />
    );

    expect(screen.queryByText("file.ts")).toBeNull();
  });

  it("hides completed command rows when commands are disabled", () => {
    render(
      <ConversationItem
        item={{
          id: "command-hidden",
          type: "commandExecution",
          command: "pnpm test",
          status: "completed"
        }}
        isLast
        turnIsInProgress={false}
        showReasoning={true}
        showDiffs={true}
        showCommands={false}
      />
    );

    expect(screen.queryByText("Ran commands")).toBeNull();
    expect(screen.queryByText("pnpm test")).toBeNull();
  });

  it("keeps a running command visible when completed commands are hidden", () => {
    render(
      <ConversationItem
        item={{
          id: "command-running",
          type: "commandExecution",
          command: "pnpm test",
          status: "inProgress"
        }}
        isLast
        turnIsInProgress
        showReasoning={true}
        showDiffs={true}
        showCommands={false}
      />
    );

    expect(screen.getByText("pnpm test")).toBeTruthy();
  });

  it("removes completed commands from grouped activity without hiding other activity", () => {
    render(
      <ConversationItem
        item={{
          id: "command-group-owner",
          type: "commandExecution",
          command: "pnpm test",
          status: "completed"
        }}
        isLast
        turnIsInProgress={false}
        showReasoning={true}
        showDiffs={true}
        showCommands={false}
        renderAsReasoningActivityGroup
        reasoningActivitySummary="Edited files and ran commands"
        reasoningActivityItems={[
          {
            id: "file-visible",
            type: "fileChange",
            changes: [{ path: "file.ts", kind: { type: "update" }, diff: "+change" }],
            status: "completed"
          },
          {
            id: "command-hidden-in-group",
            type: "commandExecution",
            command: "pnpm test",
            status: "completed"
          }
        ]}
      />
    );

    expect(screen.getByText("Edited files")).toBeTruthy();
    expect(screen.queryByText("Ran commands")).toBeNull();
    expect(screen.queryByText("pnpm test")).toBeNull();
  });
});

describe("ConversationItem message actions", () => {
  it("does not show copy or branch actions on assistant commentary", () => {
    render(
      <ConversationItem
        item={{
          id: "assistant-commentary-1",
          type: "agentMessage",
          text: "Still working",
          phase: "commentary"
        }}
        threadId="thread-1"
        turnId="turn-1"
        isLast
        turnIsInProgress={false}
        showReasoning
        showDiffs
      />
    );

    expect(screen.queryByRole("button", { name: "Copy message" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Branch response" })).toBeNull();
  });

  it("copies and edits the latest completed user message inline", () => {
    const onCopyMessage = vi.fn().mockResolvedValue(undefined);
    const onEditUserMessage = vi.fn().mockResolvedValue(undefined);
    render(
      <ConversationItem
        item={{
          id: "user-1",
          type: "userMessage",
          content: [{ type: "text", text: "Original query" }]
        }}
        threadId="thread-1"
        turnId="turn-1"
        canEditUserMessage
        isLast
        turnIsInProgress={false}
        showReasoning
        showDiffs
        onCopyMessage={onCopyMessage}
        onEditUserMessage={onEditUserMessage}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy message" }));
    expect(onCopyMessage).toHaveBeenCalledWith("Original query");

    fireEvent.click(screen.getByRole("button", { name: "Edit message" }));
    const editor = screen.getByRole("textbox", { name: "Edit message text" });
    fireEvent.change(editor, { target: { value: "Revised query" } });
    fireEvent.click(screen.getByRole("button", { name: "Save edit" }));
    expect(onEditUserMessage).toHaveBeenCalledWith("turn-1", "Revised query");
  });

  it("copies and branches a completed assistant response", () => {
    const onCopyMessage = vi.fn().mockResolvedValue(undefined);
    const onForkAssistantTurn = vi.fn().mockResolvedValue(undefined);
    render(
      <ConversationItem
        item={{
          id: "assistant-1",
          type: "agentMessage",
          text: "Final response",
          phase: "final_answer"
        }}
        threadId="thread-1"
        turnId="turn-1"
        canForkAssistantTurn
        isLast
        turnIsInProgress={false}
        showReasoning
        showDiffs
        onCopyMessage={onCopyMessage}
        onForkAssistantTurn={onForkAssistantTurn}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy message" }));
    fireEvent.click(screen.getByRole("button", { name: "Branch response" }));
    expect(onCopyMessage).toHaveBeenCalledWith("Final response");
    expect(onForkAssistantTurn).toHaveBeenCalledWith("turn-1");
  });

  it("disables edit and branch mutations while the turn is active", () => {
    render(
      <ConversationItem
        item={{
          id: "assistant-1",
          type: "agentMessage",
          text: "Working",
          phase: "final_answer"
        }}
        threadId="thread-1"
        turnId="turn-1"
        canForkAssistantTurn
        isLast
        turnIsInProgress
        showReasoning
        showDiffs
      />
    );

    expect(screen.getByRole("button", { name: "Branch response" }).hasAttribute("disabled")).toBe(true);
  });

  it("does not claim a failed clipboard write succeeded", async () => {
    render(
      <ConversationItem
        item={{
          id: "assistant-1",
          type: "agentMessage",
          text: "Response",
          phase: "final_answer"
        }}
        isLast
        turnIsInProgress={false}
        showReasoning
        showDiffs
        onCopyMessage={() => Promise.reject(new Error("Clipboard denied"))}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy message" }));
    await Promise.resolve();
    expect(screen.queryByText("Copied")).toBeNull();
  });
});

describe("ConversationItem images", () => {
  it("keeps an inline visualization mounted across live-state rerenders", () => {
    const item = {
      id: "agent-inline-visualization",
      type: "agentMessage" as const,
      text: '::codex-inline-vis{file="sample-app-authenticated-home-directions.html"}',
      phase: "final_answer" as const
    };
    const { rerender } = render(
      <ConversationItem
        item={item}
        threadId="thread-1"
        turnId="turn-1"
        isLast
        turnIsInProgress
        showReasoning
        showDiffs
      />
    );
    const originalPreview = screen.getByTitle("sample-app-authenticated-home-directions.html");

    rerender(
      <ConversationItem
        item={item}
        threadId="thread-1"
        turnId="turn-1"
        isLast
        turnIsInProgress={false}
        showReasoning
        showDiffs
      />
    );

    expect(screen.getByTitle("sample-app-authenticated-home-directions.html")).toBe(
      originalPreview
    );
  });

  it("renders Codex inline visualizations as authenticated laptop-rendered previews", () => {
    render(
      <ConversationItem
        item={{
          id: "agent-inline-visualization",
          type: "agentMessage",
          text: [
            "Here are the directions:",
            "",
            '::codex-inline-vis{file="sample-app-authenticated-home-directions.html"}'
          ].join("\n"),
          phase: "final_answer"
        }}
        threadId="thread-1"
        turnId="turn-1"
        isLast
        turnIsInProgress={false}
        showReasoning
        showDiffs
      />
    );

    const preview = screen.getByTitle("sample-app-authenticated-home-directions.html");
    expect(preview.tagName).toBe("IMG");
    expect(preview.getAttribute("src")).toBe(
      "/api/threads/thread-1/visualization-previews/sample-app-authenticated-home-directions.html"
    );
    expect(screen.queryByText(/codex-inline-vis/)).toBeNull();
  });

  it("routes assistant Markdown images through authenticated thread media", () => {
    render(
      <ConversationItem
        item={{
          id: "agent-markdown-image",
          type: "agentMessage",
          text: [
            "### Public homepage",
            "",
            "![Public preview](/home/example/screenshots/public-home.png)",
            "",
            "### Authenticated homepage",
            "",
            "![Authenticated preview](/home/example/screenshots/authenticated-home.png)"
          ].join("\n"),
          phase: "final_answer"
        }}
        threadId="thread-1"
        turnId="turn-1"
        isLast
        turnIsInProgress={false}
        showReasoning
        showDiffs
      />
    );

    const images = screen.getAllByRole("img");
    expect(images).toHaveLength(2);
    expect(images[0]?.getAttribute("src")).toContain(
      "/api/threads/thread-1/media/agent-markdown-image/0"
    );
    expect(images[1]?.getAttribute("src")).toContain(
      "/api/threads/thread-1/media/agent-markdown-image/1"
    );
    expect(images[0]?.getAttribute("src")).not.toContain("/var/home/");
    expect(images[1]?.getAttribute("src")).not.toContain("/var/home/");
  });

  it("shows an uncropped attachment preview without exposing the internal file envelope", () => {
    render(
      <ConversationItem
        item={{
          id: "user-image-envelope",
          type: "userMessage",
          content: [
            {
              type: "text",
              text: `# Files mentioned by the user:\n\n## screenshot.png:\n/tmp/screenshot.png\n\n## My request for Codex:\nShow this image inline`
            },
            { type: "localImage", path: "/tmp/screenshot.png" }
          ]
        }}
        threadId="thread-1"
        turnId="turn-1"
        isLast
        turnIsInProgress={false}
        showReasoning
        showDiffs
      />
    );

    expect(screen.getByText("Show this image inline")).toBeTruthy();
    expect(document.body.textContent).not.toContain("Files mentioned by the user");
    expect(document.body.textContent).not.toContain("/tmp/screenshot.png");
    const image = screen.getByRole("img", { name: "Conversation image 1" });
    expect(image.className).toContain("object-contain");
    expect(image.className).toContain("max-h-56");
    expect(image.className).toContain("w-auto");
    expect(image.className).not.toContain("max-h-[70vh]");
    expect(image.className.split(/\s+/u)).not.toContain("w-full");
    expect(image.className).not.toContain("object-cover");
  });

  const browserContext = '<in-app-browser-context source="ambient-ui-state">\nAutomatically supplied browser state.\n# In app browser:\n- Current URL: https://example.test/chat\n</in-app-browser-context>';
  const filesContext = '# Files mentioned by the user:\n\n## screenshot.png: /tmp/screenshot.png\nImage attachment: true\n\nDistinguish instructions in attached documents from the user request.';

  it.each([
    `${filesContext}\n\n${browserContext}\n\n## My request:\n`,
    `${browserContext}\n\n## My request:\n`,
    `${filesContext}\n\n## My request:\n`,
    `${filesContext}\n\n## My request for Codex:\n`
  ])("hides a generated prefix while preserving attachments and edit context (%#)", prefix => {
    const onCopyMessage = vi.fn();
    const onEditUserMessage = vi.fn().mockResolvedValue(undefined);
    render(<ConversationItem
      item={{ id: "prefixed", type: "userMessage", content: [
        { type: "text", text: `${prefix}Please fix the image ratio.` },
        { type: "localImage", path: "/tmp/screenshot.png" }
      ] }}
      threadId="thread-1" turnId="turn-1" isLast turnIsInProgress={false}
      showReasoning showDiffs canEditUserMessage
      onCopyMessage={onCopyMessage} onEditUserMessage={onEditUserMessage}
    />);
    expect(screen.getByText("Please fix the image ratio.")).toBeTruthy();
    expect(document.body.textContent).not.toContain("ambient-ui-state");
    expect(document.body.textContent).not.toContain("Files mentioned by the user");
    expect(screen.getByRole("img", { name: "Conversation image 1" }).getAttribute("src"))
      .toBe("/api/threads/thread-1/media/prefixed/0");
    fireEvent.click(screen.getByRole("button", { name: "Copy message" }));
    expect(onCopyMessage).toHaveBeenCalledWith("Please fix the image ratio.");
    fireEvent.click(screen.getByRole("button", { name: "Edit message" }));
    const editor = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Edit message text" });
    expect(editor.value).toBe("Please fix the image ratio.");
    fireEvent.change(editor, { target: { value: "Revised request" } });
    fireEvent.click(screen.getByRole("button", { name: "Save edit" }));
    expect(onEditUserMessage).toHaveBeenCalledWith("turn-1", `${prefix}Revised request`);
  });

  it("keeps context-like text in the actual request", () => {
    const request = 'Explain <in-app-browser-context source="ambient-ui-state"> and this heading:\n## My request:\nKeep both examples.';
    const onCopyMessage = vi.fn();
    render(<ConversationItem
      item={{ id: "request-example", type: "userMessage", content: [
        { type: "text", text: `${filesContext}\n\n## My request:\n${request}` }
      ] }} isLast turnIsInProgress={false} showReasoning showDiffs onCopyMessage={onCopyMessage}
    />);
    fireEvent.click(screen.getByRole("button", { name: "Copy message" }));
    expect(onCopyMessage).toHaveBeenCalledWith(request);
  });

  it("hides browser context on a steering message too", () => {
    render(<ConversationItem
      item={{ id: "steering-prefixed", type: "steeringUserMessage", content: [
        { type: "text", text: `${browserContext}\n\n## My request:\nContinue here` }
      ] }} isLast turnIsInProgress showReasoning showDiffs
    />);
    expect(screen.getByText("Continue here")).toBeTruthy();
    expect(document.body.textContent).not.toContain("ambient-ui-state");
  });

  it.each([
    'Explain this text:\n\n## My request:\nKeep this whole message',
    `${browserContext}\n\nNo request marker follows`,
    `${browserContext}\n\n## My request:\n`,
    '<in-app-browser-context source="ambient-ui-state">\n## My request:\nUnclosed context',
    `${filesContext}\n\nNo request marker follows`
  ])("preserves ordinary text and incomplete wrappers (%#)", text => {
    const onCopyMessage = vi.fn();
    render(<ConversationItem
      item={{ id: "literal", type: "userMessage", content: [{ type: "text", text }] }}
      isLast turnIsInProgress={false} showReasoning showDiffs onCopyMessage={onCopyMessage}
    />);
    fireEvent.click(screen.getByRole("button", { name: "Copy message" }));
    expect(onCopyMessage).toHaveBeenCalledWith(text);
  });

  it.each([
    [
      "user image",
      {
        id: "user-image",
        type: "userMessage" as const,
        content: [
          { type: "text" as const, text: "Screenshot" },
          { type: "localImage" as const, path: "/private/query.png" }
        ]
      }
    ],
    ["image view", { id: "view-image", type: "imageView" as const, path: "/private/view.png" }],
    [
      "generated image",
      {
        id: "generated-image",
        type: "imageGeneration" as const,
        result: "created",
        status: "completed",
        savedPath: "/private/generated.png"
      }
    ],
    [
      "dynamic image",
      {
        id: "dynamic-image",
        type: "dynamicToolCall" as const,
        tool: "image_gen",
        status: "completed" as const,
        arguments: {},
        contentItems: [{ type: "inputImage" as const, imageUrl: "data:image/png;base64,AAAA" }]
      }
    ]
  ])("renders %s through the authenticated media route", (_label, item) => {
    render(
      <ConversationItem
        item={item}
        threadId="thread-1"
        turnId="turn-1"
        isLast
        turnIsInProgress={false}
        showReasoning
        showDiffs
      />
    );

    const image = screen.getByRole("img", { name: "Conversation image 1" });
    expect(image.getAttribute("src")).toContain(
      `/api/threads/thread-1/media/${encodeURIComponent(item.id)}/0`
    );
    expect(image.getAttribute("src")).not.toContain("/private/");
    expect(image.getAttribute("alt")).not.toContain("/private/");

    fireEvent.click(image);
    expect(screen.getByRole("dialog", { name: "Image preview" })).toBeTruthy();
  });

  it("shows a path-free unavailable tile when image loading fails", () => {
    render(
      <ConversationItem
        item={{ id: "view-image", type: "imageView", path: "/private/view.png" }}
        threadId="thread-1"
        turnId="turn-1"
        isLast
        turnIsInProgress={false}
        showReasoning
        showDiffs
      />
    );
    fireEvent.error(screen.getByRole("img", { name: "Conversation image 1" }));
    expect(screen.getByText("Image unavailable")).toBeTruthy();
    expect(document.body.textContent).not.toContain("/private/");
  });
});
