import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renderVisualizationPreview } from "../src/visualization-preview.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("renderVisualizationPreview", () => {
  it("captures the complete visualization at a mobile-readable width", async () => {
    const root = fs.mkdtempSync(path.join("/tmp", "codex-mobile-visualization-preview-"));
    temporaryDirectories.push(root);
    const previewPath = path.join(root, "design-preview.html");
    const repeatedCards = Array.from(
      { length: 6 },
      (_, index) =>
        `<section style="height:240px;background:hsl(${String(index * 45)} 70% 45%)">Card ${String(index + 1)}</section>`
    ).join("");
    fs.writeFileSync(
      previewPath,
      [
        "<!doctype html><html><body>",
        '<iframe title="Preview" style="width:100%;max-width:736px;height:600px;border:0"',
        ` srcdoc="${[
          "<!doctype html><html><body style='margin:0;display:grid;grid-template-columns:1fr 1fr'>",
          repeatedCards,
          "</body></html>"
        ]
          .join("")
          .replaceAll("&", "&amp;")
          .replaceAll('"', "&quot;")}"></iframe>`,
        "</body></html>"
      ].join("")
    );

    const png = await renderVisualizationPreview(previewPath);

    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    );
    expect(png.readUInt32BE(16)).toBeGreaterThanOrEqual(700);
    expect(png.readUInt32BE(16)).toBeLessThanOrEqual(768);
    expect(png.readUInt32BE(20)).toBeGreaterThan(600);
  }, 20_000);
});
