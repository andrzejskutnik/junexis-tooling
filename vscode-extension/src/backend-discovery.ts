import * as child_process from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    checkLspCompatibility,
    currentRuntimeIdentifier,
    parseLspDistributionManifest,
    type LspCompatibility,
    type LspDistributionManifest,
} from './lsp-distribution';
import { resolveBundledCli } from './cli-distribution';
import { resolveBundledMentor } from './mentor-distribution';
import { installedLspDirectory } from './installation-paths';

export type BackendSource =
    | 'configured'
    | 'environment'
    | 'bundled'
    | 'workspace-build'
    | 'workspace-project'
    | 'published'
    | 'path'
    | 'missing';

export interface BackendResolution {
    source: BackendSource;
    label: string;
    command: string;
    args: string[];
    path?: string;
    candidates: string[];
    identity?: LspDistributionManifest;
    compatibility?: LspCompatibility;
}

const TARGET_FRAMEWORKS = ['net10.0', 'net9.0', 'net8.0'];
const CONFIGURATIONS = ['Release', 'Debug'];

function uniq(paths: string[]): string[] {
    return [...new Set(paths.map(candidate => path.normalize(candidate)))];
}

function existingFile(candidates: string[]): string | undefined {
    return candidates.find(candidate => fs.existsSync(candidate));
}

function executableName(projectName: string): string {
    return process.platform === 'win32' ? `${projectName}.exe` : projectName;
}

function workspaceRoots(): string[] {
    const roots = new Set<string>();

    for (const folder of vscode.workspace.workspaceFolders ?? []) {
        roots.add(folder.uri.fsPath);
        roots.add(path.dirname(folder.uri.fsPath));
    }

    return [...roots];
}

function localJunexisLangRoots(): string[] {
    const roots = new Set<string>();

    for (const base of workspaceRoots()) {
        let current = path.resolve(base);
        while (true) {
            roots.add(current);
            roots.add(path.join(current, 'junexis-lang'));

            const parent = path.dirname(current);
            if (parent === current) {
                break;
            }
            current = parent;
        }
    }

    return [...roots]
        .map(candidate => path.normalize(candidate))
        .filter(candidate => fs.existsSync(candidate));
}

function commandOnPath(command: string, probeArgs = ['--version']): boolean {
    try {
        child_process.execFileSync(command, probeArgs, { timeout: 3000, windowsHide: true });
        return true;
    } catch {
        return false;
    }
}

function localMentorRoots(): string[] {
    const roots = new Set<string>();

    for (const base of workspaceRoots()) {
        roots.add(path.join(base, 'junexis-mentor'));
        roots.add(base);
    }

    return [...roots]
        .map(candidate => path.normalize(candidate))
        .filter(candidate => fs.existsSync(candidate));
}

function mentorBuildCandidates(extension: '.exe' | '.dll'): string[] {
    const candidates: string[] = [];
    const projectName = 'JunexisLang.Mentor.CLI';

    for (const root of localMentorRoots()) {
        const projectDir = path.join(root, projectName);
        for (const configuration of CONFIGURATIONS) {
            for (const framework of TARGET_FRAMEWORKS) {
                candidates.push(path.join(projectDir, 'bin', configuration, framework, `${projectName}${extension}`));
                if (process.platform === 'win32') {
                    candidates.push(path.join(projectDir, 'bin', configuration, framework, 'win-x64', `${projectName}${extension}`));
                }
            }
        }
    }

    return uniq(candidates);
}

function mentorProjectCandidates(): string[] {
    return uniq(localMentorRoots().map(root =>
        path.join(root, 'JunexisLang.Mentor.CLI', 'JunexisLang.Mentor.CLI.csproj')));
}

function configuredBackend(
    configured: string,
    dllLabel: string,
    executableLabel: string,
    source: BackendSource = 'configured',
): BackendResolution | undefined {
    if (!configured || !fs.existsSync(configured)) {
        return undefined;
    }

    if (configured.toLowerCase().endsWith('.dll')) {
        return {
            source,
            label: dllLabel,
            command: 'dotnet',
            args: [configured],
            path: configured,
            candidates: [configured],
        };
    }

    return {
        source,
        label: executableLabel,
        command: configured,
        args: [],
        path: configured,
        candidates: [configured],
    };
}

