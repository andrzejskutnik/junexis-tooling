import { registerApplicationSession } from './application-session';
import * as path from 'path';
import * as vscode from 'vscode';
import type { LanguageClient } from 'vscode-languageclient/node';
import { JunexisChecker } from './checker';
import { registerFallbackLanguageFeatures } from './fallback-language-features';
import { resolveCliBackend, resolveLspBackend, resolveMentorBackend } from './backend-discovery';
import { createLspClient } from './lsp-client';
import { discoverJunexisProjectContext, type JunexisProjectContext } from './project-discovery';
import { registerDiagnosticHelp } from './diagnostic-help';
import { registerJunexisFileDecorations } from './file-decorations';
import { registerJunexisDebugUi } from './debug-ui';
import { MentorService } from './mentor';
import { registerArtifactView } from './artifact-view';
import { NativeDebugBridge } from './native-debug-bridge';
import { registerNativeDebugView } from './native-debug-view';
import { LazyService } from './lazy-service';
import { LanguageServicePrewarm } from './language-service-prewarm';
import { PerformanceProfile } from './performance-profile';
import { buildOutputFromReceipt } from './latest-build-contract';
import {
    projectRootsForAutomaticRestore,
    restoreLatestBuild,
} from './latest-build-restore';
import { clearLatestBuild, setLatestBuild } from './tooling-state';

let checker:   JunexisChecker  | undefined;
let lspClient: LanguageClient | null = null;
let lspActive = false;
let fallbackRegistered = false;
let fallbackDisposable: vscode.Disposable | undefined;
let lastActiveJunexisDocument: vscode.TextDocument | undefined;
let languageServices: LazyService | undefined;
let activationProfile: PerformanceProfile | undefined;
let latestBuildRestoreGeneration = 0;

function createSetupReport(context: vscode.ExtensionContext): string {
    const lsp = resolveLspBackend(context.extensionPath);
    const cli = resolveCliBackend(context.extensionPath);
    const mentor = resolveMentorBackend(context.extensionPath);
    const project = discoverJunexisProjectContext(activeJunexisDocument());

    const lines = [
        'Junexis setup diagnostics',
        '',
        'Active context:',
        `Mode: ${project.mode}`,
        `Active file: ${project.activeFile ?? 'n/a'}`,
        `Workspace folder: ${project.workspaceFolder ?? 'n/a'}`,
        `Project root: ${project.projectRoot ?? 'n/a'}`,
        `Project manifest: ${project.manifestPath ?? 'n/a'}`,
        `Note: ${project.reason ?? 'project manifest detected'}`,
        '',
        `LSP: ${lsp.label}`,
        `LSP source: ${lsp.source}`,
        `LSP path: ${lsp.path ?? 'not found'}`,
        `LSP command: ${lsp.command || 'n/a'} ${lsp.args.join(' ')}`.trim(),
        `LSP version: ${lsp.identity?.version ?? 'unknown'}`,
        `LSP protocol: ${lsp.identity?.protocolVersion ?? 'unknown'}`,
        `LSP compatibility: ${lsp.compatibility?.message ?? 'unverified legacy host'}`,
        '',
        `CLI: ${cli.label}`,
        `CLI source: ${cli.source}`,
        `CLI path: ${cli.path ?? 'not found'}`,
        `CLI command: ${cli.command || 'n/a'} ${cli.args.join(' ')}`.trim(),
        '',
        `Mentor: ${mentor.label}`,
        `Mentor source: ${mentor.source}`,
        `Mentor path: ${mentor.path ?? 'not found'}`,
        `Mentor command: ${mentor.command || 'n/a'} ${mentor.args.join(' ')}`.trim(),
        '',
        'Workspace folders:',
        ...(vscode.workspace.workspaceFolders ?? []).map(folder => `- ${folder.uri.fsPath}`),
    ];

    if (lsp.source === 'missing' || cli.source === 'missing' || mentor.source === 'missing') {
        lines.push(
            '',
            'Checked candidates:',
            ...lsp.candidates.map(candidate => `- LSP: ${candidate}`),
            ...cli.candidates.map(candidate => `- CLI: ${candidate}`),
            ...mentor.candidates.map(candidate => `- Mentor: ${candidate}`),
        );
    }

    return lines.join('\n');
}

