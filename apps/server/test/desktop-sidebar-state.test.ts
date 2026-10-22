import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
    DesktopSidebarStateReader,
    parseDesktopSidebarState,
    resolveThreadSidebarMetadata,
    resolveDesktopGlobalStatePath
} from "../src/desktop-sidebar-state.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe("resolveDesktopGlobalStatePath", () => {
    it("uses CODEX_HOME when supplied", () => {
        expect(resolveDesktopGlobalStatePath("/tmp/codex-home")).toBe(
            "/tmp/codex-home/.codex-global-state.json"
        );
    });
});

describe("parseDesktopSidebarState", () => {
    it("resolves project ids to saved names and roots, preserving order, pins and worktree membership", () => {
        const state = parseDesktopSidebarState({
            "local-projects": {
                "local-studio": { id: "local-studio", name: "My Studio", rootPaths: ["/workspace/studio"], createdAt: 1, updatedAt: 2 },
                "jobs-id": { id: "jobs-id", name: "Job Search", rootPaths: ["/workspace/jobs"], createdAt: 1, updatedAt: 2 }
            },
            "project-order": ["jobs-id", "local-studio"],
            "electron-saved-workspace-roots": ["/workspace/studio", "/workspace/jobs"],
            "pinned-project-ids": ["local-studio"],
            "thread-project-assignments": {
                worktree: { projectKind: "local", projectId: "local-studio", cwd: "/worktrees/studio" }
            }
        }, "/tmp/state.json", 10);
        expect(state.projectOrder).toEqual(["/workspace/jobs", "/workspace/studio"]);
        expect(resolveThreadSidebarMetadata(state, { id: "worktree", cwd: "/worktrees/studio" })).toMatchObject({
            projectPath: "/workspace/studio", projectName: "My Studio", projectOrder: 1, isProjectPinned: true
        });
        expect(resolveThreadSidebarMetadata(state, { id: "cwd-only", cwd: "/workspace/studio" })).toMatchObject({
            projectPath: "/workspace/studio", projectName: "My Studio", isProjectPinned: true
        });
    });

    it("rejects a saved project without a usable name", () => {
        expect(() => parseDesktopSidebarState({
            "local-projects": { invalid: { id: "invalid", name: " ", rootPaths: ["/workspace/project"], createdAt: 1, updatedAt: 2 } }
        }, "/tmp/state.json", 10)).toThrow();
    });

    it("normalizes pin, project, projectless, ordering, and unread metadata", () => {
        const state = parseDesktopSidebarState(
            {
                "pinned-thread-ids": ["thread-pinned"],
                "pinned-project-ids": ["/workspace/project"],
                "projectless-thread-ids": ["thread-task"],
                "thread-project-assignments": { "thread-1": "/workspace/project" },
                "sidebar-thread-metadata": {
                    "thread-2": { workspaceRoot: "/workspace/other" }
                },
                "project-order": ["/workspace/project", "/workspace/other"],
                "electron-persisted-atom-state": {
                    "unread-thread-ids-by-host-v1": {
                        local: ["thread-unread"]
                    }
                }
            },
            "/tmp/state.json",
            10
        );

        expect(state.pinnedThreadIds.has("thread-pinned")).toBe(true);
        expect(state.pinnedProjectIds.has("/workspace/project")).toBe(true);
        expect(state.projectlessThreadIds.has("thread-task")).toBe(true);
        expect(state.threadProjectAssignments.get("thread-1")).toBe("/workspace/project");
        expect(state.sidebarThreadMetadata.get("thread-2")?.projectPath).toBe(
            "/workspace/other"
        );
        expect(state.projectOrder).toEqual(["/workspace/project", "/workspace/other"]);
        expect(state.unreadThreadIds.has("thread-unread")).toBe(true);
    });

    it("normalizes current structured project assignments and saved workspaces", () => {
        const state = parseDesktopSidebarState(
            {
                "thread-project-assignments": {
                    "thread-current": {
                        projectKind: "local",
                        projectId: "/workspace/current",
                        path: "/workspace/current",
                        cwd: "/workspace/current"
                    }
                },
                "project-order": ["/workspace/ordered"],
                "electron-saved-workspace-roots": [
                    "/workspace/ordered",
                    "/workspace/current"
                ]
            },
            "/tmp/state.json",
            10
        );

        expect(state.threadProjectAssignments.get("thread-current")).toBe(
            "/workspace/current"
        );
        expect([...state.visibleProjectPaths]).toEqual([
            "/workspace/ordered",
            "/workspace/current"
        ]);
        expect(state.projectOrder).toEqual([
            "/workspace/ordered",
            "/workspace/current"
        ]);
    });

    it("uses the Desktop project id when a project task runs in a worktree", () => {
        const state = parseDesktopSidebarState(
            {
                "thread-project-assignments": {
                    "thread-worktree": {
                        projectKind: "local",
                        projectId: "/workspace/project",
                        cwd: "/var/tmp/worktrees/abc/project",
                        pendingCoreUpdate: false
                    }
                },
                "project-order": ["/workspace/project"]
            },
            "/tmp/state.json",
            10
        );

        expect(state.threadProjectAssignments.get("thread-worktree")).toBe(
            "/workspace/project"
        );
    });

    it("rejects a structured project assignment without a usable path", () => {
        expect(() =>
            parseDesktopSidebarState(
                {
                    "thread-project-assignments": {
                        "thread-current": {
                            projectKind: "local",
                            pendingCoreUpdate: false
                        }
                    }
                },
                "/tmp/state.json",
                10
            )
        ).toThrow();
    });

    it("rejects malformed selected metadata", () => {
        expect(() =>
            parseDesktopSidebarState(
                { "pinned-thread-ids": ["valid", 4] },
                "/tmp/state.json",
                10
            )
        ).toThrow();
    });
});

