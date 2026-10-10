import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind,
} from 'vscode-languageclient/node';
import { resolveLspBackend } from './backend-discovery';
import type { PerformanceProfile } from './performance-profile';

// ─── Publiczne API ────────────────────────────────────────────────────────────

/**
 * Tworzy klienta LSP wskazującego na LspHost.
 *
 * Zwraca `null`, gdy plik wykonywalny nie istnieje — w tym przypadku
 * extension powinna działać w trybie fallback (checker.ts / CLI).
 *
 * Klient jest zarejestrowany w `context.subscriptions`, więc VS Code
 * wywoła `client.stop()` przy deaktywacji extension.
 */
function copyWorkspaceLspToShadow(context: vscode.ExtensionContext, backendPath: string): string {
    const sourceDir = path.dirname(backendPath);
    const shadowRoot = path.join(context.globalStorageUri.fsPath, 'lsp-shadow');
    const shadowDir = path.join(shadowRoot, `${Date.now()}-${process.pid}`);
    const shadowCommand = path.join(shadowDir, path.basename(backendPath));

    fs.mkdirSync(shadowRoot, { recursive: true });
    for (const entry of fs.readdirSync(shadowRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
            continue;
        }

        try {
            fs.rmSync(path.join(shadowRoot, entry.name), { recursive: true, force: true });
        } catch {
            // A previous LSP process can briefly hold its shadow copy during
            // restart/deactivation. Leaving that directory behind is safer
            // than failing extension activation.
        }
    }

    fs.mkdirSync(shadowDir, { recursive: true });
    fs.cpSync(sourceDir, shadowDir, {
        recursive: true,
        force: true,
        errorOnExist: false,
    });

    return shadowCommand;
}

export function createLspClient(
    context: vscode.ExtensionContext,
    profile?: PerformanceProfile,
): LanguageClient | null {
    const measure = <T>(name: string, action: () => T): T =>
        profile ? profile.measureSync(name, action) : action();

    const backend = measure(
        'LSP · backend discovery',
        () => resolveLspBackend(context.extensionPath),
    );
    if (backend.source === 'missing' || backend.compatibility?.compatible === false) {
        return null;
    }

    const command = backend.source === 'workspace-build' && backend.path
        ? measure(
            'LSP · shadow preparation',
            () => copyWorkspaceLspToShadow(context, backend.path!),
        )
        : backend.command;

    return measure('LSP · client construction', () => {
        const serverOptions: ServerOptions = {
            command,
            args:      backend.args,
            transport: TransportKind.stdio,
        };

        const clientOptions: LanguageClientOptions = {
            documentSelector: [{ scheme: 'file', language: 'junexis' }],
            synchronize: {
                fileEvents: vscode.workspace.createFileSystemWatcher('**/*.jnx'),
            },
        };

        const client = new LanguageClient(
            'junexis-lsp',
            'Junexis Language Server',
            serverOptions,
            clientOptions,
        );

        // Rejestracja zapewnia automatyczne zatrzymanie klienta przez VS Code
        context.subscriptions.push(client);
        return client;
    });
}
