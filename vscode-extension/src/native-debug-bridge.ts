import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { parseArtifactInventory } from './artifact-contract';
import {
    mapGeneratedLocation,
    mapJunexisBreakpoints,
    parseDebugSourceMap,
    type JunexisDebugSourceMap,
} from './source-map-contract';
import { getLatestBuild } from './tooling-state';

interface PreparedDebug {
    target: string;
    sourceMapPath: string;
    sourceMap: JunexisDebugSourceMap;
}

export type NativeDebugBridgeState = 'idle' | 'prepared' | 'running' | 'stopped' | 'error';

export interface NativeDebugSnapshot {
    state: NativeDebugBridgeState;
    message: string;
    buildId?: string;
    target?: string;
    sourceMapPath?: string;
    mappingCount: number;
    sourceBreakpointCount: number;
    runtimeBreakpointCount: number;
    sessionName?: string;
    lastRuntimeLocation?: string;
    lastJunexisLocation?: string;
    lastJunexisPath?: string;
    lastJunexisLine?: number;
    lastJunexisColumn?: number;
    lastSymbolId?: string;
}

/** Bridges .jnx source breakpoints and generated-code DAP sessions through compiler source maps. */
export class NativeDebugBridge implements vscode.Disposable {
    private readonly output = vscode.window.createOutputChannel('Junexis Native Debug');
    private readonly snapshotChanged = new vscode.EventEmitter<NativeDebugSnapshot>();
    private readonly disposables: vscode.Disposable[];
    private mirrors: vscode.SourceBreakpoint[] = [];
    private prepared?: PreparedDebug;
    private activeSessionId?: string;
    private syncing = false;
    private lastReveal = '';
    private snapshot: NativeDebugSnapshot = {
        state: 'idle',
        message: 'Build a Junexis target and start native debug.',
        mappingCount: 0,
        sourceBreakpointCount: 0,
        runtimeBreakpointCount: 0,
    };

    readonly onDidChangeSnapshot = this.snapshotChanged.event;

    constructor() {
        this.disposables = [
            this.output,
            this.snapshotChanged,
            vscode.debug.onDidChangeBreakpoints(event => {
                const junexisChanged = [...event.added, ...event.removed, ...event.changed]
                    .some(isJunexisSourceBreakpoint);
                if (!this.syncing && this.prepared && junexisChanged) {
                    void this.syncBreakpoints();
                }
            }),
            vscode.debug.onDidStartDebugSession(session => {
                const prepared = this.prepared;
                if (prepared &&
                    session.configuration.junexisSourceMapPath === prepared.sourceMapPath) {
                    this.activeSessionId = session.id;
                    this.updateSnapshot({
                        state: 'running',
                        message: `Native ${prepared.target} debug session is running.`,
                        sessionName: session.name,
                    });
                }
            }),
            vscode.debug.onDidTerminateDebugSession(session => {
                if (session.id === this.activeSessionId) {
                    this.activeSessionId = undefined;
                    this.prepared = undefined;
                    void this.clearMirrors();
                    this.updateSnapshot({
                        state: 'stopped',
                        message: `Native debug session '${session.name}' stopped.`,
                        sessionName: session.name,
                        runtimeBreakpointCount: 0,
                    });
                }
            }),
            vscode.debug.onDidChangeActiveStackItem(item => {
                void this.revealMappedStackFrame(item);
            }),
        ];
    }