describe("DesktopSidebarStateReader", () => {
    it("returns an unavailable empty snapshot when the file is missing", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sidebar-state-"));
        temporaryDirectories.push(directory);

        const state = new DesktopSidebarStateReader(path.join(directory, "missing.json")).read();

        expect(state.available).toBe(false);
        expect(state.error).toBeNull();
        expect(state.projectOrder).toEqual([]);
    });
});

describe("resolveThreadSidebarMetadata", () => {
    it("groups only threads that match a Desktop-visible project", () => {
        const state = parseDesktopSidebarState(
            {
                "project-order": ["/workspace/visible"]
            },
            "/tmp/state.json",
            10
        );

        expect(resolveThreadSidebarMetadata(state, {
            id: "visible-thread",
            cwd: "/workspace/visible",
            path: "/rollout/visible.jsonl"
        })).toMatchObject({
            isProjectless: false,
            projectPath: "/workspace/visible",
            projectOrder: 0
        });

        expect(resolveThreadSidebarMetadata(state, {
            id: "historical-thread",
            cwd: "/workspace/historical",
            path: "/rollout/historical.jsonl"
        })).toMatchObject({
            isProjectless: true,
            projectPath: null,
            projectOrder: null
        });
    });

    it("gives Desktop projectless assignments precedence over matching paths", () => {
        const state = parseDesktopSidebarState(
            {
                "projectless-thread-ids": ["explicit-task"],
                "project-order": ["/workspace/visible"]
            },
            "/tmp/state.json",
            10
        );

        expect(resolveThreadSidebarMetadata(state, {
            id: "explicit-task",
            cwd: "/workspace/visible",
            path: "/rollout/task.jsonl"
        })).toMatchObject({
            isProjectless: true,
            projectPath: null,
            projectOrder: null
        });
    });

    it("classifies threads as Tasks when Desktop state is unavailable", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sidebar-state-"));
        temporaryDirectories.push(directory);
        const state = new DesktopSidebarStateReader(
            path.join(directory, "missing.json")
        ).read();

        expect(resolveThreadSidebarMetadata(state, {
            id: "fallback-task",
            cwd: "/workspace/historical",
            path: "/rollout/fallback.jsonl"
        })).toMatchObject({
            isProjectless: true,
            projectPath: null,
            projectOrder: null
        });
    });
});