function isJunexisDocument(doc: vscode.TextDocument | undefined): doc is vscode.TextDocument {
    return !!doc && (doc.languageId === 'junexis' || path.extname(doc.fileName).toLowerCase() === '.jnx');
}

function rememberJunexisDocument(doc: vscode.TextDocument | undefined): void {
    if (isJunexisDocument(doc)) {
        lastActiveJunexisDocument = doc;
    }
}

function activeJunexisDocument(): vscode.TextDocument | undefined {
    const doc = vscode.window.activeTextEditor?.document;
    if (isJunexisDocument(doc)) {
        rememberJunexisDocument(doc);
        return doc;
    }

    return lastActiveJunexisDocument;
}

function requireJunexisDocument(action: string): vscode.TextDocument | undefined {
    const doc = activeJunexisDocument();
    if (!doc) {
        vscode.window.showInformationMessage(`Otwórz zapisany plik .jnx, aby ${action}.`);
        return undefined;
    }

    return doc;
}

function doctorTargetFromContext(project: JunexisProjectContext): { targetPath: string; workingDirectory: string } | undefined {
    if (project.mode === 'project' && project.projectRoot) {
        return {
            targetPath: project.projectRoot,
            workingDirectory: project.projectRoot
        };
    }

    if (project.mode === 'file' && project.activeFile) {
        return {
            targetPath: project.activeFile,
            workingDirectory: path.dirname(project.activeFile)
        };
    }

    return undefined;
}

function requireProjectContext(): JunexisProjectContext | undefined {
    const project = discoverJunexisProjectContext(activeJunexisDocument());
    if (project.mode !== 'project' || !project.projectRoot) {
        vscode.window.showInformationMessage('Otwórz zapisany plik .jnx należący do projektu Junexis, aby uruchomić tę komendę.');
        return undefined;
    }

    return project;
}

function updateStatusBar(statusBar: vscode.StatusBarItem): void {
    const project = discoverJunexisProjectContext(activeJunexisDocument());
    const serviceState = languageServices?.state ?? 'idle';
    const backend = lspActive
        ? 'LSP'
        : serviceState === 'starting'
            ? 'Starting'
            : serviceState === 'running'
                ? 'Local'
                : 'Ready';
    const icon = lspActive
        ? '$(radio-tower)'
        : serviceState === 'starting'
            ? '$(sync~spin)'
            : serviceState === 'running'
                ? '$(symbol-class)'
                : '$(circle-outline)';

    statusBar.text = `${icon} Junexis ${backend} · ${project.mode}`;
    statusBar.command = 'junexis.diagnoseSetup';

    const tooltip = new vscode.MarkdownString(undefined, true);
    tooltip.isTrusted = false;
    tooltip.appendMarkdown(`**Junexis ${backend}**\n\n`);
    tooltip.appendMarkdown(`Mode: \`${project.mode}\`\n\n`);
    tooltip.appendMarkdown(`Active file: \`${project.activeFile ?? 'n/a'}\`\n\n`);
    tooltip.appendMarkdown(`Workspace: \`${project.workspaceFolder ?? 'n/a'}\`\n\n`);
    tooltip.appendMarkdown(`Project root: \`${project.projectRoot ?? 'n/a'}\`\n\n`);
    tooltip.appendMarkdown(`Manifest: \`${project.manifestPath ?? 'n/a'}\`\n\n`);
    tooltip.appendMarkdown(`Note: ${project.reason ?? 'project manifest detected'}\n\n`);

    if (lspActive) {
        tooltip.appendMarkdown('LSP diagnostics are active. CLI remains available for project commands.');
        statusBar.tooltip = tooltip;
        return;
    }

    if (serviceState === 'idle') {
        tooltip.appendMarkdown('Language services are ready and will start when a Junexis document is opened.');
        statusBar.tooltip = tooltip;
        return;
    }

    if (serviceState === 'starting') {
        tooltip.appendMarkdown('Junexis language services are starting.');
        statusBar.tooltip = tooltip;
        return;
    }

    tooltip.appendMarkdown('Local/fallback mode is active; diagnostics may come from CLI fallback.');
    statusBar.tooltip = tooltip;
}

