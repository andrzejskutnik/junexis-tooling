const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
    createM1002Proposal,
    createM1012Proposal,
    parseAnalysisSnapshot,
} = require('../out/mentor-refactoring');

const fixturePath = path.resolve(
    __dirname,
    '../../../junexis-mentor/docs/mentor-refactoring-m1002.fixture.json');
const m1012FixturePath = path.resolve(
    __dirname,
    '../../../junexis-mentor/docs/mentor-refactoring-m1012.fixture.json');
const fixturesAvailable = fs.existsSync(fixturePath) && fs.existsSync(m1012FixturePath);

test('M1002 proposal matches the canonical Studio and VS Code contract', {
    skip: fixturesAvailable ? false : 'Cross-repository fixtures are not checked out.',
}, () => {
    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    const projectRoot = path.resolve('workspace');
    const snapshot = parseAnalysisSnapshot(JSON.stringify({
        buildId: 'fixture-build',
        symbols: [fixture.symbol],
    }));
    const proposal = createM1002Proposal(
        snapshot,
        fixture.finding,
        projectRoot,
        fixture.originalContent);

    assert.equal(proposal.updatedContent, fixture.expectedUpdatedContent);
    assert.equal(proposal.patch, fixture.expectedPatch);
    assert.equal(proposal.relatedSymbolId, fixture.symbol.id);
    assert.match(proposal.assumptions[1], /does not invent stakeholders/);
});

test('M1012 proposal connects an existing Narrative only to the sole pipeline', {
    skip: fixturesAvailable ? false : 'Cross-repository fixtures are not checked out.',
}, () => {
    const fixture = JSON.parse(fs.readFileSync(m1012FixturePath, 'utf8'));
    const projectRoot = path.resolve('workspace');
    const snapshot = parseAnalysisSnapshot(JSON.stringify({
        buildId: 'fixture-build',
        symbols: [fixture.pipeline, fixture.symbol],
    }));
    const proposal = createM1012Proposal(
        snapshot,
        fixture.finding,
        projectRoot,
        fixture.originalContent);

    assert.equal(proposal.updatedContent, fixture.expectedUpdatedContent);
    assert.equal(proposal.patch, fixture.expectedPatch);
    assert.equal(proposal.relatedSymbolId, fixture.symbol.id);
    assert.match(proposal.assumptions[0], /exactly one pipeline/);
    assert.match(proposal.assumptions[1], /must confirm/);
});

test('M1012 refuses an ambiguous project or an already connected Narrative', {
    skip: fixturesAvailable ? false : 'Cross-repository fixtures are not checked out.',
}, () => {
    const fixture = JSON.parse(fs.readFileSync(m1012FixturePath, 'utf8'));
    const projectRoot = path.resolve('workspace');
    const ambiguous = {
        buildId: 'fixture-build',
        symbols: [
            fixture.pipeline,
            { ...fixture.pipeline, id: 'pipeline:Other', name: 'Other' },
            fixture.symbol,
        ],
    };
    assert.throws(
        () => createM1012Proposal(
            ambiguous,
            fixture.finding,
            projectRoot,
            fixture.originalContent),
        /exactly one pipeline/);

    assert.throws(
        () => createM1012Proposal(
            {
                buildId: 'fixture-build',
                symbols: [fixture.pipeline, fixture.symbol],
            },
            fixture.finding,
            projectRoot,
            fixture.expectedUpdatedContent),
        /already contains applies_to/);

    assert.throws(
        () => createM1012Proposal(
            {
                buildId: 'fixture-build',
                symbols: [fixture.pipeline, fixture.symbol],
            },
            fixture.finding,
            projectRoot,
            fixture.originalContent.replace('Telemetry operations', 'Renamed Narrative')),
        /no longer matches/);
});

test('M1002 proposal rejects unsupported and out-of-project changes', () => {
    const snapshot = {
        buildId: 'fixture-build',
        symbols: [{
            id: 'pipeline:P',
            kind: 'pipeline',
            name: 'P',
            source: { file: '../outside.jnx', line: 1, column: 1 },
        }],
    };
    assert.throws(
        () => createM1002Proposal(
            snapshot,
            {
                code: 'M1002',
                severity: 'warning',
                message: 'Missing Narrative.',
                relatedSymbolId: 'pipeline:P',
            },
            path.resolve('workspace'),
            'pipeline P {}\n'),
        /outside/);
    assert.throws(
        () => createM1002Proposal(
            snapshot,
            { code: 'M1001', severity: 'warning', message: 'Other.' },
            path.resolve('workspace'),
            ''),
        /no safe refactoring/);
});
