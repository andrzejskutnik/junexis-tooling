const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
    parseCliDistributionManifest,
    resolveBundledCli,
} = require('../out/cli-distribution.js');

function manifest(overrides = {}) {
    return JSON.stringify({
        schemaVersion: 1,
        name: 'JunexisLang.Compiler.CLI',
        version: '0.1.0',
        protocolVersion: 2,
        runtimeIdentifier: 'win-x64',
        entrypoint: 'JunexisLang.Compiler.CLI.exe',
        readyToRun: true,
        selfContained: true,
        ...overrides,
    });
}

test('CLI distribution validates build protocol 2 and runtime identity', () => {
    const parsed = parseCliDistributionManifest(manifest(), 'win-x64');

    assert.equal(parsed.name, 'JunexisLang.Compiler.CLI');
    assert.equal(parsed.protocolVersion, 2);
    assert.equal(parsed.selfContained, true);
});

test('CLI distribution rejects traversal and incompatible build protocol', () => {
    assert.throws(
        () => parseCliDistributionManifest(manifest({ entrypoint: '../cli.exe' }), 'win-x64'),
        /entrypoint/,
    );
    assert.throws(
        () => parseCliDistributionManifest(manifest({ protocolVersion: 1 }), 'win-x64'),
        /incompatible/,
    );
});

test('bundled CLI resolves from runtime cli RID directory', t => {
    const extensionPath = fs.mkdtempSync(path.join(os.tmpdir(), 'junexis-cli-distribution-'));
    t.after(() => fs.rmSync(extensionPath, { recursive: true, force: true }));
    const directory = path.join(extensionPath, 'runtime', 'cli', 'win-x64');
    fs.mkdirSync(directory, { recursive: true });
    const entrypoint = path.join(directory, 'JunexisLang.Compiler.CLI.exe');
    fs.writeFileSync(entrypoint, 'test');
    fs.writeFileSync(path.join(directory, 'junexis-cli.json'), manifest());

    const resolved = resolveBundledCli(extensionPath);

    assert.equal(resolved.command, entrypoint);
});