async function startLsp(context: vscode.ExtensionContext, statusBar: vscode.StatusBarItem): Promise<boolean> {
    const client = createLspClient(context, activationProfile);
    if (!client) {
        return false;
    }

    context.subscriptions.push(client.onDidChangeState((event) => {
        if (event.newState === 2) {
            lspActive = true;
            updateStatusBar(statusBar);
        }

        if (event.newState === 1) {
            lspActive = false;
            updateStatusBar(statusBar);
        }
    }));

    try {
        lspClient = client;
        await (
            activationProfile?.measure('LSP · process and handshake', () => client.start())
            ?? client.start()
        );
        unregisterFallbackMode();
        checker?.resetFallbackState();
        lspActive = true;
        updateStatusBar(statusBar);
        return true;
    } catch (error) {
        lspClient = null;
        lspActive = false;
        updateStatusBar(statusBar);
        void vscode.window.showWarningMessage(`Junexis: nie udało się uruchomić LSP, przechodzę do trybu fallback. ${String(error)}`);
        return false;
    }
}

async function restartLsp(context: vscode.ExtensionContext, statusBar: vscode.StatusBarItem): Promise<boolean> {
    if (lspClient) {
        await lspClient.stop();
        lspClient = null;
    }

    lspActive = false;
    updateStatusBar(statusBar);
    return startLsp(context, statusBar);
}

function registerFallbackMode(
    context: vscode.ExtensionContext,
    diagnosticCollection: vscode.DiagnosticCollection,
): void {
    if (fallbackRegistered) {
        return;
    }

    fallbackRegistered = true;
    fallbackDisposable = vscode.Disposable.from(
        registerFallbackLanguageFeatures(),
        vscode.workspace.onDidOpenTextDocument((doc: vscode.TextDocument) => {
            if (doc.languageId === 'junexis') checker!.checkDebounced(doc);
        }),
        vscode.workspace.onDidSaveTextDocument((doc: vscode.TextDocument) => {
            if (doc.languageId !== 'junexis') { return; }
            const cfg = vscode.workspace.getConfiguration('junexis');
            if (cfg.get<boolean>('checkOnSave', true)) checker!.checkNow(doc);
        }),
        vscode.workspace.onDidChangeTextDocument((ev: vscode.TextDocumentChangeEvent) => {
            if (ev.document.languageId !== 'junexis') { return; }
            const cfg = vscode.workspace.getConfiguration('junexis');
            if (cfg.get<boolean>('checkOnChange', true)) checker!.checkDebounced(ev.document);
        }),
        vscode.workspace.onDidCloseTextDocument((doc: vscode.TextDocument) => {
            diagnosticCollection.delete(doc.uri);
        }),
    );

    context.subscriptions.push(fallbackDisposable);
}

function unregisterFallbackMode(): void {
    if (!fallbackRegistered) {
        return;
    }

    fallbackDisposable?.dispose();
    fallbackDisposable = undefined;
    fallbackRegistered = false;
}

async function ensureLanguageServices(
    context: vscode.ExtensionContext,
    statusBar: vscode.StatusBarItem,
    diagnosticCollection: vscode.DiagnosticCollection,
): Promise<void> {
    if (!languageServices) {
        return;
    }

    await languageServices.ensureStarted(() => activationProfile?.measure('language services', async () => {
        const lspStarted = await startLsp(context, statusBar);
        if (!lspStarted) {
            registerFallbackMode(context, diagnosticCollection);
        }

        const activeDoc = vscode.window.activeTextEditor?.document;
        rememberJunexisDocument(activeDoc);
        if (!lspStarted && isJunexisDocument(activeDoc)) {
            checker?.checkDebounced(activeDoc);
        }
    }) ?? Promise.resolve());
}

function requestLanguageServices(
    context: vscode.ExtensionContext,
    statusBar: vscode.StatusBarItem,
    diagnosticCollection: vscode.DiagnosticCollection,
): void {
    void ensureLanguageServices(context, statusBar, diagnosticCollection).catch(error => {
        void vscode.window.showWarningMessage(`Junexis: nie udało się uruchomić usług językowych. ${String(error)}`);
    });
}

function isProjectPrewarmEnabled(): boolean {
    return vscode.workspace
        .getConfiguration('junexis')
        .get<'project' | 'document'>('languageServicesStartup', 'project') === 'project';
}

async function workspaceContainsJunexisProject(): Promise<boolean> {
    const manifests = await vscode.workspace.findFiles(
        '**/junexis.project.toml',
        '**/{.git,node_modules}/**',
        1,
    );
    return manifests.length > 0;
}

