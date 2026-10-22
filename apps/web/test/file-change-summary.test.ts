import { describe, expect, it } from "vitest";
import { summarizeFileChanges } from "../src/lib/fileChangeSummary.js";

describe("summarizeFileChanges", () => {
  it("counts files and real added and removed lines across file-change items", () => {
    expect(
      summarizeFileChanges([
        {
          path: "src/one.ts",
          kind: { type: "update" },
          diff: "--- a/src/one.ts\n+++ b/src/one.ts\n@@ -1,2 +1,2 @@\n-old\n+new\n context"
        },
        {
          path: "src/two.ts",
          kind: { type: "create" },
          diff: "+++ b/src/two.ts\n+first\n+second"
        }
      ])
    ).toEqual({ files: 2, added: 3, removed: 1 });
  });

  it("counts a changed file even when no diff text is available", () => {
    expect(
      summarizeFileChanges([
        { path: "src/no-diff.ts", kind: { type: "update" } }
      ])
    ).toEqual({ files: 1, added: 0, removed: 0 });
  });

  it("uses the latest diff when a file is updated more than once in a turn", () => {
    expect(
      summarizeFileChanges([
        {
          path: "src/repeated.ts",
          kind: { type: "update" },
          diff: "-old\n+intermediate"
        },
        {
          path: "src/repeated.ts",
          kind: { type: "update" },
          diff: "-old\n+final\n+extra"
        }
      ])
    ).toEqual({ files: 1, added: 2, removed: 1 });
  });
});
