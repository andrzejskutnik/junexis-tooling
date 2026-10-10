import * as vscode from 'vscode';
import * as child_process from 'child_process';
import * as path from 'path';
import { resolveCliBackend } from './backend-discovery';
import {
    buildOutputSummary,
    parseBuildOutput,
    type CliDiagnostic,
} from './cli-contract';
import {
    buildOutputFromReceipt,
    loadLatestBuildReceipt,
} from './latest-build-contract';
import { setLatestBuild } from './tooling-state';

// ─── Typy z wyjścia CLI ──────────────────────────────────────────────────────

interface CliOutputEnvelope {
    diagnostics?: CliDiagnostic[];
}

export interface CompilerCheckResult {
    success: boolean;
    diagnostics: CliDiagnostic[];
    message: string;
}

// ─── Rozpoznawanie CLI ────────────────────────────────────────────────────────

type CliKind = 'exe' | 'dll' | 'project' | 'missing';

interface CliInfo {
    kind: CliKind;
    /** Wartość przekazywana do child_process: albo ścieżka exe, albo "dotnet" */
    command: string;
    /** Argumenty przed nazwą pliku wejściowego — np. ['path/to/dll'] dla DLL */
    prefixArgs: string[];
}

function resolveCliInfo(extensionPath?: string): CliInfo | null {
    const backend = resolveCliBackend(extensionPath);
    if (backend.source === 'missing') {
        return null;
    }

    if (backend.args[0] === 'run') {
        return { kind: 'project', command: backend.command, prefixArgs: backend.args };
    }

    return {
        kind: backend.command === 'dotnet' ? 'dll' : 'exe',
        command: backend.command,
        prefixArgs: backend.args,
    };
}

// ─── Klasa główna ─────────────────────────────────────────────────────────────

const DEBOUNCE_MS = 600;

export class JunexisChecker {
    private readonly _collection: vscode.DiagnosticCollection;
    private _debounce: ReturnType<typeof setTimeout> | undefined;
    private _outputChannel: vscode.OutputChannel;

    constructor(
        collection: vscode.DiagnosticCollection,
        private readonly extensionPath?: string,
    ) {
        this._collection = collection;
        this._outputChannel = vscode.window.createOutputChannel('Junexis');
    }

    // ── Sprawdź z debounce ────────────────────────────────────────────────

    checkDebounced(doc: vscode.TextDocument): void {
        this._clearDebounce();
        this._debounce = setTimeout(() => this.checkNow(doc), DEBOUNCE_MS);
    }

    // ── Sprawdź natychmiast ───────────────────────────────────────────────

    checkNow(doc: vscode.TextDocument, publishDiagnostics = true): void {
        if (doc.isUntitled) {
            // Plik niezapisany — nie da się przekazać ścieżki do CLI
            this._collection.delete(doc.uri);
            return;
        }

        const cli = resolveCliInfo(this.extensionPath);
        if (!cli) {
            this._warnNoCli();
            return;
        }

        const args = [...cli.prefixArgs, 'check', '--json', doc.fileName];
        this._run(cli.command, args, doc.uri, true, undefined, undefined, !publishDiagnostics, publishDiagnostics);
    }

    /** Compiler-backed validation used by reviewed Mentor refactorings. */
    async checkForRefactoring(doc: vscode.TextDocument): Promise<CompilerCheckResult> {
        if (doc.isUntitled || doc.isDirty) {
            return {
                success: false,
                diagnostics: [],
                message: 'The refactored document must be saved before compiler validation.',
            };
        }
        const cli = resolveCliInfo(this.extensionPath);
        if (!cli) {
            return {
                success: false,
                diagnostics: [],
                message: 'Junexis CLI was not found.',
            };
        }
        const args = [...cli.prefixArgs, 'check', '--json', doc.fileName];
        return new Promise(resolve => {
            const proc = child_process.spawn(cli.command, args, {
                cwd: path.dirname(doc.fileName),
                windowsHide: true,
            });
            let stdout = '';
            let stderr = '';
            let settled = false;
            proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
            proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
            proc.on('error', (error: Error) => {
                if (settled) { return; }
                settled = true;
                resolve({ success: false, diagnostics: [], message: error.message });
            });
            proc.on('close', (code: number | null) => {
                if (settled) { return; }
                settled = true;
                const text = stdout.trim() ? stdout : stderr;
                const parsedDiagnostics = parseCheckDiagnostics(text);
                const diagnostics = parsedDiagnostics ?? [];
                this._applyDiagnostics(doc.uri, text);
                this._outputChannel.clear();
                if (stdout.trim()) { this._outputChannel.appendLine(stdout.trim()); }
                if (stderr.trim()) { this._outputChannel.appendLine(stderr.trim()); }
                this._outputChannel.show(true);
                const hasErrors = diagnostics.some(item => item.level === 'error');
                const supportedResult = parsedDiagnostics !== undefined;
                resolve({
                    success: code === 0 && supportedResult && !hasErrors,
                    diagnostics,
                    message: code === 0 && supportedResult && !hasErrors
                        ? 'Compiler check accepted the change.'
                        : supportedResult
                            ? `Compiler check rejected the change with ${diagnostics.length} diagnostic(s).`
                            : 'Compiler check returned an unsupported result; the change cannot be kept.',
                });
            });
        });
    }

