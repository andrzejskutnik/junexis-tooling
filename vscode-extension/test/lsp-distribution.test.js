const assert = require('node:assert/strict');
const test = require('node:test');
const {
    checkLspCompatibility,
    currentRuntimeIdentifier,
    parseLspDistributionManifest,
} = require('../out/lsp-distribution.js');

function manifest(overrides = {}) {
    return JSON.stringify({
        schemaVersion: 1,
        name: 'JunexisLang.Compiler.LspHost',
        version: '0.1.0',
        protocolVersion: 1,
        runtimeIdentifier: 'win-x64',
        entrypoint: 'JunexisLang.Compiler.LspHost.exe',
        readyToRun: true,
        selfContained: false,
        ...overrides,
    });
}

test('distribution manifest validates identity, runtime and protocol', () => {
    const parsed = parseLspDistributionManifest(manifest(), 'win-x64');

    assert.equal(parsed.version, '0.1.0');
    assert.deepEqual(checkLspCompatibility(parsed), {
        compatible: true,
        message: 'protocol 1 compatible',
    });
    assert.equal(currentRuntimeIdentifier('win32', 'x64'), 'win-x64');
    assert.equal(currentRuntimeIdentifier('linux', 'x64'), 'linux-x64');
    assert.equal(currentRuntimeIdentifier('darwin', 'arm64'), 'osx-arm64');
    assert.throws(() => currentRuntimeIdentifier('linux', 'arm64'), /macierzy wydania/);
});

test('distribution manifest rejects traversal and a wrong runtime', () => {
    assert.throws(
        () => parseLspDistributionManifest(manifest({ entrypoint: '../host.exe' }), 'win-x64'),
        /entrypoint/,
    );
    assert.throws(
        () => parseLspDistributionManifest(manifest(), 'linux-x64'),
        /does not match/,
    );
});

test('distribution compatibility rejects another protocol version', () => {
    const parsed = parseLspDistributionManifest(
        manifest({ protocolVersion: 2 }),
        'win-x64',
    );

    assert.deepEqual(checkLspCompatibility(parsed), {
        compatible: false,
        message: 'protocol 2 is incompatible; expected 1',
    });
});
