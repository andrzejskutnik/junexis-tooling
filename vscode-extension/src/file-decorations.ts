import * as vscode from 'vscode';
import * as path from 'path';

type DecorationSpec = {
    readonly badge: string;
    readonly tooltip: string;
    readonly color: vscode.ThemeColor;
};

const folderDecorations = new Map<string, DecorationSpec>([
    ['src', {
        badge: 'J',
        tooltip: 'Junexis source folder',
        color: new vscode.ThemeColor('charts.green')
    }],
    ['user', {
        badge: 'U',
        tooltip: 'Junexis developer-owned code',
        color: new vscode.ThemeColor('charts.green')
    }],
    ['out', {
        badge: 'G',
        tooltip: 'Junexis generated artifacts',
        color: new vscode.ThemeColor('charts.orange')
    }],
    ['.junexis', {
        badge: 'J',
        tooltip: 'Junexis tool state',
        color: new vscode.ThemeColor('charts.blue')
    }],
    ['embedded', {
        badge: 'E',
        tooltip: 'Junexis embedded target',
        color: new vscode.ThemeColor('charts.yellow')
    }],
    ['server', {
        badge: 'S',
        tooltip: 'Junexis server target',
        color: new vscode.ThemeColor('charts.blue')
    }],
    ['report', {
        badge: 'R',
        tooltip: 'Junexis report target',
        color: new vscode.ThemeColor('charts.purple')
    }],
    ['cache', {
        badge: 'C',
        tooltip: 'Junexis cache',
        color: new vscode.ThemeColor('charts.blue')
    }],
    ['build', {
        badge: 'B',
        tooltip: 'Junexis build scratch',
        color: new vscode.ThemeColor('charts.purple')
    }],
    ['diagnostics', {
        badge: '!',
        tooltip: 'Junexis diagnostics',
        color: new vscode.ThemeColor('charts.red')
    }],
]);

function fileDecoration(name: string): DecorationSpec | undefined {
    const lower = name.toLowerCase();
    if (lower.endsWith('.jnx')) {
        return {
            badge: 'J',
            tooltip: 'Junexis source file',
            color: new vscode.ThemeColor('charts.green')
        };
    }

    if (lower === 'junexis.project.toml' || lower === 'junexis.toml') {
        return {
            badge: '◆',
            tooltip: 'Junexis project manifest',
            color: new vscode.ThemeColor('charts.orange')
        };
    }

    return undefined;
}

class JunexisFileDecorationProvider implements vscode.FileDecorationProvider {
    readonly onDidChangeFileDecorations?: vscode.Event<vscode.Uri | vscode.Uri[] | undefined>;

    provideFileDecoration(uri: vscode.Uri): vscode.ProviderResult<vscode.FileDecoration> {
        if (uri.scheme !== 'file') {
            return undefined;
        }

        const name = path.basename(uri.fsPath);
        const spec = fileDecoration(name) ?? folderDecorations.get(name);
        if (!spec) {
            return undefined;
        }

        return new vscode.FileDecoration(spec.badge, spec.tooltip, spec.color);
    }
}

export function registerJunexisFileDecorations(): vscode.Disposable {
    return vscode.window.registerFileDecorationProvider(new JunexisFileDecorationProvider());
}
