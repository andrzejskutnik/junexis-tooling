const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { currentRuntimeIdentifier } = require('../out/lsp-distribution.js');
const {
    parseMentorDistributionManifest,
    resolveBundledMentor,
} = require('../out/mentor-distribution.js');

function manifest(overrides = {}) {
    return JSON.stringify({
        schemaVersion: 1,
        name: 'JunexisLang.Mentor.CLI',
        version: '0.1.0',
        protocolVersion: 1,
        runtimeIdentifier: 'win-x64',
        entrypoint: 'JunexisLang.Mentor.CLI.exe',
        readyToRun: true,
        selfContained: true,
        ...overrides,
    });
}

test('Mentor distribution validates analysis protocol 1 and runtime identity', () => {
    const parsed = parseMentorDistributionManifest(manifest(), 'win-x64');

    assert.equal(parsed.name, 'JunexisLang.Mentor.CLI');
    assert.equal(parsed.protocolVersion, 1);
    assert.equal(parsed.selfContained, true);
});

test('Mentor distribution rejects traversal and incompatible protocol', () => {
    assert.throws(
        () => parseMentorDistributionManifest(manifest({ entrypoint: '../mentor.exe' }), 'win-x64'),
        /entrypoint/,
    );
    assert.throws(
        () => parseMentorDistributionManifest(manifest({ protocolVersion: 2 }), 'win-x64'),
        /incompatible/,
    );
});

test('bundled Mentor resolves from runtime mentor RID directory', t => {
    const runtimeIdentifier = currentRuntimeIdentifier();
    const extensionPath = fs.mkdtempSync(path.join(os.tmpdir(), 'junexis-mentor-distribution-'));
    t.after(() => fs.rmSync(extensionPath, { recursive: true, force: true }));
    const directory = path.join(extensionPath, 'runtime', 'mentor', runtimeIdentifier);
    fs.mkdirSync(directory, { recursive: true });
    const entrypoint = path.join(directory, 'JunexisLang.Mentor.CLI.exe');
    fs.writeFileSync(entrypoint, 'test');
    fs.writeFileSync(
        path.join(directory, 'junexis-mentor.json'),
        manifest({ runtimeIdentifier }),
    );

    const resolved = resolveBundledMentor(extensionPath);

    assert.equal(resolved.command, entrypoint);
});
