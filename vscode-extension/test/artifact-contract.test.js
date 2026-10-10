const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { parseArtifactInventory } = require('../out/artifact-contract.js');

function manifest(artifactPath = 'server/main.go', overrides = {}) {
    return JSON.stringify({
        schemaVersion: '1.0',
        buildId: 'build-1',
        artifacts: [{
            path: artifactPath,
            target: 'server',
            kind: 'source',
            ownership: 'generated',
            sha256: 'abc',
        }],
        ...overrides,
    });
}

test('JSPI-001 artifact inventory resolves paths inside the output root', () => {
    const outputRoot = path.join(path.parse(process.cwd()).root, 'project', 'out');
    const inventory = parseArtifactInventory(
        manifest(),
        path.join(outputRoot, 'junexis.artifacts.json'));

    assert.equal(inventory.buildId, 'build-1');
    assert.equal(inventory.items[0].relativePath, 'server/main.go');
    assert.equal(
        inventory.items[0].fullPath,
        path.join(outputRoot, 'server', 'main.go'));
});

test('JSPI-001 artifact inventory rejects traversal and rooted paths', () => {
    assert.throws(
        () => parseArtifactInventory(manifest('../secret.txt'), path.join('out', 'junexis.artifacts.json')),
        /escapes output root/);
    assert.throws(
        () => parseArtifactInventory(manifest(path.resolve('secret.txt')), path.join('out', 'junexis.artifacts.json')),
        /Unsafe artifact path/);
});

test('JSPI-001 artifact inventory rejects unsupported schema and incomplete entries', () => {
    assert.throws(
        () => parseArtifactInventory(manifest('server/main.go', { schemaVersion: '2.0' }), 'out/junexis.artifacts.json'),
        /Expected major version 1/);
    assert.throws(
        () => parseArtifactInventory(JSON.stringify({
            schemaVersion: '1.0',
            buildId: 'build-1',
            artifacts: [{ path: 'server/main.go' }],
        }), 'out/junexis.artifacts.json'),
        /incomplete/);
});
