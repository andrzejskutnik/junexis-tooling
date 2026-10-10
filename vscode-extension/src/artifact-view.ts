import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { parseArtifactInventory, type ArtifactInventory, type ArtifactItem } from './artifact-contract';
import {
    createArtifactLaunchPlan,
    type ArtifactProcessPlan,
} from './artifact-launch';
import { getLatestBuild, onLatestBuildChanged } from './tooling-state';
import type { NativeDebugBridge } from './native-debug-bridge';

type ArtifactNode =
    | { type: 'group'; label: string; items: ArtifactItem[] }
    | { type: 'artifact'; item: ArtifactItem };

class ArtifactTreeProvider implements vscode.TreeDataProvider<ArtifactNode>, vscode.Disposable {
    private readonly changed = new vscode.EventEmitter<ArtifactNode | undefined>();
    private inventory?: ArtifactInventory;
    private status = 'Build a Junexis project to load artifacts.';
    private readonly unsubscribe: () => void;

    readonly onDidChangeTreeData = this.changed.event;

    constructor() {
        this.unsubscribe = onLatestBuildChanged(() => {
            void this.refresh();
        });
        void this.refresh();
    }

    getTreeItem(node: ArtifactNode): vscode.TreeItem {
        if (node.type === 'group') {
            const item = new vscode.TreeItem(
                node.label,
                node.items.length > 0
                    ? vscode.TreeItemCollapsibleState.Expanded
                    : vscode.TreeItemCollapsibleState.None);
            item.description = `${node.items.length}`;
            item.iconPath = new vscode.ThemeIcon('folder-library');
            item.contextValue = `junexisArtifactTarget.${node.label.toLowerCase()}`;
            return item;
        }

        const artifact = node.item;
        const item = new vscode.TreeItem(path.basename(artifact.relativePath));
        item.description = `${artifact.kind} · ${artifact.ownership}`;
        item.tooltip = new vscode.MarkdownString(
            `**${artifact.relativePath}**\n\nTarget: \`${artifact.target}\`\n\nKind: \`${artifact.kind}\`\n\nOwnership: \`${artifact.ownership}\`\n\nSHA-256: \`${artifact.sha256}\``);
        item.resourceUri = vscode.Uri.file(artifact.fullPath);
        item.iconPath = vscode.ThemeIcon.File;
        item.command = {
            command: 'junexis.artifacts.open',
            title: 'Open Junexis artifact',
            arguments: [artifact],
        };
        item.contextValue = 'junexisArtifact';
        return item;
    }

    getChildren(node?: ArtifactNode): ArtifactNode[] {
        if (node?.type === 'group') {
            return node.items.map(item => ({ type: 'artifact', item }));
        }
        if (node?.type === 'artifact' || !this.inventory) {
            return [];
        }

        const groups = new Map<string, ArtifactItem[]>();
        for (const item of this.inventory.items) {
            const label = item.target || 'shared';
            const bucket = groups.get(label) ?? [];
            bucket.push(item);
            groups.set(label, bucket);
        }
        return [...groups.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([label, items]) => ({
                type: 'group',
                label,
                items: items.sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
            }));
    }

    getStatus(): string {
        return this.status;
    }

    async refresh(): Promise<void> {
        const build = getLatestBuild();
        this.inventory = undefined;
        if (!build?.success || !build.buildId || !build.artifactManifest) {
            this.status = 'Build a Junexis project to load artifacts.';
            void vscode.commands.executeCommand('setContext', 'junexis.hasArtifacts', false);
            this.changed.fire(undefined);
            return;
        }

        try {
            const json = await fs.readFile(build.artifactManifest, 'utf8');
            const inventory = parseArtifactInventory(json, build.artifactManifest);
            if (inventory.buildId !== build.buildId) {
                throw new Error('Artifact manifest buildId does not match the active build.');
            }
            this.inventory = inventory;
            this.status = `${inventory.items.length} artifact(s) · build ${inventory.buildId.slice(0, 12)}`;
            void vscode.commands.executeCommand(
                'setContext',
                'junexis.hasArtifacts',
                inventory.items.length > 0);
        } catch (error) {
            this.status = error instanceof Error ? error.message : String(error);
            void vscode.commands.executeCommand('setContext', 'junexis.hasArtifacts', false);
        }
        this.changed.fire(undefined);
    }

    dispose(): void {
        this.unsubscribe();
        this.changed.dispose();
    }
}

