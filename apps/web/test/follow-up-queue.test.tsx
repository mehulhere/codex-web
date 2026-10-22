import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FollowUpQueue } from "../src/components/FollowUpQueue.js";

afterEach(cleanup);

const messages = [
  { id: "queue-1", text: "first follow up", createdAt: 1_700_000_000_000 },
  { id: "queue-2", text: "second follow up", createdAt: 1_700_000_000_001 }
];

const image = {
  id: "00000000-0000-4000-8000-000000000003",
  filename: "queued.png",
  mediaType: "image/png" as const,
  size: 4,
  url: "/api/uploads/00000000-0000-4000-8000-000000000003"
};

describe("FollowUpQueue", () => {
  it("renders queued prompts and invokes steer and delete", () => {
    const onSteer = vi.fn().mockResolvedValue(undefined);
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(
      <FollowUpQueue
        messages={messages}
        busy={false}
        onEdit={() => Promise.resolve()}
        onDelete={onDelete}
        onSteer={onSteer}
      />
    );

    expect(screen.getByText("2 queued")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Steer first follow up" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete second follow up" }));
    expect(onSteer).toHaveBeenCalledWith("queue-1");
    expect(onDelete).toHaveBeenCalledWith("queue-2");
  });

  it("edits a queued prompt inline", () => {
    const onEdit = vi.fn().mockResolvedValue(undefined);
    render(
      <FollowUpQueue
        messages={messages}
        busy={false}
        onEdit={onEdit}
        onDelete={() => Promise.resolve()}
        onSteer={() => Promise.resolve()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit first follow up" }));
    const editor = screen.getByRole("textbox", { name: "Edit queued message" });
    fireEvent.change(editor, { target: { value: "revised follow up" } });
    fireEvent.click(screen.getByRole("button", { name: "Save queued message" }));
    expect(onEdit).toHaveBeenCalledWith("queue-1", "revised follow up");
  });

  it("renders an image-only queued follow-up", () => {
    render(
      <FollowUpQueue
        messages={[{ id: "queue-image", text: "", createdAt: 1, images: [image] }]}
        busy={false}
        onEdit={() => Promise.resolve()}
        onDelete={() => Promise.resolve()}
        onSteer={() => Promise.resolve()}
      />
    );

    expect(screen.getByRole("img", { name: "queued.png" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Steer queued.png" })).toBeTruthy();
  });
});
