const assert = require('node:assert/strict');
const test = require('node:test');
const { buildOutputSummary, parseBuildOutput } = require('../out/cli-contract.js');

function buildResult(overrides = {}) {
    return {
        schemaVersion: '2.0',
        command: 'build',
        success: true,
        durationMs: 42,
        inputFile: 'C:/project',
        diagnostics: [],
        mode: 'project',
        projectRoot: 'C:/project',
        entryFile: 'C:/project/src/main.jnx',
        outputRoot: 'C:/project/out',
        buildId: 'abc123',
        targets: ['server', 'report'],
        bundleManifest: 'C:/project/out/junexis.bundle.json',
        artifactManifest: 'C:/project/out/junexis.artifacts.json',
        debugManifest: 'C:/project/out/debug/junexis.debug.toml',
        analysisSnapshot: 'C:/project/out/analysis/junexis.analysis.json',
        latestBuildReceipt: 'C:/project/.junexis/state/latest-build.json',
        ...overrides,
    };
}

test('JSPI-001 parses compiler build schema 2.0', () => {
    const result = parseBuildOutput(JSON.stringify(buildResult()));

    assert.equal(result.buildId, 'abc123');
    assert.deepEqual(result.targets, ['server', 'report']);
});

test('JSPI-001 rejects an unknown build schema', () => {
    assert.throws(
        () => parseBuildOutput(JSON.stringify(buildResult({ schemaVersion: '1.0' }))),
        /Expected '2\.0'/,
    );
});

test('JSPI-001 exposes the same artifact paths as Studio', () => {
    const summary = buildOutputSummary(parseBuildOutput(JSON.stringify(buildResult())));

    assert.ok(summary.includes('Build ID: abc123'));
    assert.ok(summary.includes('Artifact manifest: C:/project/out/junexis.artifacts.json'));
    assert.ok(summary.includes('Analysis snapshot: C:/project/out/analysis/junexis.analysis.json'));
    assert.ok(summary.includes('Latest-build receipt: C:/project/.junexis/state/latest-build.json'));
});
