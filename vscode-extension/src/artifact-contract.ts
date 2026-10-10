import * as path from 'path';

export interface ArtifactItem {
    relativePath: string;
    fullPath: string;
    target: string;
    kind: string;
    ownership: string;
    sha256: string;
}

export interface ArtifactInventory {
    schemaVersion: string;
    buildId: string;
    manifestPath: string;
    items: ArtifactItem[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parses the same path-safe artifact inventory contract as Junexis Studio. */
export function parseArtifactInventory(json: string, manifestPath: string): ArtifactInventory {
    const value: unknown = JSON.parse(json);
    if (!isRecord(value)) {
        throw new Error('Artifact manifest must be a JSON object.');
    }
    if (typeof value.schemaVersion !== 'string' || !value.schemaVersion.startsWith('1.')) {
        throw new Error(
            `Unsupported artifact schema '${String(value.schemaVersion ?? 'missing')}'. Expected major version 1.`);
    }
    if (typeof value.buildId !== 'string' || !value.buildId.trim() || !Array.isArray(value.artifacts)) {
        throw new Error('Artifact manifest is missing buildId or artifacts.');
    }

    const fullManifestPath = path.resolve(manifestPath);
    const outputRoot = path.dirname(fullManifestPath);
    const items = value.artifacts.map((candidate, index): ArtifactItem => {
        if (!isRecord(candidate) ||
            typeof candidate.path !== 'string' ||
            !candidate.path.trim() ||
            typeof candidate.target !== 'string' ||
            typeof candidate.kind !== 'string' ||
            typeof candidate.ownership !== 'string' ||
            typeof candidate.sha256 !== 'string') {
            throw new Error(`Artifact #${index + 1} is incomplete.`);
        }
        if (path.isAbsolute(candidate.path)) {
            throw new Error(`Unsafe artifact path '${candidate.path}'.`);
        }

        const relativePath = candidate.path.split('/').join(path.sep);
        const fullPath = path.resolve(outputRoot, relativePath);
        const relativeToRoot = path.relative(outputRoot, fullPath);
        if (!relativeToRoot || relativeToRoot === '..' ||
            relativeToRoot.startsWith(`..${path.sep}`) ||
            path.isAbsolute(relativeToRoot)) {
            throw new Error(`Artifact escapes output root: '${candidate.path}'.`);
        }

        return {
            relativePath: candidate.path,
            fullPath,
            target: candidate.target,
            kind: candidate.kind,
            ownership: candidate.ownership,
            sha256: candidate.sha256,
        };
    });

    return {
        schemaVersion: value.schemaVersion,
        buildId: value.buildId,
        manifestPath: fullManifestPath,
        items,
    };
}
