import fs from "node:fs";
import { chromium } from "playwright-core";

const PREVIEW_WIDTH = 768;
const PREVIEW_HEIGHT = 900;
const MAX_PREVIEW_HEIGHT = 12_000;
const MAX_CACHED_PREVIEWS = 24;
const MAX_PREVIEW_CACHE_BYTES = 64 * 1024 * 1024;

interface CachedPreview {
  fingerprint: string;
  png: Buffer;
}

const previewCache = new Map<string, CachedPreview>();
const previewRendersInFlight = new Map<string, Promise<Buffer>>();
let previewCacheBytes = 0;
let previewRenderQueue: Promise<void> = Promise.resolve();

function enqueuePreviewRender(render: () => Promise<Buffer>): Promise<Buffer> {
  const pendingRender = previewRenderQueue.then(render);
  previewRenderQueue = pendingRender.then(
    () => undefined,
    () => undefined
  );
  return pendingRender;
}

function cachePreview(previewPath: string, fingerprint: string, png: Buffer): void {
  const previous = previewCache.get(previewPath);
  if (previous) {
    previewCacheBytes -= previous.png.length;
    previewCache.delete(previewPath);
  }
  previewCache.set(previewPath, { fingerprint, png });
  previewCacheBytes += png.length;

  while (
    previewCache.size > MAX_CACHED_PREVIEWS ||
    previewCacheBytes > MAX_PREVIEW_CACHE_BYTES
  ) {
    const oldestPath = previewCache.keys().next().value;
    if (!oldestPath) {
      break;
    }
    const oldest = previewCache.get(oldestPath);
    if (oldest) {
      previewCacheBytes -= oldest.png.length;
    }
    previewCache.delete(oldestPath);
  }
}

async function renderVisualizationPreviewPage(previewPath: string): Promise<Buffer> {
  const previewHtml = await fs.promises.readFile(previewPath, "utf8");
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true
  });

  try {
    const page = await browser.newPage({
      viewport: {
        width: PREVIEW_WIDTH,
        height: PREVIEW_HEIGHT
      },
      colorScheme: "dark"
    });
    await page.setContent(previewHtml, {
      waitUntil: "load",
      timeout: 15_000
    });

    const previewContainer = page.locator("iframe").first();
    await previewContainer.waitFor({ state: "attached" });
    await previewContainer.evaluate((element) => {
      element.style.width = "100%";
      element.style.height = "900px";
    });

    const previewBody = page.frameLocator("iframe").locator("body");
    await previewBody.waitFor({ state: "visible" });
    await previewBody.evaluate(async () => {
      await document.fonts.ready;
    });
    const contentHeight = Math.min(
      MAX_PREVIEW_HEIGHT,
      await previewBody.evaluate((element) =>
        Math.ceil(Math.max(element.scrollHeight, document.documentElement.scrollHeight))
      )
    );
    await previewContainer.evaluate((element, height) => {
      element.style.height = `${String(height)}px`;
    }, contentHeight);
    await page.setViewportSize({
      width: PREVIEW_WIDTH,
      height: contentHeight
    });

    return await previewBody.screenshot({
      type: "png",
      animations: "disabled"
    });
  } finally {
    await browser.close();
  }
}

export async function renderVisualizationPreview(previewPath: string): Promise<Buffer> {
  const source = await fs.promises.stat(previewPath);
  const fingerprint = `${String(source.mtimeMs)}:${String(source.size)}`;
  const cached = previewCache.get(previewPath);
  if (cached?.fingerprint === fingerprint) {
    previewCache.delete(previewPath);
    previewCache.set(previewPath, cached);
    return cached.png;
  }

  const renderKey = `${previewPath}\u0000${fingerprint}`;
  const inFlight = previewRendersInFlight.get(renderKey);
  if (inFlight) {
    return inFlight;
  }

  const pendingRender = enqueuePreviewRender(async () => {
    const png = await renderVisualizationPreviewPage(previewPath);
    cachePreview(previewPath, fingerprint, png);
    return png;
  });
  previewRendersInFlight.set(renderKey, pendingRender);
  void pendingRender.then(
    () => previewRendersInFlight.delete(renderKey),
    () => previewRendersInFlight.delete(renderKey)
  );
  return pendingRender;
}
