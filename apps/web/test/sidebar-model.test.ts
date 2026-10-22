import { describe, expect, it } from "vitest";
import { buildSidebarModel } from "../src/sidebar-model.js";

type TestThread = {
    id: string;
    preview: string;
    createdAt: number;
    updatedAt: number;
    sidebar: {
        isPinned: boolean;
        isProjectPinned: boolean;
        isProjectless: boolean;
        projectPath: string | null;
        projectName?: string | null;
        projectOrder: number | null;
        hasUnreadTurn: boolean;
    };
};

function thread(
    id: string,
    updatedAt: number,
    sidebar: Partial<TestThread["sidebar"]> = {}
): TestThread {
    return {
        id,
        preview: id,
        createdAt: updatedAt,
        updatedAt,
        sidebar: {
            isPinned: false,
            isProjectPinned: false,
            isProjectless: false,
            projectPath: "/workspace/default",
            projectOrder: null,
            hasUnreadTurn: false,
            ...sidebar
        }
    };
}

describe("buildSidebarModel", () => {
    it("uses the saved project name while retaining its folder for new chats", () => {
        const model = buildSidebarModel([
            thread("named", 5, { projectPath: "/workspace/folder", projectName: "My Studio" })
        ]);
        expect(model.projects[0]?.label).toBe("My Studio");
        expect(model.projects[0]?.projectPath).toBe("/workspace/folder");
    });

    it("separates pinned threads, pinned projects, projects, and projectless tasks", () => {
        const model = buildSidebarModel([
            thread("pinned-thread", 5, { isPinned: true }),
            thread("pinned-project-thread", 4, {
                isProjectPinned: true,
                projectPath: "/workspace/pinned"
            }),
            thread("project-thread", 3, { projectPath: "/workspace/project" }),
            thread("task", 2, { isProjectless: true, projectPath: null })
        ]);

        expect(model.pinnedThreads.map((item) => item.id)).toEqual(["pinned-thread"]);
        expect(model.pinnedProjects.map((group) => group.projectPath)).toEqual([
            "/workspace/pinned"
        ]);
        expect(model.projects.map((group) => group.projectPath)).toEqual([
            "/workspace/project"
        ]);
        expect(model.tasks.map((item) => item.id)).toEqual(["task"]);
    });

    it("uses Desktop project order before recent activity", () => {
        const model = buildSidebarModel([
            thread("newer", 30, { projectPath: "/workspace/newer", projectOrder: 1 }),
            thread("older", 10, { projectPath: "/workspace/older", projectOrder: 0 })
        ]);

        expect(model.projects.map((group) => group.projectPath)).toEqual([
            "/workspace/older",
            "/workspace/newer"
        ]);
    });

    it("sorts threads and tasks by recent activity and removes pinned duplicates", () => {
        const model = buildSidebarModel([
            thread("older", 10),
            thread("newer-pinned", 30, { isPinned: true }),
            thread("task-old", 5, { isProjectless: true, projectPath: null }),
            thread("task-new", 20, { isProjectless: true, projectPath: null })
        ]);

        expect(model.pinnedThreads.map((item) => item.id)).toEqual(["newer-pinned"]);
        expect(model.projects[0]?.threads.map((item) => item.id)).toEqual(["older"]);
        expect(model.tasks.map((item) => item.id)).toEqual(["task-new", "task-old"]);
    });
});
