import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizeReasoningEffort,
  reasoningEffortOptions,
  ReasoningEffortSelect
} from "../src/components/ReasoningEffortSelect.js";

afterEach(cleanup);

describe("ReasoningEffortSelect", () => {
  it("shows only supported choices and normalizes legacy selections to low", () => {
    const options = reasoningEffortOptions([
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh"
    ]);

    expect(options).toEqual(["low", "medium", "high", "xhigh"]);
    expect(options).not.toContain("minimal");
    expect(options).not.toContain("App default");
    expect(normalizeReasoningEffort("")).toBe("low");
    expect(normalizeReasoningEffort("minimal")).toBe("low");

    render(
      <ReasoningEffortSelect
        value="minimal"
        options={options}
        onValueChange={vi.fn()}
      />
    );

    expect(screen.getByRole("combobox").textContent).toContain("low");
    expect(screen.queryByText("minimal")).toBeNull();
    expect(screen.queryByText("App default")).toBeNull();
  });
});
