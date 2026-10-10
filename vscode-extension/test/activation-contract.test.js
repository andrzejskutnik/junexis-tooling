const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const manifestPath = path.join(__dirname, '..', 'package.json');
const mentorSourcePath = path.join(__dirname, '..', 'src', 'mentor.ts');
const debugSourcePath = path.join(__dirname, '..', 'src', 'debug-ui.ts');
const backendDiscoverySourcePath = path.join(__dirname, '..', 'src', 'backend-discovery.ts');

test('extension activates for Junexis context instead of every VS Code startup', () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const events = manifest.activationEvents ?? [];

    assert.ok(events.includes('onLanguage:junexis'));
    assert.ok(events.includes('workspaceContains:**/junexis.project.toml'));
    assert.ok(!events.includes('onStartupFinished'));
});

test('commands and views can activate the extension on demand', () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    assert.ok(manifest.engines.vscode.startsWith('^1.85'));
    assert.ok(manifest.contributes.commands.some(({ command }) => command === 'junexis.diagnoseSetup'));
    assert.ok(manifest.contributes.commands.some(({ command }) => command === 'junexis.debug.startCurrentBuild'));
    assert.ok(manifest.contributes.configuration.properties['junexis.debug.traceCollectorPath']);
    assert.ok(manifest.contributes.views.explorer.some(({ id }) => id === 'junexisArtifacts'));
    assert.ok(manifest.contributes.views.debug.some(({ id }) => id === 'junexisNativeDebug'));
    assert.deepEqual(
        manifest.contributes.configuration.properties['junexis.languageServicesStartup'].enum,
        ['project', 'document'],
    );
    assert.equal(
        manifest.contributes.configuration.properties['junexis.languageServicesStartup'].default,
        'project',
    );
});

test('current-build debug command launches TraceCollector with the verified manifest', () => {
    const source = fs.readFileSync(debugSourcePath, 'utf8');

    assert.match(source, /const build = getLatestBuild\(\)/);
    assert.match(source, /!build\.debugManifest \|\| !build\.latestBuildReceipt/);
    assert.match(source, /'--manifest',\s*build\.debugManifest/);
    assert.match(source, /'--host',\s*host/);
    assert.match(source, /client\.startSession\(/);
    assert.match(source, /resolveBundledTraceCollector\(context\.extensionPath\)/);
});

test('bundled CLI, LSP and Mentor distributions are resolved only by matching backends', () => {
    const source = fs.readFileSync(backendDiscoverySourcePath, 'utf8');
    const cliResolver = source.match(
        /export function resolveCliBackend[\s\S]*?(?=export function resolveLspBackend)/,
    )?.[0] ?? '';
    const lspResolver = source.match(
        /export function resolveLspBackend[\s\S]*?(?=export function resolveMentorBackend)/,
    )?.[0] ?? '';
    const mentorResolver = source.match(
        /export function resolveMentorBackend[\s\S]*$/,
    )?.[0] ?? '';

    assert.match(cliResolver, /resolveBundledCli\(extensionPath\)/);
    assert.doesNotMatch(cliResolver, /bundledLspBackend\(extensionPath\)/);
    assert.match(lspResolver, /bundledLspBackend\(extensionPath\)/);
    assert.doesNotMatch(lspResolver, /resolveBundledCli\(extensionPath\)/);
    assert.match(mentorResolver, /resolveBundledMentor\(extensionPath\)/);
    assert.doesNotMatch(mentorResolver, /resolveBundledCli\(extensionPath\)/);
    assert.doesNotMatch(mentorResolver, /bundledLspBackend\(extensionPath\)/);
});

test('Mentor diagnostic actions are quick fixes and preserve the selected rule code', () => {
    const source = fs.readFileSync(mentorSourcePath, 'utf8');

    assert.match(
        source,
        /providedCodeActionKinds:\s*\[vscode\.CodeActionKind\.QuickFix\]/,
    );
    assert.match(
        source,
        /new vscode\.CodeAction\([\s\S]*?vscode\.CodeActionKind\.QuickFix\)/,
    );
    assert.match(
        source,
        /\(uri: vscode\.Uri, line: number, ruleCode\?: string\)\s*=>\s*this\.previewRefactoring\(uri, line, ruleCode\)/,
    );
});
