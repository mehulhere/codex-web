import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

const StringArraySchema = z.array(z.string().trim().min(1));
const NonEmptyStringSchema = z.string().trim().min(1);
const StructuredProjectAssignmentSchema = z
    .object({
        projectKind: z.literal("local"),
        projectId: NonEmptyStringSchema.optional(),
        path: NonEmptyStringSchema.optional(),
        cwd: NonEmptyStringSchema.optional(),
        pendingCoreUpdate: z.boolean().optional()
    })
    .strict()
    .refine((value) => Boolean(value.path ?? value.cwd ?? value.projectId), {
        message: "Project assignment requires a path"
    });
const ProjectAssignmentSchema = z.union([
    NonEmptyStringSchema,
    StructuredProjectAssignmentSchema
        .transform((value) => value.projectId ?? value.path ?? value.cwd)
        .pipe(NonEmptyStringSchema)
]);
const LocalProjectSchema = z.object({
    id: NonEmptyStringSchema,
    name: NonEmptyStringSchema,
    rootPaths: StringArraySchema.min(1),
    createdAt: z.number(),
    updatedAt: z.number()
}).strict();
const ProjectAssignmentMapSchema = z.record(z.string(), ProjectAssignmentSchema);
const ThreadMetadataEntrySchema = z
    .object({
        projectPath: z.string().trim().min(1).nullable().optional(),
        workspaceRoot: z.string().trim().min(1).nullable().optional(),
        isProjectless: z.boolean().optional()
    })
    .strict();
const ThreadMetadataMapSchema = z.record(z.string(), ThreadMetadataEntrySchema);
const UnreadByHostSchema = z.record(z.string(), StringArraySchema);
const ElectronPersistedStateSchema = z
    .object({
        "unread-thread-ids-by-host-v1": UnreadByHostSchema.optional()
    })
    .strict();

type JsonValue =
    | string
    | number
    | boolean
    | null
    | JsonValue[]
    | { [key: string]: JsonValue };

const SelectedGlobalStateSchema = z
    .object({
        "pinned-thread-ids": StringArraySchema.optional(),
        "pinned-project-ids": StringArraySchema.optional(),
        "projectless-thread-ids": StringArraySchema.optional(),
        "thread-project-assignments": ProjectAssignmentMapSchema.optional(),
        "sidebar-thread-metadata": ThreadMetadataMapSchema.optional(),
        "project-order": StringArraySchema.optional(),
        "local-projects": z.record(z.string(), LocalProjectSchema).optional(),
        "electron-saved-workspace-roots": StringArraySchema.optional(),
        "electron-persisted-atom-state": ElectronPersistedStateSchema.optional()
    })
    .strict();

export interface DesktopSidebarState {
    available: boolean;
    filePath: string;
    modifiedAtMs: number | null;
    pinnedThreadIds: ReadonlySet<string>;
    pinnedProjectIds: ReadonlySet<string>;
    projectlessThreadIds: ReadonlySet<string>;
    threadProjectAssignments: ReadonlyMap<string, string>;
    sidebarThreadMetadata: ReadonlyMap<
        string,
        { projectPath: string | null; isProjectless: boolean | null }
    >;
    visibleProjectPaths: ReadonlySet<string>;
    projectOrder: readonly string[];
    projectPathsById: ReadonlyMap<string, string>;
    projectNamesByPath: ReadonlyMap<string, string>;
    unreadThreadIds: ReadonlySet<string>;
    error: string | null;
}

export interface ThreadSidebarMetadata {
    isPinned: boolean;
    isProjectPinned: boolean;
    isProjectless: boolean;
    projectPath: string | null;
    projectName: string | null;
    projectOrder: number | null;
    hasUnreadTurn: boolean;
}

interface ThreadSidebarInput {
    id: string;
    cwd?: string | null | undefined;
    path?: string | null | undefined;
}

function emptyState(filePath: string, error: string | null): DesktopSidebarState {
    return {
        available: false,
        filePath,
        modifiedAtMs: null,
        pinnedThreadIds: new Set<string>(),
        pinnedProjectIds: new Set<string>(),
        projectlessThreadIds: new Set<string>(),
        threadProjectAssignments: new Map<string, string>(),
        sidebarThreadMetadata: new Map(),
        visibleProjectPaths: new Set<string>(),
        projectOrder: [],
        projectPathsById: new Map(),
        projectNamesByPath: new Map(),
        unreadThreadIds: new Set<string>(),
        error
    };
}

export function resolveDesktopGlobalStatePath(codexHome = process.env["CODEX_HOME"]): string {
    const home = codexHome?.trim() || path.join(os.homedir(), ".codex");
    return path.join(home, ".codex-global-state.json");
}

