import type { CliBuildOutput } from './cli-contract';

let latestBuild: CliBuildOutput | undefined;
const listeners = new Set<(result: CliBuildOutput | undefined) => void>();

/** Stores the latest versioned compiler build observed by this extension host. */
export function setLatestBuild(result: CliBuildOutput): void {
    latestBuild = result;
    for (const listener of listeners) {
        listener(result);
    }
}

/** Returns the latest versioned compiler build observed by this extension host. */
export function getLatestBuild(): CliBuildOutput | undefined {
    return latestBuild;
}

/** Clears state when the workspace no longer proves ownership of the previous build. */
export function clearLatestBuild(): void {
    latestBuild = undefined;
    for (const listener of listeners) {
        listener(undefined);
    }
}

/** Subscribes to compiler build envelopes without coupling consumers to the checker. */
export function onLatestBuildChanged(listener: (result: CliBuildOutput | undefined) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
