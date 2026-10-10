import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { resolveMentorBackend } from './backend-discovery';
import type { JunexisChecker } from './checker';
import type { DiagnosticStory } from './diagnostic-story';
import {
    assertCurrentMentorAnalysis,
    findingsForStory,
    mentorFindingDelta,
    parseMentorAnalysis,
    type MentorAnalysis,
    type MentorFindingDelta,
    type MentorFinding,
} from './mentor-contract';
import {
    applyMentorProjectPolicy,
    emptyMentorProjectPolicy,
    parseMentorProjectPolicy,
    type MentorPolicyEvaluation,
} from './mentor-policy';
import { getLatestBuild } from './tooling-state';
import {
    createM1002Proposal,
    createM1012Proposal,
    parseAnalysisSnapshot,
    type MentorRefactoringProposal,
} from './mentor-refactoring';

/** Process-boundary integration with the deterministic Junexis Mentor CLI. */
export class MentorService implements vscode.Disposable {
    private output?: vscode.OutputChannel;
    private diagnostics?: vscode.DiagnosticCollection;
    private cachedRaw?: MentorAnalysis;
    private cached?: MentorAnalysis;
    private cachedKey?: string;
    private previous?: MentorAnalysis;
    private delta: MentorFindingDelta = { added: 0, changed: 0, resolved: 0, unchanged: 0 };
    private policy?: LoadedPolicy;
    private readonly previews = new Map<string, string>();

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly checker: JunexisChecker,
    ) {
        const previewProvider: vscode.TextDocumentContentProvider = {
            provideTextDocumentContent: uri => this.previews.get(uri.toString()) ?? '',
        };
        context.subscriptions.push(
            this,
            vscode.commands.registerCommand('junexis.mentor.analyze', () => this.showLatestAnalysis()),
            vscode.commands.registerCommand(
                'junexis.mentor.previewRefactoring',
                (uri: vscode.Uri, line: number, ruleCode?: string) =>
                    this.previewRefactoring(uri, line, ruleCode)),
            vscode.workspace.registerTextDocumentContentProvider(
                'junexis-mentor-preview',
                previewProvider),
            vscode.languages.registerCodeActionsProvider(
                { language: 'junexis', scheme: 'file' },
                {
                    provideCodeActions: (document, _range, context) =>
                        this.refactoringActions(document, context),
                },
                { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }),
        );
    }

    async findingsForStory(story: DiagnosticStory): Promise<MentorFinding[]> {
        const analysis = await this.analyzeLatestBuild();
        return findingsForStory(analysis, story);
    }

    private refactoringActions(
        document: vscode.TextDocument,
        context: vscode.CodeActionContext,
    ): vscode.CodeAction[] {
        const diagnostic = context.diagnostics.find(item =>
            item.source === 'Junexis Mentor'
            && ['M1002', 'M1012'].includes(diagnosticCode(item) ?? ''));
        if (!diagnostic) {
            return [];
        }
        const code = diagnosticCode(diagnostic)!;
        if (code === 'M1012' && !this.hasExactlyOneCurrentPipeline()) {
            return [];
        }
        const label = code === 'M1012'
            ? 'Connect Narrative to the sole pipeline'
            : 'Preview safe Narrative refactoring';
        const action = new vscode.CodeAction(
            `Junexis Mentor: ${label}`,
            vscode.CodeActionKind.QuickFix);
        action.command = {
            command: 'junexis.mentor.previewRefactoring',
            title: label,
            arguments: [document.uri, diagnostic.range.start.line, code],
        };
        action.diagnostics = [diagnostic];
        action.isPreferred = true;
        return [action];
    }

    private async previewRefactoring(
        uri: vscode.Uri,
        line: number,
        ruleCode = 'M1002',
    ): Promise<void> {
        try {
            const document = await vscode.workspace.openTextDocument(uri);
            if (document.isDirty) {
                throw new Error('Save the document before creating a Mentor refactoring preview.');
            }
            const build = getLatestBuild();
            if (!build?.success || !build.buildId || !build.analysisSnapshot || !build.projectRoot) {
                throw new Error('Build the Junexis project first; no current analysis snapshot is available.');
            }
            const analysis = await this.analyzeLatestBuild();
            const finding = analysis.findings.find(item =>
                item.code === ruleCode
                && item.source
                && sameFile(resolveSourceFile(build.projectRoot, item.source.file), uri.fsPath)
                && Math.max(0, item.source.line - 1) === line);
            if (!finding) {
                throw new Error(`The ${ruleCode} finding is no longer current. Run Mentor analysis again.`);
            }
            const snapshot = parseAnalysisSnapshot(fs.readFileSync(build.analysisSnapshot, 'utf8'));
            if (snapshot.buildId !== build.buildId) {
                throw new Error('Analysis snapshot buildId does not match the current build.');
            }
            const originalContent = fs.readFileSync(uri.fsPath, 'utf8');
            const proposal = ruleCode === 'M1012'
                ? createM1012Proposal(
                    snapshot,
                    finding,
                    build.projectRoot,
                    originalContent)
                : createM1002Proposal(
                    snapshot,
                    finding,
                    build.projectRoot,
                    originalContent);
            if (!sameFile(proposal.filePath, uri.fsPath)) {
                throw new Error('The selected diagnostic does not match the compiler symbol source.');
            }

            const previewUri = vscode.Uri.from({
                scheme: 'junexis-mentor-preview',
                path: `/${path.basename(proposal.filePath)}`,
                query: `${Date.now()}-${encodeURIComponent(proposal.id)}`,
            });
            this.previews.set(previewUri.toString(), proposal.updatedContent);
            await vscode.commands.executeCommand(
                'vscode.diff',
                uri,
                previewUri,
                `Mentor preview · ${proposal.title}`,
                { preview: true });

            const choice = await vscode.window.showInformationMessage(
                proposal.title,
                {
                    modal: true,
                    detail: [
                        proposal.expectedEffect,
                        '',
                        'Assumptions:',
                        ...proposal.assumptions.map(item => `• ${item}`),
                        '',
                        'Applying saves the file and runs Junexis compiler check. No VCS action is performed.',
                    ].join('\n'),
                },
                'Apply and check');
            if (choice !== 'Apply and check') {
                return;
            }
            await this.applyValidateAndDecide(document, proposal);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.ensureResources().output.appendLine(`Refactoring refused: ${message}`);
            this.ensureResources().output.show(true);
            await vscode.window.showWarningMessage(`Junexis Mentor: ${message}`);
        }
    }

    private hasExactlyOneCurrentPipeline(): boolean {
        try {
            const build = getLatestBuild();
            if (!build?.success || !build.analysisSnapshot || !build.buildId) {
                return false;
            }
            const snapshot = parseAnalysisSnapshot(
                fs.readFileSync(build.analysisSnapshot, 'utf8'));
            return snapshot.buildId === build.buildId
                && snapshot.symbols.filter(symbol =>
                    symbol.kind.toLowerCase() === 'pipeline').length === 1;
        } catch {
            return false;
        }
    }

    private async applyValidateAndDecide(
        document: vscode.TextDocument,
        proposal: MentorRefactoringProposal,
    ): Promise<void> {
        if (document.isDirty || document.getText() !== proposal.originalContent) {
            throw new Error('The source changed after preview. Save it and create a fresh proposal.');
        }
        const applied = await replaceWholeDocument(document, proposal.updatedContent);
        if (!applied || !await document.save()) {
            throw new Error('VS Code could not save the reviewed Mentor patch.');
        }
        const { output } = this.ensureResources();
        output.appendLine(`Applied reviewed refactoring '${proposal.id}'. Running compiler validation.`);
        const validation = await this.checker.checkForRefactoring(document);
        output.appendLine(validation.message);

        if (validation.success) {
            const choice = await vscode.window.showInformationMessage(
                'Junexis compiler accepted the Mentor refactoring.',
                {
                    modal: true,
                    detail: 'Choose Keep explicitly. Closing this dialog restores the original source. No VCS action is performed.',
                },
                'Keep',
                'Revert');
            if (choice === 'Keep') {
                output.appendLine(`Kept validated refactoring '${proposal.id}'. No VCS staging or commit was performed.`);
                output.show(true);
                return;
            }
        } else {
            await vscode.window.showWarningMessage(
                validation.message,
                {
                    modal: true,
                    detail: 'The original source will now be restored. Compiler diagnostics remain visible for evidence.',
                },
                'Revert');
        }
        await this.revert(document, proposal);
    }

    private async revert(
        document: vscode.TextDocument,
        proposal: MentorRefactoringProposal,
    ): Promise<void> {
        if (document.isDirty || document.getText() !== proposal.updatedContent) {
            throw new Error('The source has later edits; refusing to overwrite them during revert.');
        }
        const reverted = await replaceWholeDocument(document, proposal.originalContent);
        if (!reverted || !await document.save()) {
            throw new Error('VS Code could not restore the original source.');
        }
        const { output } = this.ensureResources();
        output.appendLine(`Reverted refactoring '${proposal.id}'. Original source restored.`);
        output.show(true);
    }

    private async showLatestAnalysis(): Promise<void> {
        try {
            const analysis = await this.analyzeLatestBuild();
            const lines = [
                `# Junexis Mentor — build ${analysis.buildId.slice(0, 12)}`,
                '',
                `Schema: \`${analysis.schemaVersion}\``,
                '',
                'Freshness: **Current**',
                '',
                `Delta: **+${this.delta.added} new · ~${this.delta.changed} changed · ✓${this.delta.resolved} resolved · ${this.delta.unchanged} unchanged**`,
                '',
                `Snapshot: \`${analysis.snapshotPath}\``,
                '',
                ...(analysis.summary ? [
                    '## Project summary',
                    '',
                    `Tasks: **${analysis.summary.taskCount}** · Pipelines: **${analysis.summary.pipelineCount}** · Narratives: **${analysis.summary.narrativeCount}** · Platforms: **${analysis.summary.platformCount}**`,
                    '',
                ] : []),
                `Findings: **${analysis.findings.length}**`,
                '',
                ...analysis.findings.flatMap(finding => [
                    `## ${finding.code} · ${finding.severity}`,
                    '',
                    finding.message,
                    '',
                    ...(finding.explanation ? [`Why: ${finding.explanation}`, ''] : []),
                    ...(finding.recommendedAction ? [`Next action: ${finding.recommendedAction}`, ''] : []),
                    `Symbol: \`${finding.relatedSymbolId ?? 'global'}\``,
                    '',
                    `Source: \`${finding.source ? `${finding.source.file}:${finding.source.line}:${finding.source.column}` : 'not resolved'}\``,
                    '',
                ]),
                ...(analysis.insights?.length ? [
                    '# Architectural insights',
                    '',
                    ...analysis.insights.flatMap(insight => [
                        `## ${insight.kind}`,
                        '',
                        insight.summary,
                        '',
                    ]),
                ] : []),
                ...(analysis.patterns?.length ? [
                    '# Recognized patterns',
                    '',
                    ...analysis.patterns.flatMap(pattern => [
                        `## ${pattern.name} · ${(pattern.confidence * 100).toFixed(0)}%`,
                        '',
                        pattern.rationale,
                        '',
                    ]),
                ] : []),
                '# Project policy',
                '',
                ...policyMarkdown(this.policy),
            ];
            const document = await vscode.workspace.openTextDocument({
                language: 'markdown',
                content: lines.join('\n'),
            });
            await vscode.window.showTextDocument(document, vscode.ViewColumn.Beside);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const { output } = this.ensureResources();
            output.appendLine(message);
            output.show(true);
            await vscode.window.showWarningMessage(`Junexis Mentor: ${message}`);
        }
    }

    private async analyzeLatestBuild(): Promise<MentorAnalysis> {
        const build = getLatestBuild();
        if (!build?.success || !build.buildId || !build.analysisSnapshot) {
            throw new Error('Build the Junexis project first; no analysis snapshot with buildId is available.');
        }
        let raw = this.cachedRaw?.buildId === build.buildId
            ? this.cachedRaw
            : undefined;
        if (!raw) {
            const backend = resolveMentorBackend(this.context.extensionPath);
            if (backend.source === 'missing') {
                throw new Error('Mentor CLI was not found. Configure junexis.mentorPath or JUNEXIS_MENTOR_CLI.');
            }
            const args = [
                ...backend.args,
                'analyze',
                '--snapshot',
                build.analysisSnapshot,
                '--json',
            ];
            const { stdout, stderr, code } = await run(
                backend.command,
                args,
                path.dirname(build.analysisSnapshot));
            if (code !== 0) {
                throw new Error(stderr.trim() || `Mentor CLI exited with code ${code}.`);
            }
            raw = parseMentorAnalysis(stdout);
            this.cachedRaw = raw;
        }
        assertCurrentMentorAnalysis(raw, build.buildId);

        const loadedPolicy = loadProjectPolicy(build.projectRoot, raw);
        const cacheKey = `${build.buildId}\u001f${loadedPolicy.signature}`;
        if (this.cached?.buildId === build.buildId && this.cachedKey === cacheKey) {
            return this.cached;
        }
        const result = loadedPolicy.evaluation.result;
        this.delta = mentorFindingDelta(this.previous?.findings, result.findings);
        this.previous = result;
        this.cached = result;
        this.cachedKey = cacheKey;
        this.policy = loadedPolicy;
        this.publishDiagnostics(result, build.projectRoot);
        const { output } = this.ensureResources();
        output.clear();
        if (!loadedPolicy.error && loadedPolicy.evaluation.policy.presence !== 'quiet') {
            output.appendLine(`Mentor schema ${result.schemaVersion}`);
            output.appendLine(`Build ID: ${result.buildId}`);
            output.appendLine(`Freshness: Current`);
            output.appendLine(`Findings: ${result.findings.length}`);
            output.appendLine(`Suppressed by project policy: ${loadedPolicy.evaluation.appliedSuppressions.length}`);
            output.appendLine(`Delta: +${this.delta.added} new, ~${this.delta.changed} changed, ${this.delta.resolved} resolved`);
            output.appendLine(`Insights: ${result.insights?.length ?? 0}`);
            output.appendLine(`Patterns: ${result.patterns?.length ?? 0}`);
        } else if (loadedPolicy.error) {
            output.appendLine(`Invalid project Mentor policy; no finding was hidden: ${loadedPolicy.error}`);
        }
        return result;
    }

    private publishDiagnostics(analysis: MentorAnalysis, projectRoot: string): void {
        const { diagnostics } = this.ensureResources();
        diagnostics.clear();
        const grouped = new Map<string, vscode.Diagnostic[]>();
        for (const finding of analysis.findings) {
            if (!finding.source?.file) {
                continue;
            }
            const file = path.isAbsolute(finding.source.file)
                ? finding.source.file
                : path.resolve(projectRoot, finding.source.file);
            const line = Math.max(0, finding.source.line - 1);
            const column = Math.max(0, finding.source.column - 1);
            const severity = finding.severity.toLowerCase() === 'error'
                ? vscode.DiagnosticSeverity.Error
                : finding.severity.toLowerCase() === 'warning'
                    ? vscode.DiagnosticSeverity.Warning
                    : vscode.DiagnosticSeverity.Information;
            const diagnostic = new vscode.Diagnostic(
                new vscode.Range(line, column, line, column + 1),
                finding.message,
                severity);
            diagnostic.code = finding.code;
            diagnostic.source = 'Junexis Mentor';
            const bucket = grouped.get(file) ?? [];
            bucket.push(diagnostic);
            grouped.set(file, bucket);
        }
        for (const [file, diagnostics] of grouped) {
            this.diagnostics?.set(vscode.Uri.file(file), diagnostics);
        }
    }

    private ensureResources(): {
        output: vscode.OutputChannel;
        diagnostics: vscode.DiagnosticCollection;
    } {
        if (!this.output) {
            this.output = vscode.window.createOutputChannel('Junexis Mentor');
            this.context.subscriptions.push(this.output);
        }
        if (!this.diagnostics) {
            this.diagnostics = vscode.languages.createDiagnosticCollection('junexis-mentor');
            this.context.subscriptions.push(this.diagnostics);
        }
        return { output: this.output, diagnostics: this.diagnostics };
    }

    dispose(): void {
        this.cached = undefined;
        this.cachedRaw = undefined;
        this.cachedKey = undefined;
        this.previous = undefined;
        this.policy = undefined;
        this.output = undefined;
        this.diagnostics = undefined;
        this.previews.clear();
    }
}

