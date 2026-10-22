import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useTheme } from "../src/hooks/useTheme";

beforeEach(() => {
  localStorage.setItem("theme", "light");
  document.documentElement.classList.remove("dark");
});
afterEach(cleanup);

describe("shared theme", () => {
  it("updates existing code blocks and newly mounted consumers together", () => {
    const app = renderHook(useTheme);
    const code = renderHook(useTheme);
    act(() => app.result.current.toggle());
    expect(code.result.current.theme).toBe("dark");
    const anotherCodeBlock = renderHook(useTheme);
    expect(anotherCodeBlock.result.current.theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    act(() => code.result.current.toggle());
    expect(app.result.current.theme).toBe("light");
    expect(anotherCodeBlock.result.current.theme).toBe("light");
  });

  it("observes a theme change from another browser tab", () => {
    const app = renderHook(useTheme);
    act(() => {
      localStorage.setItem("theme", "dark");
      window.dispatchEvent(new StorageEvent("storage", { key: "theme", newValue: "dark" }));
    });
    expect(app.result.current.theme).toBe("dark");
  });
});
