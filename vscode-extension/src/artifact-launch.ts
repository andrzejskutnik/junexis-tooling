import * as path from 'path';
import type { ArtifactItem } from './artifact-contract';

export type ArtifactTargetProfile = 'go' | 'typescript' | 'platformio';

export interface ArtifactProcessPlan {
    command: string;
    args: string[];
    cwd: string;
}

export interface ArtifactLaunchPlan {
    target: string;
    profile: ArtifactTargetProfile;
    root: string;
    build: ArtifactProcessPlan;
    run: ArtifactProcessPlan;
    debug?: Record<string, unknown>;
    runMutatesDevice?: boolean;
}

function findItem(items: ArtifactItem[], relativeSuffix: string): ArtifactItem | undefined {
    const normalizedSuffix = relativeSuffix.split('\\').join('/').toLowerCase();
    return items.find(item =>
        item.relativePath.split('\\').join('/').toLowerCase() === normalizedSuffix);
}

/** Resolves target operations from compiler-owned artifact paths, never from the workspace CWD. */
export function createArtifactLaunchPlan(
    target: string,
    items: ArtifactItem[],
): ArtifactLaunchPlan {
    const normalizedTarget = target.toLowerCase();
    if (normalizedTarget === 'server') {
        const entry = findItem(items, 'server/main.go');
        if (!entry) {
            throw new Error("Server target has no 'server/main.go' artifact.");
        }
        const root = path.dirname(entry.fullPath);
        return {
            target,
            profile: 'go',
            root,
            build: { command: 'go', args: ['build', '-mod=mod', './...'], cwd: root },
            run: { command: 'go', args: ['run', '-mod=mod', '.'], cwd: root },
            debug: {
                type: 'go',
                name: 'Junexis Server (Go)',
                request: 'launch',
                mode: 'debug',
                program: root,
                cwd: root,
                buildFlags: '-mod=mod',
            },
        };
    }

    if (normalizedTarget === 'report') {
        const entry = findItem(items, 'report/index.ts');
        if (!entry) {
            throw new Error("Report target has no 'report/index.ts' artifact.");
        }
        const root = path.dirname(entry.fullPath);
        return {
            target,
            profile: 'typescript',
            root,
            build: { command: 'npm', args: ['run', 'build'], cwd: root },
            run: {
                command: 'node',
                args: ['--experimental-strip-types', entry.fullPath],
                cwd: root,
            },
            debug: {
                type: 'pwa-node',
                name: 'Junexis Report (TypeScript)',
                request: 'launch',
                runtimeExecutable: 'node',
                runtimeArgs: ['--experimental-strip-types'],
                program: entry.fullPath,
                cwd: root,
                skipFiles: ['<node_internals>/**'],
            },
        };
    }

    if (normalizedTarget === 'embedded') {
        const manifest = findItem(items, 'embedded/platformio.ini');
        if (!manifest) {
            throw new Error("Embedded target has no 'embedded/platformio.ini' artifact.");
        }
        const root = path.dirname(manifest.fullPath);
        return {
            target,
            profile: 'platformio',
            root,
            build: { command: 'pio', args: ['run', '--project-dir', root], cwd: root },
            run: {
                command: 'pio',
                args: ['run', '--project-dir', root, '--target', 'upload'],
                cwd: root,
            },
            runMutatesDevice: true,
        };
    }

    throw new Error(`Target '${target}' has no Junexis launch profile.`);
}
