import * as fs from 'fs/promises';
import * as path from 'path';
import {
    latestBuildReceiptPath,
    loadLatestBuildReceipt,
    type LatestBuildReceipt,
} from './latest-build-contract';

export interface LatestBuildContext {
    mode: 'project' | 'file' | 'none';
    projectRoot?: string;
    activeFile?: string;
}

export interface LatestBuildRestoreResult {
    receipt?: LatestBuildReceipt;
    errors: string[];
}

/** Avoids choosing an arbitrary project when a multi-project workspace has no active Junexis document. */
export function projectRootsForAutomaticRestore(
    context: LatestBuildContext,
    discoveredProjectRoots: readonly string[],
): string[] {
    const unique = [...new Map(discoveredProjectRoots.map(root => {
        const resolved = path.resolve(root);
        const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
        return [key, resolved];
    })).values()].sort((left, right) => left.localeCompare(right));

    if (context.mode !== 'none') {
        return unique;
    }
    return unique.length === 1 ? unique : [];
}

/** Builds an ordered, deterministic candidate list; no generated-output directory is scanned. */
export function latestBuildCandidates(
    context: LatestBuildContext,
    projectRoots: readonly string[],
): string[] {
    const candidates: string[] = [];
    if (context.mode === 'project' && context.projectRoot && context.activeFile) {
        return [latestBuildReceiptPath('project', context.projectRoot, context.activeFile)];
    } else if (context.mode === 'file' && context.activeFile) {
        const root = path.dirname(context.activeFile);
        return [latestBuildReceiptPath('file', root, context.activeFile)];
    }

    for (const projectRoot of [...projectRoots].sort((left, right) => left.localeCompare(right))) {
        candidates.push(latestBuildReceiptPath(
            'project',
            projectRoot,
            path.join(projectRoot, 'placeholder.jnx')));
    }

    const seen = new Set<string>();
    return candidates.filter(candidate => {
        const key = process.platform === 'win32' ? candidate.toLowerCase() : candidate;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

/** Restores the first valid latest build and reports corrupt receipts without guessing alternatives. */
export async function restoreLatestBuild(
    context: LatestBuildContext,
    projectRoots: readonly string[],
): Promise<LatestBuildRestoreResult> {
    const errors: string[] = [];
    for (const candidate of latestBuildCandidates(context, projectRoots)) {
        try {
            await fs.access(candidate);
        } catch {
            continue;
        }
        try {
            return {
                receipt: await loadLatestBuildReceipt(candidate),
                errors,
            };
        } catch (error) {
            errors.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return { errors };
}
