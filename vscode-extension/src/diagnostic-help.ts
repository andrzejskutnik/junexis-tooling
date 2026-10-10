import * as vscode from 'vscode';

const DOCS_BASE_URL = 'https://junexis.dev/docs/diagnostics/';

function diagnosticCodeValue(code: vscode.Diagnostic['code']): string | undefined {
    if (!code) {
        return undefined;
    }

    if (typeof code === 'string' || typeof code === 'number') {
        return String(code);
    }

    return code.value ? String(code.value) : undefined;
}

function diagnosticHelpUri(code: string): vscode.Uri {
    return vscode.Uri.parse(`${DOCS_BASE_URL}${encodeURIComponent(code)}`);
}

export function registerDiagnosticHelp(context: vscode.ExtensionContext): vscode.Disposable {
    const selector: vscode.DocumentSelector = { language: 'junexis', scheme: 'file' };

    return vscode.Disposable.from(
        vscode.commands.registerCommand('junexis.openDiagnosticHelp', async (code?: string) => {
            if (!code) {
                await vscode.window.showInformationMessage('Junexis: nie znaleziono kodu diagnostyki.');
                return;
            }

            await vscode.env.openExternal(diagnosticHelpUri(code));
        }),

        vscode.languages.registerCodeActionsProvider(selector, {
            provideCodeActions(_document, _range, context) {
                const actions: vscode.CodeAction[] = [];
                const seen = new Set<string>();

                for (const diagnostic of context.diagnostics) {
                    if (diagnostic.source !== 'junexis') {
                        continue;
                    }

                    const code = diagnosticCodeValue(diagnostic.code);
                    if (!code || seen.has(code)) {
                        continue;
                    }

                    seen.add(code);

                    const action = new vscode.CodeAction(
                        `Open Junexis diagnostic help: ${code}`,
                        vscode.CodeActionKind.QuickFix
                    );
                    action.diagnostics = [diagnostic];
                    action.isPreferred = false;
                    action.command = {
                        command: 'junexis.openDiagnosticHelp',
                        title: `Open Junexis diagnostic help: ${code}`,
                        arguments: [code]
                    };

                    actions.push(action);
                }

                return actions;
            }
        }, {
            providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
        })
    );
}