function diagnosticCode(diagnostic: vscode.Diagnostic): string | undefined {
    if (typeof diagnostic.code === 'string' || typeof diagnostic.code === 'number') {
        return String(diagnostic.code);
    }
    return diagnostic.code?.value ? String(diagnostic.code.value) : undefined;
}

function resolveSourceFile(projectRoot: string, file: string): string {
    return path.isAbsolute(file) ? path.resolve(file) : path.resolve(projectRoot, file);
}

function sameFile(left: string, right: string): boolean {
    return process.platform === 'win32'
        ? path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
        : path.resolve(left) === path.resolve(right);
}

async function replaceWholeDocument(
    document: vscode.TextDocument,
    content: string,
): Promise<boolean> {
    const lastLine = document.lineAt(document.lineCount - 1);
    const range = new vscode.Range(
        new vscode.Position(0, 0),
        new vscode.Position(document.lineCount - 1, lastLine.text.length));
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, range, content);
    return vscode.workspace.applyEdit(edit);
}

function run(
    command: string,
    args: string[],
    cwd: string,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
    return new Promise((resolve, reject) => {
        const process = child_process.spawn(command, args, { cwd, windowsHide: true });
        let stdout = '';
        let stderr = '';
        process.stdout.on('data', chunk => { stdout += chunk.toString(); });
        process.stderr.on('data', chunk => { stderr += chunk.toString(); });
        process.on('error', reject);
        process.on('close', code => resolve({ stdout, stderr, code }));
    });
}