    async prepare(
        target: string,
        configuration: vscode.DebugConfiguration,
    ): Promise<vscode.DebugConfiguration> {
        try {
            const prepared = await loadActiveSourceMap(target);
            this.prepared = prepared;
            this.updateSnapshot({
                state: 'prepared',
                message: `Source-map loaded for target '${target}'.`,
                buildId: getLatestBuild()?.buildId ?? undefined,
                target,
                sourceMapPath: prepared.sourceMapPath,
                mappingCount: prepared.sourceMap.mappings.filter(mapping =>
                    mapping.generated.target.toLowerCase() === target.toLowerCase()).length,
                sessionName: undefined,
                lastRuntimeLocation: undefined,
                lastJunexisLocation: undefined,
                lastJunexisPath: undefined,
                lastJunexisLine: undefined,
                lastJunexisColumn: undefined,
                lastSymbolId: undefined,
            });
            await this.syncBreakpoints();
            return {
                ...configuration,
                junexisTarget: target,
                junexisBuildId: getLatestBuild()?.buildId,
                junexisSourceMapPath: prepared.sourceMapPath,
            };
        } catch (error) {
            this.updateSnapshot({
                state: 'error',
                message: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    async cancelPrepared(): Promise<void> {
        this.prepared = undefined;
        this.activeSessionId = undefined;
        await this.clearMirrors();
        this.updateSnapshot({
            state: 'idle',
            message: 'Native debug preparation was cancelled.',
            buildId: undefined,
            target: undefined,
            sourceMapPath: undefined,
            mappingCount: 0,
            sourceBreakpointCount: 0,
            runtimeBreakpointCount: 0,
            sessionName: undefined,
            lastRuntimeLocation: undefined,
            lastJunexisLocation: undefined,
            lastJunexisPath: undefined,
            lastJunexisLine: undefined,
            lastJunexisColumn: undefined,
            lastSymbolId: undefined,
        });
    }

    getSnapshot(): NativeDebugSnapshot {
        return this.snapshot;
    }

    private async syncBreakpoints(): Promise<void> {
        const prepared = this.prepared;
        if (!prepared) {
            return;
        }
        this.syncing = true;
        try {
            if (this.mirrors.length > 0) {
                vscode.debug.removeBreakpoints(this.mirrors);
                this.mirrors = [];
            }

            const sourceBreakpoints = vscode.debug.breakpoints.filter(
                (breakpoint): breakpoint is vscode.SourceBreakpoint =>
                    breakpoint instanceof vscode.SourceBreakpoint &&
                    path.extname(breakpoint.location.uri.fsPath).toLowerCase() === '.jnx');
            const mirrors: vscode.SourceBreakpoint[] = [];
            for (const group of groupBySource(sourceBreakpoints)) {
                const mapped = mapJunexisBreakpoints(
                    prepared.sourceMap,
                    prepared.target,
                    group.sourcePath,
                    group.breakpoints.map(breakpoint => ({
                        line: breakpoint.location.range.start.line + 1,
                        enabled: breakpoint.enabled,
                        condition: breakpoint.condition,
                        hitCondition: breakpoint.hitCondition,
                        logMessage: breakpoint.logMessage,
                    })));
                for (const breakpoint of mapped) {
                    mirrors.push(new vscode.SourceBreakpoint(
                        new vscode.Location(
                            vscode.Uri.file(breakpoint.file),
                            new vscode.Position(
                                Math.max(0, breakpoint.line - 1),
                                Math.max(0, breakpoint.column - 1))),
                        breakpoint.enabled ?? true,
                        breakpoint.condition,
                        breakpoint.hitCondition,
                        breakpoint.logMessage));
                }
            }
            this.mirrors = mirrors;
            if (mirrors.length > 0) {
                vscode.debug.addBreakpoints(mirrors);
            }
            this.output.appendLine(
                `Mapped ${sourceBreakpoints.length} Junexis breakpoint(s) to ${mirrors.length} ${prepared.target} breakpoint(s).`);
            this.updateSnapshot({
                sourceBreakpointCount: sourceBreakpoints.length,
                runtimeBreakpointCount: mirrors.length,
                message: `Mapped ${sourceBreakpoints.length} .jnx breakpoint(s) to ${mirrors.length} runtime breakpoint(s).`,
            });
        } finally {
            this.syncing = false;
        }
    }

    private async revealMappedStackFrame(
        item: vscode.DebugThread | vscode.DebugStackFrame | undefined,
    ): Promise<void> {
        if (!item || !('frameId' in item) ||
            item.session.id !== this.activeSessionId ||
            !this.prepared ||
            !vscode.workspace.getConfiguration('junexis').get<boolean>('debug.openMappedSource', true)) {
            return;
        }
        try {
            const response = await item.session.customRequest('stackTrace', {
                threadId: item.threadId,
                startFrame: 0,
                levels: 100,
            }) as { stackFrames?: Array<{ id: number; line: number; source?: { path?: string } }> };
            const frame = response.stackFrames?.find(candidate => candidate.id === item.frameId);
            if (!frame?.source?.path) {
                return;
            }
            const mapping = mapGeneratedLocation(
                this.prepared.sourceMap,
                frame.source.path,
                frame.line);
            if (!mapping) {
                return;
            }
            const revealKey = `${item.session.id}:${item.frameId}:${mapping.source.file}:${mapping.source.line}`;
            if (revealKey === this.lastReveal) {
                return;
            }
            this.lastReveal = revealKey;
            const document = await vscode.workspace.openTextDocument(vscode.Uri.file(mapping.source.file));
            const editor = await vscode.window.showTextDocument(document, { preview: true });
            const position = new vscode.Position(
                Math.max(0, mapping.source.line - 1),
                Math.max(0, mapping.source.column - 1));
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
            this.output.appendLine(
                `Mapped runtime frame ${frame.source.path}:${frame.line} to ${mapping.source.file}:${mapping.source.line} (${mapping.symbolId}).`);
            this.updateSnapshot({
                lastRuntimeLocation: `${frame.source.path}:${frame.line}`,
                lastJunexisLocation: `${mapping.source.file}:${mapping.source.line}:${mapping.source.column}`,
                lastJunexisPath: mapping.source.file,
                lastJunexisLine: mapping.source.line,
                lastJunexisColumn: mapping.source.column,
                lastSymbolId: mapping.symbolId,
                message: `Mapped runtime frame to ${path.basename(mapping.source.file)}:${mapping.source.line}.`,
            });
        } catch (error) {
            this.output.appendLine(
                `Cannot map active runtime frame: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async clearMirrors(): Promise<void> {
        this.syncing = true;
        try {
            if (this.mirrors.length > 0) {
                vscode.debug.removeBreakpoints(this.mirrors);
                this.mirrors = [];
            }
        } finally {
            this.syncing = false;
        }
    }

    dispose(): void {
        void this.clearMirrors();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }

    private updateSnapshot(update: Partial<NativeDebugSnapshot>): void {
        this.snapshot = { ...this.snapshot, ...update };
        this.snapshotChanged.fire(this.snapshot);
    }
}

function groupBySource(breakpoints: vscode.SourceBreakpoint[]): Array<{
    sourcePath: string;
    breakpoints: vscode.SourceBreakpoint[];
}> {
    const groups = new Map<string, vscode.SourceBreakpoint[]>();
    for (const breakpoint of breakpoints) {
        const sourcePath = breakpoint.location.uri.fsPath;
        const bucket = groups.get(sourcePath) ?? [];
        bucket.push(breakpoint);
        groups.set(sourcePath, bucket);
    }
    return [...groups.entries()].map(([sourcePath, items]) => ({
        sourcePath,
        breakpoints: items,
    }));
}

function isJunexisSourceBreakpoint(breakpoint: vscode.Breakpoint): boolean {
    return breakpoint instanceof vscode.SourceBreakpoint &&
        path.extname(breakpoint.location.uri.fsPath).toLowerCase() === '.jnx';
}

async function loadActiveSourceMap(target: string): Promise<PreparedDebug> {
    const build = getLatestBuild();
    if (!build?.success || !build.buildId || !build.artifactManifest) {
        throw new Error('Build the Junexis project before starting native debug.');
    }
    const manifestJson = await fs.readFile(build.artifactManifest, 'utf8');
    const inventory = parseArtifactInventory(manifestJson, build.artifactManifest);
    if (inventory.buildId !== build.buildId) {
        throw new Error('Artifact inventory buildId does not match the active build.');
    }
    const sourceMapArtifact = inventory.items.find(item =>
        item.kind === 'debug-source-map' ||
        item.relativePath.split('\\').join('/').toLowerCase() === 'debug/junexis.source-map.json');
    if (!sourceMapArtifact) {
        throw new Error('The active build did not publish debug/junexis.source-map.json.');
    }
    const sourceMapJson = await fs.readFile(sourceMapArtifact.fullPath, 'utf8');
    const sourceMap = parseDebugSourceMap(
        sourceMapJson,
        path.dirname(inventory.manifestPath));
    if (!sourceMap.mappings.some(mapping =>
        mapping.generated.target.toLowerCase() === target.toLowerCase())) {
        throw new Error(`The source map has no mappings for target '${target}'.`);
    }
    return {
        target,
        sourceMapPath: sourceMapArtifact.fullPath,
        sourceMap,
    };
}