function publishedLspCandidates(): string[] {
    const userProfile = process.env.USERPROFILE ?? os.homedir();
    const localAppData = process.env.LOCALAPPDATA;
    const exeName = executableName('JunexisLang.Compiler.LspHost');

    const candidates = [
        path.join(installedLspDirectory(), exeName),
        path.join(userProfile, 'junexis-lsp', exeName),
    ];

    if (localAppData) {
        candidates.push(path.join(localAppData, 'junexis-lsp', exeName));
    }

    return uniq(candidates);
}

function attachLspIdentity(resolution: BackendResolution): BackendResolution {
    if (!resolution.path) {
        return resolution;
    }

    const manifestPath = path.join(path.dirname(resolution.path), 'junexis-lsp.json');
    if (!fs.existsSync(manifestPath)) {
        return resolution;
    }

    try {
        const identity = parseLspDistributionManifest(
            fs.readFileSync(manifestPath, 'utf8'),
            currentRuntimeIdentifier(),
        );
        return {
            ...resolution,
            identity,
            compatibility: checkLspCompatibility(identity),
        };
    } catch (error) {
        return {
            ...resolution,
            compatibility: {
                compatible: false,
                message: `invalid distribution manifest: ${String(error)}`,
            },
        };
    }
}

function bundledLspBackend(extensionPath: string | undefined): BackendResolution | undefined {
    if (!extensionPath) {
        return undefined;
    }

    const runtimeIdentifier = currentRuntimeIdentifier();
    const distributionDir = path.join(extensionPath, 'runtime', 'lsp', runtimeIdentifier);
    const manifestPath = path.join(distributionDir, 'junexis-lsp.json');
    if (!fs.existsSync(manifestPath)) {
        return undefined;
    }

    try {
        const identity = parseLspDistributionManifest(
            fs.readFileSync(manifestPath, 'utf8'),
            runtimeIdentifier,
        );
        const compatibility = checkLspCompatibility(identity);
        const command = path.join(distributionDir, identity.entrypoint);
        if (!fs.existsSync(command)) {
            return undefined;
        }

        return {
            source: 'bundled',
            label: 'Bundled LSP host',
            command,
            args: [],
            path: command,
            candidates: [command, manifestPath],
            identity,
            compatibility,
        };
    } catch {
        return undefined;
    }
}

function workspaceBuildCandidates(projectName: 'JunexisLang.Compiler.LspHost' | 'JunexisLang.Compiler.CLI', extension: '.exe' | '.dll'): string[] {
    const candidates: string[] = [];

    for (const root of localJunexisLangRoots()) {
        const projectDir = path.join(root, 'compiler', projectName);
        for (const configuration of CONFIGURATIONS) {
            if (extension === '.exe') {
                const runtimeIdentifier = currentRuntimeIdentifier();
                candidates.push(path.join(
                    projectDir,
                    'bin',
                    configuration,
                    `publish-${runtimeIdentifier}-r2r`,
                    `${projectName}${extension}`,
                ));
            }

            for (const framework of TARGET_FRAMEWORKS) {
                candidates.push(path.join(projectDir, 'bin', configuration, framework, `${projectName}${extension}`));
                if (process.platform === 'win32') {
                    candidates.push(path.join(projectDir, 'bin', configuration, framework, 'win-x64', `${projectName}${extension}`));
                }
            }
        }
    }

    return uniq(candidates);
}

function workspaceProjectCandidates(projectName: 'JunexisLang.Compiler.LspHost' | 'JunexisLang.Compiler.CLI'): string[] {
    const candidates: string[] = [];

    for (const root of localJunexisLangRoots()) {
        candidates.push(path.join(root, 'compiler', projectName, `${projectName}.csproj`));
    }

    return uniq(candidates);
}

