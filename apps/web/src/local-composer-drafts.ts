const LEGACY_COMPOSER_DRAFT_PREFIX = "farfield:composer-draft:";

export function clearPersistedComposerDrafts(storage: Storage): void {
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key?.startsWith(LEGACY_COMPOSER_DRAFT_PREFIX)) {
            keys.push(key);
        }
    }
    for (const key of keys) {
        storage.removeItem(key);
    }
}
