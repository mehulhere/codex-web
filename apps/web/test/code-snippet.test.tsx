import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CodeSnippet } from "../src/components/CodeSnippet";

beforeEach(() => localStorage.setItem("theme", "dark"));
afterEach(cleanup);

describe("code rendering", () => {
  it("keeps ordinary code highlighted, including language aliases", async () => {
    const { container } = render(<CodeSnippet code="const answer = 42;" language="js" />);
    await waitFor(() => expect(container.querySelectorAll(".token").length).toBeGreaterThan(0));
    expect(container.textContent).toBe("const answer = 42;");
  });

  it("renders very large output as complete copyable text without a token tree", () => {
    const code = "const value = 123;\n".repeat(2_000);
    const { container } = render(<CodeSnippet code={code} language="javascript" />);
    expect(container.querySelector("code")?.textContent).toBe(code);
    expect(container.querySelectorAll(".token")).toHaveLength(0);
    expect(container.querySelector("code")?.childNodes).toHaveLength(1);
  });

  it("does not tokenize plain command output", () => {
    render(<CodeSnippet code="Build passed" language="text" />);
    expect(screen.getByText("Build passed").tagName).toBe("CODE");
  });
});
