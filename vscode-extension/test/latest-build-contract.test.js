const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
    buildOutputFromReceipt,
    latestBuildReceiptPath,
    loadLatestBuildReceipt,
    parseLatestBuildReceipt,
} = require('../out/latest-build-contract.js');
const {
    latestBuildCandidates,
    projectRootsForAutomaticRestore,
    restoreLatestBuild,
} = require('../out/latest-build-restore.js');

const BUILD_ID = 'a'.repeat(64);

function createFixture(mode = 'project') {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'junexis-vscode-latest-'));
    const entry = path.join(root, 'src', 'main.jnx');
    const output = path.join(root, 'out');
    const bundle = path.join(output, 'junexis.bundle.json');
    const artifacts = path.join(output, 'junexis.artifacts.json');
    const debug = path.join(output, 'debug', 'junexis.debug.toml');
    const analysis = path.join(output, 'analysis', 'junexis.analysis.json');
    const receiptPath = latestBuildReceiptPath(mode, root, entry);
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.mkdirSync(path.dirname(debug), { recursive: true });
    fs.mkdirSync(path.dirname(analysis), { recursive: true });
    fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
    fs.writeFileSync(entry, 'system Example {}');
    for (const artifact of [bundle, analysis]) {
        fs.writeFileSync(artifact, JSON.stringify({ buildId: BUILD_ID }));
    }
    fs.writeFileSync(debug, 'version = "1.0"');
    const debugHash = crypto.createHash('sha256').update(fs.readFileSync(debug)).digest('hex');
    fs.writeFileSync(artifacts, JSON.stringify({
        schemaVersion: '1.0',
        buildId: BUILD_ID,
        artifacts: [{
            path: 'debug/junexis.debug.toml',
            target: 'debug',
            kind: 'debug-manifest',
            ownership: 'generated',
            sha256: debugHash,
        }],
    }));
    const receipt = {
        schemaVersion: '1.0',
        buildId: BUILD_ID,
        mode,
        projectRoot: root,
        entryFile: entry,
        outputRoot: output,
        targets: ['server'],
        bundleManifest: bundle,
        artifactManifest: artifacts,
        debugManifest: debug,
        analysisSnapshot: analysis,
    };
    fs.writeFileSync(receiptPath, JSON.stringify(receipt));
    return { root, entry, output, receiptPath, receipt };
}

test('JSPI-002 loads a complete latest-build 1.0 receipt and projects compatible state', async t => {
    const fixture = createFixture();
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

    const receipt = await loadLatestBuildReceipt(fixture.receiptPath);
    const state = buildOutputFromReceipt(receipt);

    assert.equal(receipt.buildId, BUILD_ID);
    assert.equal(state.success, true);
    assert.equal(state.artifactManifest, fixture.receipt.artifactManifest);
    assert.equal(state.latestBuildReceipt, fixture.receiptPath);
});

test('JSPI-002 rejects traversal, a non-deterministic location and mismatched artifact identity', async t => {
    const fixture = createFixture();
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

    assert.throws(
        () => parseLatestBuildReceipt(
            JSON.stringify({ ...fixture.receipt, artifactManifest: path.join(fixture.root, 'escape.json') }),
            fixture.receiptPath),
        /escapes its owning root/);
    assert.throws(
        () => parseLatestBuildReceipt(JSON.stringify(fixture.receipt), path.join(fixture.root, 'latest-build.json')),
        /deterministic state location/);

    fs.writeFileSync(fixture.receipt.analysisSnapshot, JSON.stringify({ buildId: 'b'.repeat(64) }));
    await assert.rejects(
        () => loadLatestBuildReceipt(fixture.receiptPath),
        /analysisSnapshot buildId does not match/);
});

test('JSPI-002 rejects a debug manifest changed after inventory publication', async t => {
    const fixture = createFixture();
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    fs.appendFileSync(fixture.receipt.debugManifest, '\ntampered = true');

    await assert.rejects(
        () => loadLatestBuildReceipt(fixture.receiptPath),
        /debugManifest SHA-256 does not match/);
});

test('JSPI-002 resolves project and file receipts without scanning generated output', () => {
    const root = path.resolve('workspace');
    const entry = path.join(root, 'src', 'main.jnx');

    assert.deepEqual(
        latestBuildCandidates(
            { mode: 'file', activeFile: entry },
            [root]),
        [path.join(path.dirname(entry), '.junexis', 'state', 'main', 'latest-build.json')]);
});

test('JSPI-002 never substitutes another project for a corrupt active receipt', async t => {
    const invalid = createFixture();
    const valid = createFixture();
    t.after(() => fs.rmSync(invalid.root, { recursive: true, force: true }));
    t.after(() => fs.rmSync(valid.root, { recursive: true, force: true }));
    fs.writeFileSync(invalid.receiptPath, '{ invalid');

    const result = await restoreLatestBuild(
        {
            mode: 'project',
            projectRoot: invalid.root,
            activeFile: invalid.entry,
        },
        [invalid.root, valid.root]);

    assert.equal(result.receipt, undefined);
    assert.equal(result.errors.length, 1);
});

test('JSPI-002 does not choose an arbitrary project before a Junexis document becomes active', () => {
    const first = path.resolve('workspace', 'first');
    const second = path.resolve('workspace', 'second');

    assert.deepEqual(
        projectRootsForAutomaticRestore({ mode: 'none' }, [first, second]),
        []);
    assert.deepEqual(
        projectRootsForAutomaticRestore({ mode: 'none' }, [first]),
        [first]);
    assert.deepEqual(
        projectRootsForAutomaticRestore(
            { mode: 'project', projectRoot: second, activeFile: path.join(second, 'main.jnx') },
            [first, second]),
        [first, second]);
});