export function resolveCliBackend(extensionPath?: string): BackendResolution {
    const cfg = vscode.workspace.getConfiguration('junexis');
    const configured = cfg.get<string>('cliPath', '').trim();

    if (configured) {
        if (configured.endsWith('.dll') && fs.existsSync(configured)) {
            return {
                source: 'configured',
                label: 'Configured CLI DLL',
                command: 'dotnet',
                args: [configured],
                path: configured,
                candidates: [configured],
            };
        }

        if (fs.existsSync(configured)) {
            return {
                source: 'configured',
                label: 'Configured CLI executable',
                command: configured,
                args: [],
                path: configured,
                candidates: [configured],
            };
        }
    }

    if (extensionPath) {
        try {
            const bundled = resolveBundledCli(extensionPath);
            if (bundled) {
                return {
                    source: 'bundled',
                    label: `Bundled CLI ${bundled.identity.version}`,
                    command: bundled.command,
                    args: [],
                    path: bundled.command,
                    candidates: [bundled.command, bundled.manifestPath],
                };
            }
        } catch {
            // Invalid bundled distributions are ignored and reported by setup discovery.
        }
    }

    const builtDllCandidates = workspaceBuildCandidates('JunexisLang.Compiler.CLI', '.dll');
    const builtDll = existingFile(builtDllCandidates);
    if (builtDll) {
        return {
            source: 'workspace-build',
            label: 'Workspace CLI build',
            command: 'dotnet',
            args: [builtDll],
            path: builtDll,
            candidates: builtDllCandidates,
        };
    }

    const builtExeCandidates = workspaceBuildCandidates('JunexisLang.Compiler.CLI', '.exe');
    const builtExe = existingFile(builtExeCandidates);
    if (builtExe) {
        return {
            source: 'workspace-build',
            label: 'Workspace CLI executable',
            command: builtExe,
            args: [],
            path: builtExe,
            candidates: builtExeCandidates,
        };
    }

    const projectCandidates = workspaceProjectCandidates('JunexisLang.Compiler.CLI');
    const project = existingFile(projectCandidates);
    if (project) {
        return {
            source: 'workspace-project',
            label: 'Workspace CLI project',
            command: 'dotnet',
            args: ['run', '--project', project, '--'],
            path: project,
            candidates: projectCandidates,
        };
    }

    const pathCandidates = process.platform === 'win32' ? ['junexis.exe', 'junexis'] : ['junexis'];
    const fromPath = pathCandidates.find(command => commandOnPath(command));
    if (fromPath) {
        return {
            source: 'path',
            label: 'CLI from PATH',
            command: fromPath,
            args: [],
            path: fromPath,
            candidates: pathCandidates,
        };
    }

    return {
        source: 'missing',
        label: 'CLI not found',
        command: '',
        args: [],
        candidates: uniq([
            configured,
            ...builtDllCandidates,
            ...builtExeCandidates,
            ...projectCandidates,
            ...pathCandidates,
        ].filter(Boolean)),
    };
}

export function resolveLspBackend(extensionPath?: string): BackendResolution {
    const cfg = vscode.workspace.getConfiguration('junexis');
    const configured = cfg.get<string>('lspPath', '').trim();

    if (configured && fs.existsSync(configured)) {
        return attachLspIdentity({
            source: 'configured',
            label: 'Configured LSP host',
            command: configured,
            args: [],
            path: configured,
            candidates: [configured],
        });
    }

    const bundled = bundledLspBackend(extensionPath);
    if (bundled) {
        return bundled;
    }

    const builtCandidates = workspaceBuildCandidates('JunexisLang.Compiler.LspHost', '.exe');
    const built = existingFile(builtCandidates);
    if (built) {
        return attachLspIdentity({
            source: 'workspace-build',
            label: 'Workspace LSP build',
            command: built,
            args: [],
            path: built,
            candidates: builtCandidates,
        });
    }

    const projectCandidates = workspaceProjectCandidates('JunexisLang.Compiler.LspHost');
    const project = existingFile(projectCandidates);
    if (project) {
        return {
            source: 'workspace-project',
            label: 'Workspace LSP project',
            command: 'dotnet',
            args: ['run', '--project', project, '--'],
            path: project,
            candidates: projectCandidates,
        };
    }

    const publishedCandidates = publishedLspCandidates();
    const published = existingFile(publishedCandidates);
    if (published) {
        return attachLspIdentity({
            source: 'published',
            label: 'Published LSP host',
            command: published,
            args: [],
            path: published,
            candidates: publishedCandidates,
        });
    }

    return {
        source: 'missing',
        label: 'LSP host not found',
        command: '',
        args: [],
        candidates: uniq([
            configured,
            ...(extensionPath
                ? [path.join(
                    extensionPath,
                    'runtime',
                    'lsp',
                    currentRuntimeIdentifier(),
                    executableName('JunexisLang.Compiler.LspHost'),
                )]
                : []),
            ...builtCandidates,
            ...projectCandidates,
            ...publishedCandidates,
        ].filter(Boolean)),
    };
}