    // ── Sprawdź projekt ─────────────────────────────────────────────────

    checkProject(projectRoot: string, activeFile?: string, publishDiagnostics = true): void {
        const cli = resolveCliInfo(this.extensionPath);
        if (!cli) {
            this._warnNoCli();
            return;
        }

        const fallbackUri = vscode.Uri.file(activeFile ?? projectRoot);
        const args = [...cli.prefixArgs, 'check', '--json', projectRoot];

        vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Junexis: sprawdzanie projektu ${path.basename(projectRoot)}…`,
                cancellable: false
            },
            () => new Promise<void>(resolve => {
                this._run(cli.command, args, fallbackUri, true, resolve, projectRoot, true, publishDiagnostics);
            })
        );
    }

    // ── Kompiluj ─────────────────────────────────────────────────────────

    compile(doc: vscode.TextDocument): void {
        if (doc.isUntitled) {
            vscode.window.showWarningMessage('Zapisz plik przed kompilacją.');
            return;
        }

        const cli = resolveCliInfo(this.extensionPath);
        if (!cli) {
            this._warnNoCli();
            return;
        }

        const outDir = path.join(path.dirname(doc.fileName), 'output');
        const args = [
            ...cli.prefixArgs,
            'build',
            doc.fileName,
            '--out',
            outDir,
            '--json',
            '--output-schema',
            '2.0',
        ];

        vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Junexis: kompilacja ${path.basename(doc.fileName)}…`,
                cancellable: false
            },
            () => new Promise<void>(resolve => {
                this._runBuild(cli.command, args, path.dirname(doc.fileName), doc.uri, resolve);
            })
        );
    }

    // ── Zbuduj projekt ──────────────────────────────────────────────────

    buildProject(projectRoot: string): void {
        const cli = resolveCliInfo(this.extensionPath);
        if (!cli) {
            this._warnNoCli();
            return;
        }

        const args = [
            ...cli.prefixArgs,
            'build',
            projectRoot,
            '--json',
            '--output-schema',
            '2.0',
        ];

        vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Junexis: build projektu ${path.basename(projectRoot)}…`,
                cancellable: false
            },
            () => new Promise<void>(resolve => {
                this._runBuild(cli.command, args, projectRoot, vscode.Uri.file(projectRoot), resolve);
            })
        );
    }

    // ── Wygeneruj szkielety extern ──────────────────────────────────────

    scaffoldExterns(projectRoot: string): void {
        const cli = resolveCliInfo(this.extensionPath);
        if (!cli) {
            this._warnNoCli();
            return;
        }

        const args = [...cli.prefixArgs, 'extern', 'scaffold', projectRoot];

        vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Junexis: extern scaffold projektu ${path.basename(projectRoot)}…`,
                cancellable: false
            },
            () => new Promise<void>(resolve => {
                this._runRaw(cli.command, args, projectRoot, resolve, 'extern scaffold');
            })
        );
    }

    // ── Wyczyść projekt ─────────────────────────────────────────────────

    cleanProject(projectRoot: string): void {
        const cli = resolveCliInfo(this.extensionPath);
        if (!cli) {
            this._warnNoCli();
            return;
        }

        const args = [...cli.prefixArgs, 'clean', projectRoot];

        vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Junexis: clean projektu ${path.basename(projectRoot)}…`,
                cancellable: false
            },
            () => new Promise<void>(resolve => {
                this._runRaw(cli.command, args, projectRoot, resolve, 'clean');
            })
        );
    }

    // ── Doctor ───────────────────────────────────────────────────────────

    doctor(targetPath: string, workingDirectory: string): void {
        const cli = resolveCliInfo(this.extensionPath);
        if (!cli) {
            this._warnNoCli();
            return;
        }

        const args = [...cli.prefixArgs, 'doctor', targetPath];
        vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Junexis: doctor ${path.basename(targetPath)}…`,
                cancellable: false
            },
            () => new Promise<void>(resolve => {
                this._runRaw(cli.command, args, workingDirectory, resolve, 'doctor');
            })
        );
    }

    // ── Wewnętrzne uruchomienie procesu ───────────────────────────────────

    private _run(
        command: string,
        args: string[],
        uri: vscode.Uri,
        showOutput: boolean,
        onDone?: () => void,
        workingDirectory?: string,
        clearAllDiagnostics = false,
        publishDiagnostics = true
    ): void {
        const proc = child_process.spawn(command, args, {
            cwd: workingDirectory ?? path.dirname(uri.fsPath)
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
        proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

        proc.on('error', (err: Error) => {
            // Nie możemy uruchomić procesu — cicho łykamy tylko gdy użytkownik nie skonfigurował ścieżki
            const cfg = vscode.workspace.getConfiguration('junexis');
            if (cfg.get<string>('cliPath', '').trim()) {
                vscode.window.showErrorMessage(`Junexis CLI: ${err.message}`);
            }
            onDone?.();
        });

        proc.on('close', () => {
            if (showOutput && (stdout || stderr)) {
                this._outputChannel.clear();
                if (stdout) { this._outputChannel.appendLine(stdout); }
                if (stderr) { this._outputChannel.appendLine(stderr); }
                this._outputChannel.show(true);
            }

            if (clearAllDiagnostics) {
                this._collection.clear();
            }

            // Parsuj diagnostyki z JSON; fallback na stderr jeśli stdout jest pusty
            if (publishDiagnostics) {
                this._applyDiagnostics(uri, stdout.trim() ? stdout : stderr);
            }
            onDone?.();
        });
    }

    private _runRaw(
        command: string,
        args: string[],
        workingDirectory: string,
        onDone?: () => void,
        label = 'command'
    ): void {
        const proc = child_process.spawn(command, args, {
            cwd: workingDirectory,
            windowsHide: true
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
        proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

        proc.on('error', (err: Error) => {
            vscode.window.showErrorMessage(`Junexis CLI: ${err.message}`);
            onDone?.();
        });

        proc.on('close', (code: number | null) => {
            this._outputChannel.clear();
            if (stdout) { this._outputChannel.appendLine(stdout); }
            if (stderr) { this._outputChannel.appendLine(stderr); }
            if (!stdout && !stderr) {
                this._outputChannel.appendLine(`junexis ${label} exited with code ${code ?? 'unknown'} and produced no output.`);
            }
            this._outputChannel.show(true);

            if (code && code !== 0) {
                void vscode.window.showWarningMessage(`Junexis ${label} zakończył się kodem ${code}. Szczegóły są w kanale Junexis.`);
            }

            onDone?.();
        });
    }

    private _runBuild(
        command: string,
        args: string[],
        workingDirectory: string,
        fallbackUri: vscode.Uri,
        onDone?: () => void
    ): void {
        const proc = child_process.spawn(command, args, {
            cwd: workingDirectory,
            windowsHide: true
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
        proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

        proc.on('error', (err: Error) => {
            vscode.window.showErrorMessage(`Junexis CLI: ${err.message}`);
            onDone?.();
        });

        proc.on('close', async (code: number | null) => {
            this._outputChannel.clear();
            try {
                const result = parseBuildOutput(stdout);
                for (const line of buildOutputSummary(result)) {
                    this._outputChannel.appendLine(line);
                }
                if (stderr.trim()) {
                    this._outputChannel.appendLine('');
                    this._outputChannel.appendLine(stderr.trim());
                }

                this._applyDiagnostics(fallbackUri, stdout, true);
                if (result.success && (code === null || code === 0)) {
                    if (!result.latestBuildReceipt) {
                        throw new Error(
                            'A successful build did not publish latestBuildReceipt. Update the Junexis compiler.');
                    }
                    const receipt = await loadLatestBuildReceipt(result.latestBuildReceipt);
                    setLatestBuild(buildOutputFromReceipt(receipt, result));
                    this._outputChannel.appendLine('');
                    this._outputChannel.appendLine(
                        `Verified latest-build 1.0: ${receipt.receiptPath}`);
                } else {
                    void vscode.window.showWarningMessage(
                        `Junexis build nie powiódł się. Szczegóły są w kanale Junexis.`);
                }
            } catch (error) {
                this._outputChannel.appendLine(
                    `Cannot read Junexis build contract: ${error instanceof Error ? error.message : String(error)}`);
                if (stdout.trim()) {
                    this._outputChannel.appendLine('');
                    this._outputChannel.appendLine(stdout.trim());
                }
                if (stderr.trim()) {
                    this._outputChannel.appendLine('');
                    this._outputChannel.appendLine(stderr.trim());
                }
                void vscode.window.showErrorMessage(
                    'Junexis build returned an unsupported result. See the Junexis Output channel.');
            }
            this._outputChannel.show(true);
            onDone?.();
        });
    }

    // ── Parsowanie JSON → vscode.Diagnostic ─────────────────────────────

    private _applyDiagnostics(uri: vscode.Uri, jsonOutput: string, clearAllDiagnostics = false): void {
        if (clearAllDiagnostics) {
            this._collection.clear();
        }

        if (!jsonOutput.trim()) {
            this._collection.set(uri, []);
            return;
        }

        let cliDiags: CliDiagnostic[];
        try {
            const parsed = JSON.parse(jsonOutput) as CliDiagnostic[] | CliOutputEnvelope;
            cliDiags = Array.isArray(parsed)
                ? parsed
                : parsed.diagnostics ?? [];
        } catch {
            // Wyjście nie jest JSON — nic nie robimy z diagnostykami
            this._collection.set(uri, []);
            return;
        }

        const diagnosticsByFile = new Map<string, { uri: vscode.Uri; diagnostics: vscode.Diagnostic[] }>();

        for (const d of cliDiags) {
            // Linie CLI są 1-based, VS Code 0-based
            const line   = Math.max(0, (d.line   || 1) - 1);
            const column = Math.max(0, (d.column || 1) - 1);
            const range  = new vscode.Range(line, column, line, column + 1);

            const severity = d.level === 'error'
                ? vscode.DiagnosticSeverity.Error
                : d.level === 'warning'
                    ? vscode.DiagnosticSeverity.Warning
                    : vscode.DiagnosticSeverity.Information;

            const msg = d.code
                ? `[${d.code}] ${d.message}`
                : d.message;

            const vsDiag = new vscode.Diagnostic(range, msg, severity);
            vsDiag.source = 'junexis';
            if (d.code) {
                vsDiag.code = {
                    value: d.code,
                    target: vscode.Uri.parse(
                        `https://junexis.dev/docs/diagnostics/${d.code}`
                    )
                };
            }

            const diagnosticUri = d.file
                ? vscode.Uri.file(d.file)
                : uri;
            const key = diagnosticUri.toString();
            const bucket = diagnosticsByFile.get(key)
                ?? { uri: diagnosticUri, diagnostics: [] };
            bucket.diagnostics.push(vsDiag);
            diagnosticsByFile.set(key, bucket);
        }

        if (diagnosticsByFile.size === 0) {
            this._collection.set(uri, []);
            return;
        }

        for (const bucket of diagnosticsByFile.values()) {
            this._collection.set(bucket.uri, bucket.diagnostics);
        }
    }

    // ── Ostrzeżenie o braku CLI ────────────────────────────────────────────

    private _hasSentCliWarning = false;

    private _warnNoCli(): void {
        if (this._hasSentCliWarning) { return; }
        this._hasSentCliWarning = true;

        vscode.window.showWarningMessage(
            'Junexis CLI nie znaleziony. Skonfiguruj ścieżkę w ustawieniach.',
            'Otwórz ustawienia'
        ).then((choice: string | undefined) => {
            if (choice === 'Otwórz ustawienia') {
                vscode.commands.executeCommand(
                    'workbench.action.openSettings',
                    'junexis.cliPath'
                );
            }
        });
    }

    resetFallbackState(): void {
        this._clearDebounce();
        this._collection.clear();
    }

    private _clearDebounce(): void {
        if (!this._debounce) {
            return;
        }

        clearTimeout(this._debounce);
        this._debounce = undefined;
    }

    dispose(): void {
        this._clearDebounce();
        this._outputChannel.dispose();
        this._collection.dispose();
    }
}

function parseCheckDiagnostics(jsonOutput: string): CliDiagnostic[] | undefined {
    if (!jsonOutput.trim()) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(jsonOutput) as CliDiagnostic[] | CliOutputEnvelope;
        return Array.isArray(parsed) ? parsed : parsed.diagnostics ?? [];
    } catch {
        return undefined;
    }
}
