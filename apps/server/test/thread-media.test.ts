import { chmod, mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseThreadConversationState, type ThreadConversationState } from "@farfield/protocol";
import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_THREAD_IMAGE_BYTES,
  materializeThreadImage,
  resolveCurrentThreadImage,
  resolveThreadImage,
  ThreadMediaNotFoundError
} from "../src/thread-media.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

function createImageThread(localPath = "/private/screenshot.png"): ThreadConversationState {
  return {
    id: "thread-1",
    turns: [
      {
        id: "turn-1",
        status: "completed",
        items: [
          {
            id: "user-1",
            type: "userMessage",
            content: [
              { type: "text", text: "Review these" },
              { type: "localImage", path: localPath, detail: "high" },
              { type: "image", url: "https://images.example.test/remote.webp" }
            ]
          },
          { id: "view-1", type: "imageView", path: localPath },
          {
            id: "generated-1",
            type: "imageGeneration",
            result: "created",
            status: "completed",
            savedPath: localPath
          },
          {
            id: "dynamic-1",
            type: "dynamicToolCall",
            tool: "image_gen",
            status: "completed",
            arguments: {},
            contentItems: [
              {
                type: "inputImage",
                imageUrl: "data:image/png;base64,iVBORw0KGgo="
              }
            ]
          },
          {
            id: "agent-markdown-1",
            type: "agentMessage",
            text: [
              "### Public homepage",
              "",
              "![Public preview](/private/public-home.png)",
              "",
              "### Authenticated homepage",
              "",
              "![Authenticated preview](/private/authenticated-home.png)"
            ].join("\n"),
            phase: "final_answer"
          }
        ]
      }
    ],
    requests: []
  };
}

describe("resolveThreadImage", () => {
  it("does not treat a stored generated-image identity as a local path", () => {
    const thread = parseThreadConversationState({ id: "thread-1", turns: [{ status: "completed", items: [{
      id: "stored-1", type: "imageGeneration", fileId: "file-1", status: "completed",
      inputImages: [{ path: "/tmp/input.png", sha256: "a".repeat(64) }]
    }] }] });
    expect(() => resolveThreadImage(thread, "stored-1", 0)).toThrow(ThreadMediaNotFoundError);
    const image = thread.turns[0]?.items[0];
    if (image?.type !== "imageGeneration") throw new Error("Missing synthetic image fixture");
    image.savedPath = "/tmp/generated.png";
    expect(resolveThreadImage(thread, "stored-1", 0)).toEqual({ type: "local", path: "/tmp/generated.png" });
  });

  it("resolves only images referenced by the requested item and index", () => {
    const thread = createImageThread();

    expect(resolveThreadImage(thread, "user-1", 0)).toEqual({
      type: "local",
      path: "/private/screenshot.png"
    });
    expect(resolveThreadImage(thread, "user-1", 1)).toEqual({
      type: "remote",
      url: "https://images.example.test/remote.webp"
    });
    expect(resolveThreadImage(thread, "generated-1", 0)).toEqual({
      type: "local",
      path: "/private/screenshot.png"
    });
    expect(resolveThreadImage(thread, "dynamic-1", 0)).toEqual({
      type: "data",
      value: "data:image/png;base64,iVBORw0KGgo="
    });
    expect(resolveThreadImage(thread, "agent-markdown-1", 0)).toEqual({
      type: "local",
      path: "/private/public-home.png"
    });
    expect(resolveThreadImage(thread, "agent-markdown-1", 1)).toEqual({
      type: "local",
      path: "/private/authenticated-home.png"
    });
  });

  it("rejects missing image positions without exposing local paths", () => {
    const thread = createImageThread();
    let captured: Error | null = null;
    try {
      resolveThreadImage(thread, "user-1", 9);
    } catch (error) {
      captured = error instanceof Error ? error : null;
    }
    expect(captured).toBeInstanceOf(ThreadMediaNotFoundError);
  });

  it("resolves newly streamed images without reading lagging stored history", async () => {
    const thread = createImageThread();
    let storedReadCount = 0;

    await expect(
      resolveCurrentThreadImage(
        thread,
        async () => {
          storedReadCount += 1;
          return { id: "thread-1", turns: [], requests: [] };
        },
        "user-1",
        0
      )
    ).resolves.toEqual({ type: "local", path: "/private/screenshot.png" });
    expect(storedReadCount).toBe(0);
  });
});

describe("materializeThreadImage", () => {
  it("serves a referenced PNG after detecting its byte signature", async () => {
    const directory = await mkdtemp(join(tmpdir(), "farfield-media-"));
    temporaryDirectories.push(directory);
    const imagePath = join(directory, "screenshot.bin");
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00
    ]);
    await writeFile(imagePath, png);

    await expect(
      materializeThreadImage(resolveThreadImage(createImageThread(imagePath), "view-1", 0))
    ).resolves.toEqual({
      type: "bytes",
      contentType: "image/png",
      body: png
    });
  });

  it("rejects unsupported file contents and oversized data images", async () => {
    const directory = await mkdtemp(join(tmpdir(), "farfield-media-"));
    temporaryDirectories.push(directory);
    const imagePath = join(directory, "not-an-image.png");
    await writeFile(imagePath, "private text");

    await expect(
      materializeThreadImage(resolveThreadImage(createImageThread(imagePath), "view-1", 0))
    ).rejects.toThrow(/Unsupported image type/);

    const oversized = `data:image/png;base64,${Buffer.alloc(MAX_THREAD_IMAGE_BYTES + 1).toString("base64")}`;
    await expect(
      materializeThreadImage({ type: "data", value: oversized })
    ).rejects.toThrow(/size limit/);
  });

  it("rejects oversized local images before attempting to read their contents", async () => {
    const directory = await mkdtemp(join(tmpdir(), "farfield-media-"));
    temporaryDirectories.push(directory);
    const imagePath = join(directory, "oversized.png");
    await writeFile(imagePath, "");
    await truncate(imagePath, MAX_THREAD_IMAGE_BYTES + 1);
    await chmod(imagePath, 0o000);

    await expect(
      materializeThreadImage({ type: "local", path: imagePath })
    ).rejects.toThrow(/size limit/);
  });

  it("returns an HTTPS redirect without fetching it on the server", async () => {
    await expect(
      materializeThreadImage({
        type: "remote",
        url: "https://images.example.test/image.png"
      })
    ).resolves.toEqual({
      type: "redirect",
      location: "https://images.example.test/image.png"
    });
  });
});