export function parseDesktopSidebarState(
    value: { [key: string]: JsonValue },
    filePath: string,
    modifiedAtMs: number
): DesktopSidebarState {
    const selectedValue: { [key: string]: JsonValue } = {};

    for (const key of [
        "pinned-thread-ids",
        "pinned-project-ids",
        "projectless-thread-ids",
        "thread-project-assignments",
        "sidebar-thread-metadata",
        "project-order",
        "local-projects",
        "electron-saved-workspace-roots",
        "electron-persisted-atom-state"
    ] as const) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
            const entry = value[key];
            if (entry !== undefined) {
                if (key === "electron-persisted-atom-state" && isJsonObject(entry)) {
                    const unread = entry["unread-thread-ids-by-host-v1"];
                    selectedValue[key] = unread === undefined
                        ? {}
                        : { "unread-thread-ids-by-host-v1": unread };
                } else {
                    selectedValue[key] = entry;
                }
            }
        }
    }

    const parsed = SelectedGlobalStateSchema.parse(selectedValue);
    const projectPathsById = new Map<string, string>();
    const projectNamesByPath = new Map<string, string>();
    for (const [id, project] of Object.entries(parsed["local-projects"] ?? {})) {
        const root = project.rootPaths[0];
        if (!root) throw new Error(`Project ${id} has no root path`);
        projectPathsById.set(id, root);
        projectPathsById.set(project.id, root);
        for (const projectPath of project.rootPaths) projectPathsById.set(projectPath, root);
        projectNamesByPath.set(root, project.name);
    }
    const resolveProjectPath = (id: string): string => projectPathsById.get(id) ?? id;
    const metadata = new Map<string, { projectPath: string | null; isProjectless: boolean | null }>();
    for (const [threadId, entry] of Object.entries(parsed["sidebar-thread-metadata"] ?? {})) {
        const projectPath = entry.projectPath ?? entry.workspaceRoot ?? null;
        metadata.set(threadId, {
            projectPath: projectPath === null ? null : resolveProjectPath(projectPath),
            isProjectless: entry.isProjectless ?? null
        });
    }

    const unread = new Set<string>();
    for (const ids of Object.values(
        parsed["electron-persisted-atom-state"]?.["unread-thread-ids-by-host-v1"] ?? {}
    )) {
        for (const id of ids) unread.add(id);
    }

    const projectOrder = [...new Set((parsed["project-order"] ?? []).map(resolveProjectPath))];
    for (const savedRoot of parsed["electron-saved-workspace-roots"] ?? []) {
        const projectPath = resolveProjectPath(savedRoot);
        if (!projectOrder.includes(projectPath)) {
            projectOrder.push(projectPath);
        }
    }

    const assignments = new Map<string, string>();
    for (const [threadId, assignment] of Object.entries(
        parsed["thread-project-assignments"] ?? {}
    )) {
        const projectPath = resolveProjectPath(assignment);
        if (!projectPath) {
            throw new Error(`Project assignment ${threadId} has no path`);
        }
        assignments.set(threadId, projectPath);
    }

    return {
        available: true,
        filePath,
        modifiedAtMs,
        pinnedThreadIds: new Set(parsed["pinned-thread-ids"] ?? []),
        pinnedProjectIds: new Set((parsed["pinned-project-ids"] ?? []).map(resolveProjectPath)),
        projectlessThreadIds: new Set(parsed["projectless-thread-ids"] ?? []),
        threadProjectAssignments: assignments,
        sidebarThreadMetadata: metadata,
        visibleProjectPaths: new Set(projectOrder),
        projectOrder,
        projectPathsById,
        projectNamesByPath,
        unreadThreadIds: unread,
        error: null
    };
}

function isJsonObject(value: JsonValue): value is { [key: string]: JsonValue } {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeOptionalPath(value: string | null | undefined): string | null {
    if (typeof value !== "string") {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

export function resolveThreadSidebarMetadata(
    state: DesktopSidebarState,
    thread: ThreadSidebarInput
): ThreadSidebarMetadata {
    const metadata = state.sidebarThreadMetadata.get(thread.id);
    const candidates = [
        state.threadProjectAssignments.get(thread.id),
        metadata?.projectPath,
        thread.cwd
    ];
    const projectPath = candidates
        .map(normalizeOptionalPath)
        .map((candidate) => candidate === null ? null : state.projectPathsById.get(candidate) ?? candidate)
        .find((candidate) => candidate !== null && state.visibleProjectPaths.has(candidate)) ?? null;
    const isProjectless =
        state.projectlessThreadIds.has(thread.id) ||
        metadata?.isProjectless === true ||
        projectPath === null;
    const resolvedProjectPath = isProjectless ? null : projectPath;
    const projectOrder = resolvedProjectPath === null
        ? null
        : state.projectOrder.indexOf(resolvedProjectPath);

    return {
        isPinned: state.pinnedThreadIds.has(thread.id),
        isProjectPinned:
            resolvedProjectPath !== null && state.pinnedProjectIds.has(resolvedProjectPath),
        isProjectless,
        projectPath: resolvedProjectPath,
        projectName: resolvedProjectPath === null ? null : state.projectNamesByPath.get(resolvedProjectPath) ?? null,
        projectOrder: projectOrder !== null && projectOrder >= 0 ? projectOrder : null,
        hasUnreadTurn: state.unreadThreadIds.has(thread.id)
    };
}

export class DesktopSidebarStateReader {
    private cached: DesktopSidebarState | null = null;

    public constructor(private readonly filePath = resolveDesktopGlobalStatePath()) {}

    public read(): DesktopSidebarState {
        if (!fs.existsSync(this.filePath)) {
            this.cached = emptyState(this.filePath, null);
            return this.cached;
        }

        let stat: fs.Stats;
        try {
            stat = fs.statSync(this.filePath);
        } catch (error) {
            this.cached = emptyState(this.filePath, String(error));
            return this.cached;
        }

        if (
            this.cached &&
            this.cached.available &&
            this.cached.modifiedAtMs === stat.mtimeMs
        ) {
            return this.cached;
        }

        try {
            const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as {
                [key: string]: JsonValue;
            };
            this.cached = parseDesktopSidebarState(parsed, this.filePath, stat.mtimeMs);
        } catch (error) {
            this.cached = emptyState(this.filePath, String(error));
        }
        return this.cached;
    }
}
