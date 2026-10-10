const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
    applyMentorProjectPolicy,
    parseMentorProjectPolicy,
} = require('../out/mentor-policy.js');

function analysis() {
    return {
        schemaVersion: '1.1',
        success: true,
        buildId: 'build-1',
        snapshotPath: 'analysis.json',
        summary: {
            taskCount: 2,
            pipelineCount: 2,
            narrativeCount: 0,
            platformCount: 1,
            findingCount: 3,
            insightCount: 0,
        },
        findings: [
            { code: 'M1002', severity: 'warning', message: 'Missing Narrative.', relatedSymbolId: 'pipeline:P' },
            { code: 'M1002', severity: 'warning', message: 'Other pipeline.', relatedSymbolId: 'pipeline:Other' },
            { code: 'M1001', severity: 'warning', message: 'Disconnected.', relatedSymbolId: 'task:A' },
        ],
    };
}

const fixturePath = path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    'junexis-mentor',
    'docs',
    'mentor-policy.example.yml');

test('canonical Mentor policy fixture from junexis-mentor is accepted', {
    skip: fs.existsSync(fixturePath) ? false : 'Cross-repository fixture is not checked out.',
}, () => {
    const policy = parseMentorProjectPolicy(fs.readFileSync(fixturePath, 'utf8'));
    const source = analysis();
    source.findings[0] = {
        ...source.findings[0],
        relatedSymbolId: 'pipeline:Telemetry',
    };
    const evaluation = applyMentorProjectPolicy(source, policy, '2026-07-27');

    assert.equal(policy.schemaVersion, '1.0');
    assert.equal(evaluation.appliedSuppressions.length, 1);
    assert.equal(evaluation.appliedSuppressions[0].suppression.id, 'ACCEPT-M1002-TELEMETRY');
});

test('Mentor policy 1.0 applies only exact active rule and symbol', () => {
    const policy = parseMentorProjectPolicy(`
schemaVersion: "1.0"
presence: teaching
decisions:
  - id: ADR-001
    title: Keep parent Narrative
    rationale: The parent system owns this boundary.
    relatedSymbolIds: [pipeline:P]
suppressions:
  - id: ACCEPT-001
    ruleCode: M1002
    symbolId: pipeline:P
    rationale: Covered by the parent system.
    expiresOn: 2099-12-31
`);
    const evaluation = applyMentorProjectPolicy(analysis(), policy, '2026-07-27');

    assert.equal(policy.presence, 'teaching');
    assert.equal(policy.decisions.length, 1);
    assert.equal(evaluation.appliedSuppressions.length, 1);
    assert.equal(evaluation.result.findings.length, 2);
    assert.equal(evaluation.result.summary.findingCount, 2);
    assert.equal(evaluation.result.findings[0].relatedSymbolId, 'pipeline:Other');
});

test('expired suppression remains configured and hides nothing', () => {
    const policy = parseMentorProjectPolicy(`
schemaVersion: "1.0"
suppressions:
  - id: OLD-001
    ruleCode: M1002
    symbolId: pipeline:P
    rationale: Historical acceptance.
    expiresOn: 2000-01-01
`);
    const evaluation = applyMentorProjectPolicy(analysis(), policy, '2026-07-27');

    assert.equal(policy.suppressions.length, 1);
    assert.equal(evaluation.appliedSuppressions.length, 0);
    assert.equal(evaluation.result.findings.length, 3);
});

test('invalid or broad policy is rejected atomically', () => {
    assert.throws(() => parseMentorProjectPolicy(`
schemaVersion: "1.0"
suppressions:
  - id: TOO-WIDE
    ruleCode: M1002
    rationale: Hide every instance.
`), /symbolId is required/);
    assert.throws(() => parseMentorProjectPolicy(`
schemaVersion: "1.0"
suppressEverything: true
`), /unknown field/);
    assert.throws(() => parseMentorProjectPolicy(`
schemaVersion: "2.0"
`), /exactly "1.0"/);
});

test('duplicate ids, targets and invalid dates are rejected', () => {
    assert.throws(() => parseMentorProjectPolicy(`
schemaVersion: "1.0"
decisions:
  - id: SAME
    title: One
    rationale: First.
suppressions:
  - id: SAME
    ruleCode: M1002
    symbolId: pipeline:P
    rationale: Second.
`), /Duplicate policy id/);
    assert.throws(() => parseMentorProjectPolicy(`
schemaVersion: "1.0"
suppressions:
  - id: A
    ruleCode: M1002
    symbolId: pipeline:P
    rationale: First.
  - id: B
    ruleCode: M1002
    symbolId: pipeline:P
    rationale: Second.
`), /Multiple suppressions target/);
    assert.throws(() => parseMentorProjectPolicy(`
schemaVersion: "1.0"
suppressions:
  - id: A
    ruleCode: M1002
    symbolId: pipeline:P
    rationale: First.
    expiresOn: 2026-02-31
`), /yyyy-MM-dd/);
});
