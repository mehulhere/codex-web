type DiscoverOwner = (threadId: string) => Promise<string>;

function normalizeOwnerClientId(ownerClientId: string): string {
    const normalized = ownerClientId.trim();
    if (!normalized) {
        throw new Error("Desktop returned an empty owner client id");
    }
    return normalized;
}

export class OwnerDiscoveryCoordinator {
    private readonly owners: Map<string, string>;

    private readonly pending = new Map<string, Promise<string>>();

    public constructor(
        private readonly discoverOwner: DiscoverOwner,
        owners: Map<string, string> = new Map<string, string>()
    ) {
        this.owners = owners;
    }

    public get(threadId: string): string | null {
        return this.owners.get(threadId) ?? null;
    }

    public remember(threadId: string, ownerClientId: string): void {
        this.owners.set(threadId, normalizeOwnerClientId(ownerClientId));
    }

    public invalidate(threadId: string, ownerClientId?: string): void {
        const current = this.owners.get(threadId);
        if (!current) {
            return;
        }
        if (!ownerClientId || current === ownerClientId.trim()) {
            this.owners.delete(threadId);
        }
    }

    public discover(threadId: string): Promise<string> {
        const cached = this.get(threadId);
        if (cached) {
            return Promise.resolve(cached);
        }

        const pending = this.pending.get(threadId);
        if (pending) {
            return pending;
        }

        const discovery = this.discoverOwner(threadId)
            .then((ownerClientId) => {
                const normalizedOwnerClientId = normalizeOwnerClientId(ownerClientId);
                this.remember(threadId, normalizedOwnerClientId);
                return normalizedOwnerClientId;
            })
            .finally(() => {
                this.pending.delete(threadId);
            });
        this.pending.set(threadId, discovery);
        return discovery;
    }

    public clear(): void {
        this.owners.clear();
        this.pending.clear();
    }
}
