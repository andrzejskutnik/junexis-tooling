const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
    parseTraceCollectorDistributionManifest,
    resolveTraceCollectorDistribution,
} = require('../out/trace-collector-distribution.js');

function manifest(overrides = {}) {
    return JSON.stringify({
        schemaVersion: 1,
        name: 'Junexis.Debugger.TraceCollector.Server',
        version: '0.1.0',
        protocolVersion: 1,
        runtimeIdentifier: 'win-x64',
        entrypoint: 'Junexis.Debugger.TraceCollector.Server.exe',
        readyToRun: true,
        selfContained: true,
        ...overrides,
    });
}

test('TraceCollector distribution validates identity, runtime and protocol', () => {
    const parsed = parseTraceCollectorDistributionManifest(manifest(), 'win-x64');

    assert.equal(parsed.name, 'Junexis.Debugger.TraceCollector.Server');
    assert.equal(parsed.version, '0.1.0');
    assert.equal(parsed.selfContained, true);
});

test('TraceCollector distribution rejects traversal and incompatible contracts', () => {
    assert.throws(
        () => parseTraceCollectorDistributionManifest(
            manifest({ entrypoint: '../server.exe' }),
            'win-x64'),
        /entrypoint/,
    );
    assert.throws(
        () => parseTraceCollectorDistributionManifest(manifest(), 'linux-x64'),
        /does not match/,
    );
    assert.throws(
        () => parseTraceCollectorDistributionManifest(
            manifest({ protocolVersion: 2 }),
            'win-x64'),
        /incompatible/,
    );
});

test('TraceCollector distribution resolves only its declared entrypoint', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'junexis-trace-distribution-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const entrypoint = path.join(directory, 'Junexis.Debugger.TraceCollector.Server.exe');
    fs.writeFileSync(entrypoint, 'test');
    fs.writeFileSync(path.join(directory, 'junexis-trace-collector.json'), manifest());

    const resolved = resolveTraceCollectorDistribution(directory, 'win-x64');

    assert.equal(resolved.command, entrypoint);
    assert.equal(resolved.cwd, directory);
});
