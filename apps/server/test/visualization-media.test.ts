import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isSafeVisualizationFilename,
  resolveThreadVisualizationPath,
  resolveThreadVisualizationPreviewPath
} from "../src/visualization-media.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("resolveThreadVisualizationPath", () => {
  it("finds a visualization by thread id and filename", async () => {
    const root = fs.mkdtempSync(path.join("/tmp", "codex-mobile-visualizations-"));
    temporaryDirectories.push(root);
    const filePath = path.join(root, "2026", "07", "27", "thread-1", "design.html");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "<div>design</div>");

    await expect(resolveThreadVisualizationPath("thread-1", "design.html", root)).resolves.toBe(
      filePath
    );
  });

  it("finds the standalone preview companion for a visualization", async () => {
    const root = fs.mkdtempSync(path.join("/tmp", "codex-mobile-visualizations-"));
    temporaryDirectories.push(root);
    const threadDirectory = path.join(root, "2026", "07", "27", "thread-1");
    fs.mkdirSync(threadDirectory, { recursive: true });
    const previewPath = path.join(threadDirectory, "design-preview.html");
    fs.writeFileSync(path.join(threadDirectory, "design.html"), "<div>design</div>");
    fs.writeFileSync(previewPath, "<html><body>preview</body></html>");

    await expect(
      resolveThreadVisualizationPreviewPath("thread-1", "design.html", root)
    ).resolves.toBe(previewPath);
  });

  it("rejects path traversal and non-html filenames", () => {
    expect(isSafeVisualizationFilename("../secret")).toBe(false);
    expect(isSafeVisualizationFilename("design.html/secret")).toBe(false);
    expect(isSafeVisualizationFilename("design.txt")).toBe(false);
  });

  it("does not follow visualization file symlinks", async () => {
    const root = fs.mkdtempSync(path.join("/tmp", "codex-mobile-visualizations-"));
    temporaryDirectories.push(root);
    const threadDirectory = path.join(root, "2026", "07", "27", "thread-1");
    fs.mkdirSync(threadDirectory, { recursive: true });
    const outsideFile = path.join(root, "outside.html");
    fs.writeFileSync(outsideFile, "<div>outside</div>");
    fs.symlinkSync(outsideFile, path.join(threadDirectory, "design.html"));

    await expect(resolveThreadVisualizationPath("thread-1", "design.html", root)).resolves.toBeNull();
  });

  it("returns null when the visualization does not exist", async () => {
    const root = fs.mkdtempSync(path.join("/tmp", "codex-mobile-visualizations-"));
    temporaryDirectories.push(root);

    await expect(resolveThreadVisualizationPath("thread-1", "missing.html", root)).resolves.toBeNull();
  });
});