async function restoreLatestBuildState(
    output: vscode.OutputChannel,
    notifyOnError = false,
): Promise<void> {
    const generation = ++latestBuildRestoreGeneration;
    const project = discoverJunexisProjectContext(activeJunexisDocument());
    const manifests = await vscode.workspace.findFiles(
        '**/junexis.project.toml',
        '**/{.git,node_modules}/**',
    );
    const result = await restoreLatestBuild(
        project,
        projectRootsForAutomaticRestore(
            project,
            manifests.map(uri => path.dirname(uri.fsPath))));
    if (generation !== latestBuildRestoreGeneration) {
        return;
    }

    clearLatestBuild();
    if (result.receipt) {
        setLatestBuild(buildOutputFromReceipt(result.receipt));
        output.appendLine(
            `Restored verified latest-build 1.0: ${result.receipt.buildId} (${result.receipt.receiptPath})`);
    }
    if (result.errors.length > 0) {
        output.appendLine('Junexis could not restore one or more latest-build receipts:');
        for (const error of result.errors) {
            output.appendLine(`- ${error}`);
        }
        output.appendLine('Run Junexis: Build Project to publish a new verified receipt.');
        if (notifyOnError) {
            await vscode.window.showWarningMessage(
                'Junexis: the previous build could not be restored safely. Rebuild the project; details are in Junexis Setup.');
        }
    }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    activationProfile = new PerformanceProfile('Junexis extension activation');

    // ── Status bar ────────────────────────────────────────────────────────
    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
    statusBar.command = 'junexis.check';
    context.subscriptions.push(statusBar);

    const setupOutputChannel = vscode.window.createOutputChannel('Junexis Setup');
    context.subscriptions.push(setupOutputChannel);

    const diagnosticCollection = vscode.languages.createDiagnosticCollection('junexis');
    context.subscriptions.push(diagnosticCollection);
    checker = new JunexisChecker(diagnosticCollection, context.extensionPath);
    const mentor = new MentorService(context, checker);
    const nativeDebug = new NativeDebugBridge();
    context.subscriptions.push(nativeDebug);
    rememberJunexisDocument(vscode.window.activeTextEditor?.document);
    languageServices = new LazyService(() => updateStatusBar(statusBar));
    const languageServicePrewarm = new LanguageServicePrewarm(
        workspaceContainsJunexisProject,
        () => requestLanguageServices(context, statusBar, diagnosticCollection),
        250,
        error => console.warn('Junexis: project prewarm detection failed.', error),
    );
    activationProfile.checkpoint('core services');

    // ── Komendy (dostępne w obu trybach) ─────────────────────────────────
    context.subscriptions.push(
        registerDiagnosticHelp(context),
        registerJunexisFileDecorations(),
        registerArtifactView(context, nativeDebug),
        registerApplicationSession(context),
        registerNativeDebugView(nativeDebug),
        registerJunexisDebugUi(context, mentor),
        languageServicePrewarm,

        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            void restoreLatestBuildState(setupOutputChannel, true);
            if (isProjectPrewarmEnabled()) {
                languageServicePrewarm.schedule();
            } else {
                languageServicePrewarm.cancel();
            }
        }),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (!event.affectsConfiguration('junexis.languageServicesStartup')) {
                return;
            }

            if (isProjectPrewarmEnabled()) {
                languageServicePrewarm.schedule();
            } else {
                languageServicePrewarm.cancel();
            }
        }),

        vscode.window.onDidChangeActiveTextEditor(editor => {
            rememberJunexisDocument(editor?.document);
            updateStatusBar(statusBar);
            if (isJunexisDocument(editor?.document)) {
                void restoreLatestBuildState(setupOutputChannel);
                requestLanguageServices(context, statusBar, diagnosticCollection);
            }
        }),
        vscode.workspace.onDidOpenTextDocument(doc => {
            rememberJunexisDocument(doc);
            updateStatusBar(statusBar);
            if (isJunexisDocument(doc)) {
                requestLanguageServices(context, statusBar, diagnosticCollection);
            }
        }),

        vscode.commands.registerCommand('junexis.check', () => {
            const doc = requireJunexisDocument('uruchomić sprawdzanie');
            if (!doc) {
                return;
            }

            checker!.checkNow(doc, !lspActive);
        }),

        vscode.commands.registerCommand('junexis.checkProject', () => {
            const project = requireProjectContext();
            if (!project?.projectRoot) {
                return;
            }

            checker!.checkProject(project.projectRoot, project.activeFile, !lspActive);
        }),

        vscode.commands.registerCommand('junexis.compile', () => {
            const doc = requireJunexisDocument('skompilować plik');
            if (!doc) {
                return;
            }

            // Kompilacja zawsze przez CLI — LSP tylko sprawdza składnię, nie buduje artefaktów
            if (!checker) {
                const dc = vscode.languages.createDiagnosticCollection('junexis-compile');
                context.subscriptions.push(dc);
                checker = new JunexisChecker(dc, context.extensionPath);
            }
            checker.compile(doc);
        }),

        vscode.commands.registerCommand('junexis.buildProject', () => {
            const project = requireProjectContext();
            if (!project?.projectRoot) {
                return;
            }

            checker!.buildProject(project.projectRoot);
        }),

        vscode.commands.registerCommand('junexis.scaffoldExterns', () => {
            const project = requireProjectContext();
            if (!project?.projectRoot) {
                return;
            }

            checker!.scaffoldExterns(project.projectRoot);
        }),

        vscode.commands.registerCommand('junexis.cleanProject', async () => {
            const project = requireProjectContext();
            if (!project?.projectRoot) {
                return;
            }

            const choice = await vscode.window.showWarningMessage(
                `Junexis: wyczyścić wygenerowane artefakty projektu ${path.basename(project.projectRoot)}? Usunięte zostaną outDir, .junexis/build i .junexis/diagnostics. Źródła, manifest i cache zostaną zachowane.`,
                { modal: true },
                'Clean Project'
            );

            if (choice !== 'Clean Project') {
                return;
            }

            checker!.cleanProject(project.projectRoot);
        }),

        vscode.commands.registerCommand('junexis.doctorProject', () => {
            const project = discoverJunexisProjectContext(activeJunexisDocument());
            const target = doctorTargetFromContext(project);
            if (!target) {
                vscode.window.showInformationMessage('Otwórz zapisany plik .jnx, aby uruchomić Junexis Doctor.');
                return;
            }

            checker!.doctor(target.targetPath, target.workingDirectory);
        }),

        vscode.commands.registerCommand('junexis.restartServer', async () => {
            languageServices?.reset();
            await languageServices?.ensureStarted(async () => {
                const restarted = await restartLsp(context, statusBar);
                if (restarted) {
                    await vscode.window.showInformationMessage('Junexis: Language Server został uruchomiony ponownie.');
                    return;
                }

                registerFallbackMode(context, diagnosticCollection);
                await vscode.window.showWarningMessage('Junexis: nie udało się uruchomić LSP. Rozszerzenie działa w trybie fallback.');
            });
        }),

        vscode.commands.registerCommand('junexis.diagnoseSetup', async () => {
            const report = createSetupReport(context);
            setupOutputChannel.clear();
            setupOutputChannel.appendLine(report);
            setupOutputChannel.show(true);
            await vscode.window.showInformationMessage('Junexis: setup diagnostics zapisane w kanale output.');
        }),
        vscode.commands.registerCommand('junexis.showActivationProfile', () => {
            setupOutputChannel.clear();
            setupOutputChannel.appendLine(activationProfile?.render() ?? 'Junexis activation profile is unavailable.');
            setupOutputChannel.show(true);
        }),
    );
    activationProfile.checkpoint('UI and commands');

    updateStatusBar(statusBar);
    statusBar.show();

    const activeDoc = vscode.window.activeTextEditor?.document;
    rememberJunexisDocument(activeDoc);
    updateStatusBar(statusBar);
    activationProfile.checkpoint('activation shell ready');
    void restoreLatestBuildState(setupOutputChannel, true);
    if (isJunexisDocument(activeDoc)) {
        await ensureLanguageServices(context, statusBar, diagnosticCollection);
    }
    activationProfile.finish('activation completed');

    if (!isJunexisDocument(activeDoc) && isProjectPrewarmEnabled()) {
        languageServicePrewarm.schedule();
    }
}

export async function deactivate(): Promise<void> {
    unregisterFallbackMode();

    if (lspClient) {
        await lspClient.stop();
        lspClient = null;
    }

    checker?.dispose();
    languageServices?.reset();
    languageServices = undefined;
    activationProfile = undefined;
}