export function registerArtifactView(
    context: vscode.ExtensionContext,
    nativeDebug: NativeDebugBridge,
): vscode.Disposable {
    const provider = new ArtifactTreeProvider();
    const disposables = [
        provider,
        vscode.window.registerTreeDataProvider('junexisArtifacts', provider),
        vscode.commands.registerCommand('junexis.artifacts.refresh', () => provider.refresh()),
        vscode.commands.registerCommand('junexis.artifacts.open', async (artifact: ArtifactItem) => {
            try {
                const document = await vscode.workspace.openTextDocument(vscode.Uri.file(artifact.fullPath));
                await vscode.window.showTextDocument(document, { preview: true });
            } catch (error) {
                await vscode.window.showWarningMessage(
                    `Junexis: cannot open artifact '${artifact.relativePath}': ${error instanceof Error ? error.message : String(error)}`);
            }
        }),
        vscode.commands.registerCommand('junexis.artifacts.showStatus', () =>
            vscode.window.showInformationMessage(`Junexis Artifacts: ${provider.getStatus()}`)),
        vscode.commands.registerCommand(
            'junexis.artifacts.buildTarget',
            (node: Extract<ArtifactNode, { type: 'group' }>) =>
                executeTargetProcess(node, 'build')),
        vscode.commands.registerCommand(
            'junexis.artifacts.runTarget',
            (node: Extract<ArtifactNode, { type: 'group' }>) =>
                executeTargetProcess(node, 'run')),
        vscode.commands.registerCommand(
            'junexis.artifacts.debugTarget',
            (node: Extract<ArtifactNode, { type: 'group' }>) =>
                debugTarget(node, nativeDebug)),
    ];
    return vscode.Disposable.from(...disposables);
}

async function executeTargetProcess(
    node: Extract<ArtifactNode, { type: 'group' }>,
    operation: 'build' | 'run',
): Promise<void> {
    try {
        const plan = createArtifactLaunchPlan(node.label, node.items);
        if (operation === 'run' && plan.runMutatesDevice) {
            const choice = await vscode.window.showWarningMessage(
                `Upload the generated Junexis '${node.label}' target to the connected device?`,
                { modal: true },
                'Upload');
            if (choice !== 'Upload') {
                return;
            }
        }
        await executeProcessTask(plan[operation], `${operation} ${node.label}`);
    } catch (error) {
        await vscode.window.showWarningMessage(
            `Junexis ${operation}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function executeProcessTask(plan: ArtifactProcessPlan, label: string): Promise<void> {
    const execution = new vscode.ProcessExecution(
        plan.command,
        plan.args,
        { cwd: plan.cwd });
    const task = new vscode.Task(
        { type: 'junexis-artifact', operation: label },
        vscode.TaskScope.Workspace,
        `Junexis: ${label}`,
        'Junexis',
        execution);
    task.presentationOptions = {
        reveal: vscode.TaskRevealKind.Always,
        panel: vscode.TaskPanelKind.Dedicated,
        clear: true,
    };
    await vscode.tasks.executeTask(task);
}

async function debugTarget(
    node: Extract<ArtifactNode, { type: 'group' }>,
    nativeDebug: NativeDebugBridge,
): Promise<void> {
    let prepared = false;
    try {
        const plan = createArtifactLaunchPlan(node.label, node.items);
        if (!plan.debug) {
            await vscode.window.showInformationMessage(
                'Junexis embedded debug requires a board-specific PlatformIO debug probe. Build the target, then use PlatformIO Debug so the adapter can resolve firmware and toolchain paths.');
            return;
        }
        if (plan.profile === 'go' && !vscode.extensions.getExtension('golang.go')) {
            await vscode.window.showWarningMessage(
                'Junexis Go debugging requires the official Go extension (golang.go).');
            return;
        }
        const configuration = await nativeDebug.prepare(
            node.label,
            plan.debug as vscode.DebugConfiguration);
        prepared = true;
        const started = await vscode.debug.startDebugging(
            undefined,
            configuration);
        if (!started) {
            await nativeDebug.cancelPrepared();
            await vscode.window.showWarningMessage(
                `Junexis: VS Code could not start the ${plan.profile} debug adapter.`);
        }
    } catch (error) {
        if (prepared) {
            await nativeDebug.cancelPrepared();
        }
        await vscode.window.showWarningMessage(
            `Junexis debug: ${error instanceof Error ? error.message : String(error)}`);
    }
}
