import * as path from 'path';
import * as vscode from 'vscode';
import {
    type NativeDebugSnapshot,
    type NativeDebugBridge,
} from './native-debug-bridge';

interface NativeDebugItem {
    label: string;
    description?: string;
    icon: string;
    tooltip?: string;
    command?: vscode.Command;
}

class NativeDebugTreeProvider implements vscode.TreeDataProvider<NativeDebugItem>, vscode.Disposable {
    private readonly changed = new vscode.EventEmitter<NativeDebugItem | undefined>();
    private readonly subscription: vscode.Disposable;

    readonly onDidChangeTreeData = this.changed.event;

    constructor(private readonly bridge: NativeDebugBridge) {
        this.subscription = bridge.onDidChangeSnapshot(() => this.changed.fire(undefined));
    }

    getTreeItem(node: NativeDebugItem): vscode.TreeItem {
        const item = new vscode.TreeItem(node.label);
        item.description = node.description;
        item.iconPath = new vscode.ThemeIcon(node.icon);
        item.tooltip = node.tooltip;
        item.command = node.command;
        return item;
    }

    getChildren(): NativeDebugItem[] {
        return snapshotItems(this.bridge.getSnapshot());
    }

    dispose(): void {
        this.subscription.dispose();
        this.changed.dispose();
    }
}

function snapshotItems(snapshot: NativeDebugSnapshot): NativeDebugItem[] {
    const items: NativeDebugItem[] = [{
        label: `Status: ${snapshot.state}`,
        description: snapshot.message,
        icon: stateIcon(snapshot.state),
        tooltip: snapshot.message,
    }];
    if (snapshot.target) {
        items.push({
            label: `Target: ${snapshot.target}`,
            description: snapshot.sessionName,
            icon: 'server-process',
        });
    }
    if (snapshot.buildId) {
        items.push({
            label: `Build: ${snapshot.buildId.slice(0, 12)}`,
            description: snapshot.buildId,
            icon: 'symbol-key',
            tooltip: snapshot.buildId,
        });
    }
    if (snapshot.sourceMapPath) {
        items.push({
            label: `Source map: ${snapshot.mappingCount} mapping(s)`,
            description: path.basename(snapshot.sourceMapPath),
            icon: 'references',
            tooltip: snapshot.sourceMapPath,
        });
    }
    items.push({
        label: `Breakpoints: ${snapshot.sourceBreakpointCount} .jnx → ${snapshot.runtimeBreakpointCount} runtime`,
        icon: snapshot.runtimeBreakpointCount > 0 ? 'debug-breakpoint' : 'debug-breakpoint-unverified',
    });
    if (snapshot.lastJunexisPath && snapshot.lastJunexisLine && snapshot.lastJunexisColumn) {
        items.push({
            label: `Last mapped frame: ${path.basename(snapshot.lastJunexisPath)}:${snapshot.lastJunexisLine}`,
            description: snapshot.lastSymbolId,
            icon: 'debug-stackframe-active',
            tooltip: `${snapshot.lastRuntimeLocation ?? 'runtime'} → ${snapshot.lastJunexisLocation}`,
            command: {
                command: 'junexis.nativeDebug.openLastMappedSource',
                title: 'Open last mapped Junexis source',
            },
        });
    }
    return items;
}

function stateIcon(state: NativeDebugSnapshot['state']): string {
    switch (state) {
        case 'running':
            return 'debug-start';
        case 'prepared':
            return 'loading';
        case 'stopped':
            return 'debug-stop';
        case 'error':
            return 'error';
        default:
            return 'circle-outline';
    }
}

export function registerNativeDebugView(
    bridge: NativeDebugBridge,
): vscode.Disposable {
    const provider = new NativeDebugTreeProvider(bridge);
    return vscode.Disposable.from(
        provider,
        vscode.window.registerTreeDataProvider('junexisNativeDebug', provider),
        vscode.commands.registerCommand('junexis.nativeDebug.openLastMappedSource', async () => {
            const snapshot = bridge.getSnapshot();
            if (!snapshot.lastJunexisPath || !snapshot.lastJunexisLine || !snapshot.lastJunexisColumn) {
                await vscode.window.showInformationMessage('Junexis: no mapped native frame is available.');
                return;
            }
            const document = await vscode.workspace.openTextDocument(
                vscode.Uri.file(snapshot.lastJunexisPath));
            const editor = await vscode.window.showTextDocument(document, { preview: true });
            const position = new vscode.Position(
                snapshot.lastJunexisLine - 1,
                snapshot.lastJunexisColumn - 1);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(
                new vscode.Range(position, position),
                vscode.TextEditorRevealType.InCenter);
        }),
    );
}
