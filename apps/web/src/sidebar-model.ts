import { compareThreadsByRecentActivity, type ThreadActivity } from "./thread-order.js";

export interface SidebarMetadata {
    isPinned: boolean;
    isProjectPinned: boolean;
    isProjectless: boolean;
    projectPath: string | null;
    projectName?: string | null;
    projectOrder: number | null;
    hasUnreadTurn: boolean;
}

export interface SidebarThread extends ThreadActivity {
    sidebar: SidebarMetadata;
}

export interface SidebarProjectGroup<Thread extends SidebarThread> {
    key: string;
    label: string;
    projectPath: string;
    projectOrder: number | null;
    latestUpdatedAt: number;
    threads: Thread[];
}

export interface SidebarModel<Thread extends SidebarThread> {
    pinnedThreads: Thread[];
    pinnedProjects: Array<SidebarProjectGroup<Thread>>;
    projects: Array<SidebarProjectGroup<Thread>>;
    tasks: Thread[];
}

function basenameFromPath(value: string): string {
    const normalized = value.replace(/[\\/]+$/u, "");
    return normalized.split(/[\\/]/u).filter(Boolean).at(-1) ?? value;
}

function sortableTimestamp(value: number | null | undefined): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function compareGroups<Thread extends SidebarThread>(
    left: SidebarProjectGroup<Thread>,
    right: SidebarProjectGroup<Thread>
): number {
    const leftOrder = left.projectOrder ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = right.projectOrder ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
    }
    if (left.latestUpdatedAt !== right.latestUpdatedAt) {
        return right.latestUpdatedAt - left.latestUpdatedAt;
    }
    return left.projectPath.localeCompare(right.projectPath);
}

export function buildSidebarModel<Thread extends SidebarThread>(
    threads: readonly Thread[]
): SidebarModel<Thread> {
    const pinnedThreads: Thread[] = [];
    const tasks: Thread[] = [];
    const groups = new Map<
        string,
        SidebarProjectGroup<Thread> & { isProjectPinned: boolean }
    >();

    for (const thread of threads) {
        const projectPath = thread.sidebar.projectPath?.trim() || null;
        if (thread.sidebar.isProjectless || !projectPath) {
            if (thread.sidebar.isPinned) pinnedThreads.push(thread);
            else tasks.push(thread);
            continue;
        }
        if (thread.sidebar.isPinned && !thread.sidebar.isProjectPinned) {
            pinnedThreads.push(thread);
            continue;
        }

        const current = groups.get(projectPath);
        const updatedAt = sortableTimestamp(thread.updatedAt);
        if (current) {
            current.threads.push(thread);
            current.latestUpdatedAt = Math.max(current.latestUpdatedAt, updatedAt);
            current.isProjectPinned ||= thread.sidebar.isProjectPinned;
            if (current.projectOrder === null && thread.sidebar.projectOrder !== null) {
                current.projectOrder = thread.sidebar.projectOrder;
            }
        } else {
            groups.set(projectPath, {
                key: `project:${projectPath}`,
                label: thread.sidebar.projectName ?? basenameFromPath(projectPath),
                projectPath,
                projectOrder: thread.sidebar.projectOrder,
                latestUpdatedAt: updatedAt,
                threads: [thread],
                isProjectPinned: thread.sidebar.isProjectPinned
            });
        }
    }

    const pinnedProjects: Array<SidebarProjectGroup<Thread>> = [];
    const projects: Array<SidebarProjectGroup<Thread>> = [];
    for (const group of groups.values()) {
        const normalized = {
            key: group.key,
            label: group.label,
            projectPath: group.projectPath,
            projectOrder: group.projectOrder,
            latestUpdatedAt: group.latestUpdatedAt,
            threads: [...group.threads].sort(compareThreadsByRecentActivity)
        };
        if (group.isProjectPinned) pinnedProjects.push(normalized);
        else projects.push(normalized);
    }

    return {
        pinnedThreads: pinnedThreads.sort(compareThreadsByRecentActivity),
        pinnedProjects: pinnedProjects.sort(compareGroups),
        projects: projects.sort(compareGroups),
        tasks: tasks.sort(compareThreadsByRecentActivity)
    };
}
