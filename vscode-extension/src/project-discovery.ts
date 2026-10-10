import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export type JunexisProjectMode = 'project' | 'file' | 'none';

export interface JunexisProjectContext {
    mode: JunexisProjectMode;
    activeFile?: string;
    workspaceFolder?: string;
    projectRoot?: string;
    manifestPath?: string;
    reason?: string;
}

const PROJECT_MANIFEST = 'junexis.project.toml';

export function discoverJunexisProjectContext(document?: vscode.TextDocument): JunexisProjectContext {
    if (!document || document.isUntitled || document.uri.scheme !== 'file') {
        return {
            mode: 'none',
            reason: 'No saved Junexis file is active.'
        };
    }

    const activeFile = document.fileName;
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath;
    let startDirectory: string;
    try {
        startDirectory = fs.statSync(activeFile).isDirectory()
            ? activeFile
            : path.dirname(activeFile);
    } catch {
        return {
            mode: 'file',
            activeFile,
            workspaceFolder,
            reason: 'Active file path is not accessible on disk.'
        };
    }

    const manifestPath = findNearestProjectManifest(startDirectory, workspaceFolder);
    if (manifestPath) {
        return {
            mode: 'project',
            activeFile,
            workspaceFolder,
            projectRoot: path.dirname(manifestPath),
            manifestPath
        };
    }

    return {
        mode: 'file',
        activeFile,
        workspaceFolder,
        reason: `No ${PROJECT_MANIFEST} found from active file.`
    };
}

function findNearestProjectManifest(startDirectory: string, workspaceFolder?: string): string | undefined {
    let current = path.resolve(startDirectory);
    const workspaceRoot = workspaceFolder ? path.resolve(workspaceFolder) : undefined;

    while (true) {
        const candidate = path.join(current, PROJECT_MANIFEST);
        if (fs.existsSync(candidate)) {
            return candidate;
        }

        if (workspaceRoot && samePath(current, workspaceRoot)) {
            return undefined;
        }

        const parent = path.dirname(current);
        if (samePath(parent, current)) {
            return undefined;
        }

        if (workspaceRoot && !isInsideOrSame(parent, workspaceRoot)) {
            return undefined;
        }

        current = parent;
    }
}

function samePath(a: string, b: string): boolean {
    return path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase();
}

function isInsideOrSame(candidate: string, root: string): boolean {
    const relative = path.relative(root, candidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
