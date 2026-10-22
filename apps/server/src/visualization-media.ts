import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const VISUALIZATION_FILENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.html$/u;

export function isSafeVisualizationFilename(filename: string): boolean {
  return VISUALIZATION_FILENAME_PATTERN.test(filename);
}

export function resolveVisualizationRoot(codexHome = process.env["CODEX_HOME"]): string {
  const home = codexHome?.trim() || path.join(os.homedir(), ".codex");
  return path.join(home, "visualizations");
}

/**
 * Resolve a generated Codex visualization without accepting a caller-provided
 * filesystem path. Visualization files are stored under a date directory
 * followed by the owning thread id.
 */
export async function resolveThreadVisualizationPath(
  threadId: string,
  filename: string,
  visualizationRoot = resolveVisualizationRoot()
): Promise<string | null> {
  if (!threadId || threadId.includes("/") || threadId.includes("\\") || !isSafeVisualizationFilename(filename)) {
    return null;
  }

  let yearEntries: fs.Dirent[];
  try {
    yearEntries = await fs.promises.readdir(visualizationRoot, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const yearEntry of yearEntries) {
    if (!yearEntry.isDirectory() || !/^\d{4}$/u.test(yearEntry.name)) continue;
    const yearPath = path.join(visualizationRoot, yearEntry.name);
    let monthEntries: fs.Dirent[];
    try {
      monthEntries = await fs.promises.readdir(yearPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const monthEntry of monthEntries) {
      if (!monthEntry.isDirectory() || !/^\d{2}$/u.test(monthEntry.name)) continue;
      const monthPath = path.join(yearPath, monthEntry.name);
      let dayEntries: fs.Dirent[];
      try {
        dayEntries = await fs.promises.readdir(monthPath, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const dayEntry of dayEntries) {
        if (!dayEntry.isDirectory() || !/^\d{2}$/u.test(dayEntry.name)) continue;
        const candidate = path.join(monthPath, dayEntry.name, threadId, filename);
        try {
          const stat = await fs.promises.lstat(candidate);
          if (stat.isFile()) return candidate;
        } catch {
          // The visualization may have been cleaned up between directory
          // traversal and stat; keep looking in the remaining date folders.
        }
      }
    }
  }

  return null;
}

export async function resolveThreadVisualizationPreviewPath(
  threadId: string,
  filename: string,
  visualizationRoot = resolveVisualizationRoot()
): Promise<string | null> {
  if (!isSafeVisualizationFilename(filename)) {
    return null;
  }

  const previewFilename = filename.replace(/\.html$/u, "-preview.html");
  return resolveThreadVisualizationPath(threadId, previewFilename, visualizationRoot);
}