export function resolveMentorBackend(extensionPath?: string): BackendResolution {
    const cfg = vscode.workspace.getConfiguration('junexis');
    const configured = cfg.get<string>('mentorPath', '').trim();
    const configuredResolution = configuredBackend(
        configured,
        'Configured Mentor CLI DLL',
        'Configured Mentor CLI executable');
    if (configuredResolution) {
        return configuredResolution;
    }

    const fromEnvironment = (process.env.JUNEXIS_MENTOR_CLI ?? '').trim();
    const environmentResolution = configuredBackend(
        fromEnvironment,
        'Mentor CLI DLL from JUNEXIS_MENTOR_CLI',
        'Mentor CLI executable from JUNEXIS_MENTOR_CLI',
        'environment');
    if (environmentResolution) {
        return environmentResolution;
    }

    if (extensionPath) {
        try {
            const bundled = resolveBundledMentor(extensionPath);
            if (bundled) {
                return {
                    source: 'bundled',
                    label: `Bundled Mentor ${bundled.identity.version}`,
                    command: bundled.command,
                    args: [],
                    path: bundled.command,
                    candidates: [bundled.command, bundled.manifestPath],
                };
            }
        } catch {
            // Invalid bundled distributions are ignored and reported by setup discovery.
        }
    }

    const builtDllCandidates = mentorBuildCandidates('.dll');
    const builtDll = existingFile(builtDllCandidates);
    if (builtDll) {
        return {
            source: 'workspace-build',
            label: 'Workspace Mentor CLI build',
            command: 'dotnet',
            args: [builtDll],
            path: builtDll,
            candidates: builtDllCandidates,
        };
    }

    const builtExeCandidates = mentorBuildCandidates('.exe');
    const builtExe = existingFile(builtExeCandidates);
    if (builtExe) {
        return {
            source: 'workspace-build',
            label: 'Workspace Mentor CLI executable',
            command: builtExe,
            args: [],
            path: builtExe,
            candidates: builtExeCandidates,
        };
    }

    const projectCandidates = mentorProjectCandidates();
    const project = existingFile(projectCandidates);
    if (project) {
        return {
            source: 'workspace-project',
            label: 'Workspace Mentor CLI project',
            command: 'dotnet',
            args: ['run', '--project', project, '--'],
            path: project,
            candidates: projectCandidates,
        };
    }

    const pathCandidates = process.platform === 'win32'
        ? ['junexis-mentor.exe', 'junexis-mentor']
        : ['junexis-mentor'];
    const fromPath = pathCandidates.find(command => commandOnPath(command, ['--help']));
    if (fromPath) {
        return {
            source: 'path',
            label: 'Mentor CLI from PATH',
            command: fromPath,
            args: [],
            path: fromPath,
            candidates: pathCandidates,
        };
    }

    return {
        source: 'missing',
        label: 'Mentor CLI not found',
        command: '',
        args: [],
        candidates: uniq([
            configured,
            fromEnvironment,
            ...(extensionPath
                ? [path.join(
                    extensionPath,
                    'runtime',
                    'mentor',
                    currentRuntimeIdentifier(),
                    executableName('JunexisLang.Mentor.CLI'),
                )]
                : []),
            ...builtDllCandidates,
            ...builtExeCandidates,
            ...projectCandidates,
            ...pathCandidates,
        ].filter(Boolean)),
    };
}