interface LoadedPolicy {
    path: string;
    configured: boolean;
    signature: string;
    evaluation: MentorPolicyEvaluation;
    error?: string;
}

function loadProjectPolicy(projectRoot: string, analysis: MentorAnalysis): LoadedPolicy {
    const policyPath = path.join(projectRoot, '.junexis', 'mentor.yml');
    if (!fs.existsSync(policyPath)) {
        return {
            path: policyPath,
            configured: false,
            signature: 'missing',
            evaluation: applyMentorProjectPolicy(analysis, emptyMentorProjectPolicy()),
        };
    }
    let source = '';
    try {
        source = fs.readFileSync(policyPath, 'utf8');
        const policy = parseMentorProjectPolicy(source);
        return {
            path: policyPath,
            configured: true,
            signature: source,
            evaluation: applyMentorProjectPolicy(analysis, policy),
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            path: policyPath,
            configured: true,
            signature: `invalid:${source ?? ''}:${message}`,
            evaluation: applyMentorProjectPolicy(analysis, emptyMentorProjectPolicy()),
            error: message,
        };
    }
}

function policyMarkdown(loaded: LoadedPolicy | undefined): string[] {
    if (!loaded) {
        return ['_Project policy unavailable._', ''];
    }
    if (!loaded.configured) {
        return [`_No project policy. Expected: \`${loaded.path}\`._`, ''];
    }
    if (loaded.error) {
        return [
            `**Invalid project policy; no finding was hidden.** ${loaded.error}`,
            '',
            `Path: \`${loaded.path}\``,
            '',
        ];
    }
    const { policy, appliedSuppressions } = loaded.evaluation;
    return [
        `Path: \`${loaded.path}\``,
        '',
        `Schema: \`${policy.schemaVersion}\` · Presence: \`${policy.presence ?? 'workspace default'}\``,
        '',
        `Decisions: **${policy.decisions.length}** · Suppressions: **${policy.suppressions.length}** · Applied now: **${appliedSuppressions.length}**`,
        '',
        ...(policy.decisions.length ? [
            '## Decisions',
            '',
            ...policy.decisions.flatMap(decision => [
                `### ${decision.id} · ${decision.title}`,
                '',
                decision.rationale,
                '',
                `Symbols: ${decision.relatedSymbolIds.map(id => `\`${id}\``).join(', ') || '_none_'}`,
                '',
            ]),
        ] : []),
        ...(policy.suppressions.length ? [
            '## Configured suppressions',
            '',
            ...policy.suppressions.flatMap(suppression => [
                `- \`${suppression.id}\` · \`${suppression.ruleCode}\` · \`${suppression.symbolId}\` · expires ${suppression.expiresOn ?? 'never'} — ${suppression.rationale}`,
            ]),
            '',
        ] : []),
        ...(appliedSuppressions.length ? [
            '## Applied now',
            '',
            ...appliedSuppressions.flatMap(item => [
                `### ${item.finding.code} · ${item.finding.relatedSymbolId ?? 'global'}`,
                '',
                item.finding.message,
                '',
                `Accepted by \`${item.suppression.id}\`: ${item.suppression.rationale}`,
                '',
            ]),
        ] : []),
    ];
}
