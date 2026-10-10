import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import { resolveCliBackend } from './backend-discovery';
import { discoverJunexisProjectContext } from './project-discovery';
import { CliLines, parsePanelReady } from './panel-readiness';

/** Owns one public CLI application session; artifact target commands remain separate. */
export function registerApplicationSession(context: vscode.ExtensionContext): vscode.Disposable {
    const output = vscode.window.createOutputChannel('Junexis Application');
    let active: ChildProcess | undefined;
    let panel: string | undefined;
    let stopping = false;
    let disposed = false;
    const stop = () => {
        if (!active || stopping) return;
        stopping = true;
        panel = undefined;
        const pid = active.pid;
        if (!pid) return;
        output.appendLine('Zatrzymywanie aplikacji…');
        if (process.platform === 'win32') {
            const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
            killer.on('error', error => { stopping = false; if (!disposed) output.appendLine(`Stop: ${error.message}`); });
            killer.on('exit', code => { if (code && active?.pid === pid) { stopping = false; output.appendLine(`Stop: taskkill exit ${code}`); } });
        } else {
            try { process.kill(-pid, 'SIGTERM'); }
            catch (error) { stopping = false; output.appendLine(`Stop: ${String(error)}`); }
        }
    };
    const commands = [
        vscode.commands.registerCommand('junexis.application.run', async () => {
            if (active) { void vscode.window.showWarningMessage('Sesja już działa. Zatrzymaj ją przed ponownym uruchomieniem.'); return; }
            const project = discoverJunexisProjectContext(vscode.window.activeTextEditor?.document);
            if (!project.projectRoot) { void vscode.window.showWarningMessage('Otwórz zapisany plik projektu z junexis.project.toml.'); return; }
            if (!await vscode.workspace.saveAll(false) || active || disposed) return;
            const cli = resolveCliBackend(context.extensionPath);
            if (cli.source === 'missing') { void vscode.window.showErrorMessage('Nie znaleziono CLI Junexis. Sprawdź konfigurację rozszerzenia.'); return; }
            panel = undefined; stopping = false;
            output.clear(); output.show(true);
            output.appendLine('Budowanie i uruchamianie aplikacji…');
            const child = spawn(cli.command, [...cli.args, 'run', project.projectRoot, '--duration', '300', '--no-open'], {
                cwd: project.projectRoot, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe']
            });
            active = child;
            const lines = new CliLines(line => {
                if (!disposed) output.appendLine(line);
                if (active !== child || stopping || disposed || panel) return;
                const ready = parsePanelReady(line);
                if (!ready) return;
                panel = ready.url;
                void vscode.env.openExternal(vscode.Uri.parse(panel));
            });
            child.stdout!.setEncoding('utf8');
            child.stdout!.on('data', (chunk: string) => lines.push(chunk));
            child.stderr!.setEncoding('utf8');
            child.stderr!.on('data', (chunk: string) => { if (!disposed) output.append(chunk); });
            child.on('error', error => { if (!disposed) output.appendLine(`Nie udało się uruchomić CLI: ${error.message}`); });
            child.on('close', code => {
                if (active !== child) return;
                const wasStopped = stopping;
                active = undefined; panel = undefined; stopping = false;
                if (!disposed) {
                    output.appendLine(wasStopped ? 'Sesja zatrzymana.' : `Sesja zakończona: ${code}.`);
                    if (!wasStopped && code !== 0) void vscode.window.showErrorMessage('Uruchomienie nie powiodło się. Szczegóły: Junexis Application.');
                }
            });
        }),
        vscode.commands.registerCommand('junexis.application.open', () => {
            if (panel && !stopping) return vscode.env.openExternal(vscode.Uri.parse(panel));
            void vscode.window.showInformationMessage('Panel nie ma jeszcze gotowego adresu.');
        }),
        vscode.commands.registerCommand('junexis.application.stop', stop)
    ];
    return new vscode.Disposable(() => { disposed = true; stop(); commands.forEach(command => command.dispose()); output.dispose(); });
}
