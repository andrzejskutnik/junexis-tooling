const assert = require('node:assert/strict');
const test = require('node:test');
const {
    assertCurrentMentorAnalysis,
    findingsForStory,
    mentorFindingDelta,
    parseMentorAnalysis,
} = require('../out/mentor-contract.js');

function analysis(overrides = {}) {
    return {
        schemaVersion: '1.1',
        success: true,
        buildId: 'build-1',
        snapshotPath: 'out/analysis/junexis.analysis.json',
        summary: {
            taskCount: 2,
            pipelineCount: 1,
            narrativeCount: 1,
            platformCount: 2,
            findingCount: 4,
            insightCount: 1,
        },
        findings: [
            { code: 'M1001', severity: 'warning', message: 'Task risk', relatedSymbolId: 'task:handler' },
            { code: 'M1002', severity: 'info', message: 'Other risk', relatedSymbolId: 'task:other' },
            { code: 'M1003', severity: 'info', message: 'Pipeline risk', relatedSymbolId: 'pipeline:orders' },
            { code: 'M1004', severity: 'info', message: 'Global context' },
        ],
        insights: [{
            kind: 'NarrativeCoverage',
            summary: 'Narrative coverage: 1/2 tasks.',
            score: 0.5,
            relatedSymbolIds: ['task:other'],
        }],
        patterns: [{
            patternId: 'EdgeToServer',
            name: 'Edge to server',
            confidence: 1,
            rationale: 'Embedded data reaches a server task.',
            participantSymbolIds: ['task:api', 'task:handler'],
        }],
        ...overrides,
    };
}

function story() {
    return {
        targetTask: { symbolId: 'task:handler' },
        communications: [{
            communicationId: 'comm:orders',
            pipelineSymbolId: 'pipeline:orders',
            sourceSymbolId: 'task:api',
            targetSymbolId: 'task:handler',
        }],
    };
}

test('JSPI-011 parses Mentor schema 1.x', () => {
    const result = parseMentorAnalysis(JSON.stringify(analysis()));
    assert.equal(result.buildId, 'build-1');
    assert.equal(result.findings.length, 4);
    assert.equal(result.summary.taskCount, 2);
    assert.equal(result.insights[0].kind, 'NarrativeCoverage');
    assert.equal(result.patterns[0].patternId, 'EdgeToServer');
});

test('JSPI-011 rejects unsuccessful and unsupported Mentor output', () => {
    assert.throws(() => parseMentorAnalysis(JSON.stringify(analysis({ success: false }))), /unsuccessful/);
    assert.throws(() => parseMentorAnalysis(JSON.stringify(analysis({ schemaVersion: '2.0' }))), /major version 1/);
});

test('JSPI-011 rejects Mentor evidence from a stale build', () => {
    const result = parseMentorAnalysis(JSON.stringify(analysis()));
    assert.equal(assertCurrentMentorAnalysis(result, 'build-1'), result);
    assert.throws(
        () => assertCurrentMentorAnalysis(result, 'build-2'),
        /does not match the active analysis snapshot/);
});

test('Mentor enrichment includes only stable symbols present in the story', () => {
    const filtered = findingsForStory(analysis(), story());
    assert.deepEqual(filtered.map(item => item.code), ['M1001', 'M1003']);
});

test('Mentor finding delta uses stable code and subject identity', () => {
    const previous = analysis().findings;
    const current = [
        { ...previous[0], message: 'Updated task risk' },
        previous[2],
        { code: 'M1010', severity: 'warning', message: 'New risk', relatedSymbolId: 'task:new' },
    ];
    assert.deepEqual(mentorFindingDelta(previous, current), {
        added: 1,
        changed: 1,
        resolved: 2,
        unchanged: 1,
    });
});
