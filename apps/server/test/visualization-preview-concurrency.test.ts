import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const browserState = vi.hoisted(() => ({
  active: 0,
  launches: 0,
  maximumActive: 0
}));

vi.mock("playwright-core", () => ({
  chromium: {
    launch: vi.fn(async () => {
      browserState.active += 1;
      browserState.launches += 1;
      browserState.maximumActive = Math.max(browserState.maximumActive, browserState.active);
      let bodyEvaluationCount = 0;
      const previewBody = {
        evaluate: vi.fn(async () => {
          bodyEvaluationCount += 1;
          return bodyEvaluationCount === 1 ? undefined : 900;
        }),
        screenshot: vi.fn(async () => Buffer.from("preview")),
        waitFor: vi.fn(async () => undefined)
      };
      return {
        close: vi.fn(async () => {
          browserState.active -= 1;
        }),
        newPage: vi.fn(async () => ({
          frameLocator: vi.fn(() => ({
            locator: vi.fn(() => previewBody)
          })),
          locator: vi.fn(() => ({
            first: vi.fn(() => ({
              evaluate: vi.fn(async () => undefined),
              waitFor: vi.fn(async () => undefined)
            }))
          })),
          setContent: vi.fn(async () => {
            await new Promise((resolve) => setTimeout(resolve, 2));
          }),
          setViewportSize: vi.fn(async () => undefined)
        }))
      };
    })
  }
}));

import { renderVisualizationPreview } from "../src/visualization-preview.js";

const temporaryDirectories: string[] = [];

function createPreviewFile(name: string): string {
  const root = fs.mkdtempSync(path.join("/tmp", "codex-mobile-preview-load-"));
  temporaryDirectories.push(root);
  const previewPath = path.join(root, name);
  fs.writeFileSync(previewPath, "<!doctype html><html><body><iframe></iframe></body></html>");
  return previewPath;
}

beforeEach(() => {
  browserState.active = 0;
  browserState.launches = 0;
  browserState.maximumActive = 0;
});

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("visualization preview load control", () => {
  it("coalesces a 48-request task reload across six visualization files", async () => {
    const previewPaths = Array.from({ length: 6 }, (_, index) =>
      createPreviewFile(`thread-design-${String(index)}.html`)
    );

    const previews = await Promise.all(
      Array.from({ length: 48 }, (_, index) =>
        renderVisualizationPreview(previewPaths[index % previewPaths.length]!)
      )
    );

    expect(previews).toHaveLength(48);
    expect(browserState.launches).toBe(6);
    expect(browserState.maximumActive).toBe(1);
  });

  it("serializes distinct visualization renders", async () => {
    const previewPaths = Array.from({ length: 12 }, (_, index) =>
      createPreviewFile(`design-${String(index)}.html`)
    );

    await Promise.all(previewPaths.map((previewPath) => renderVisualizationPreview(previewPath)));

    expect(browserState.launches).toBe(12);
    expect(browserState.maximumActive).toBe(1);
  });

  it("reuses a completed preview until its source changes", async () => {
    const previewPath = createPreviewFile("cached.html");

    await renderVisualizationPreview(previewPath);
    await renderVisualizationPreview(previewPath);
    fs.appendFileSync(previewPath, "<!-- changed -->");
    await renderVisualizationPreview(previewPath);

    expect(browserState.launches).toBe(2);
  });
});
