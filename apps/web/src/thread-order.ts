export type ThreadActivity = {
    id: string;
    updatedAt?: number | null;
    createdAt?: number | null;
};

function sortableTimestamp(value: number | null | undefined): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function compareThreadsByRecentActivity(
    left: ThreadActivity,
    right: ThreadActivity
): number {
    const updatedDifference = sortableTimestamp(right.updatedAt) -
        sortableTimestamp(left.updatedAt);
    if (updatedDifference !== 0) {
        return updatedDifference;
    }

    const createdDifference = sortableTimestamp(right.createdAt) -
        sortableTimestamp(left.createdAt);
    if (createdDifference !== 0) {
        return createdDifference;
    }

    return left.id.localeCompare(right.id);
}
