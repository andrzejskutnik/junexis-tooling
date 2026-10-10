const assert = require('node:assert/strict');
const test = require('node:test');
const {
    diagnosticStoryMarkdown,
    parseDiagnosticStory,
} = require('../out/diagnostic-story.js');

function story(overrides = {}) {
    const target = {
        eventId: 8,
        taskId: 2,
        kind: 'COMM_RECV',
        lamportClock: 12,
        vectorClock: { 2: 12 },
        timestamp: '2026-07-25T10:00:00Z',
        file: 'src/main.jnx',
        line: 17,
        attributes: { narrative_id: 'order-flow' },
    };
    return {
        schemaVersion: '1.0',
        targetEventId: 8,
        targetTask: {
            taskId: 2,
            symbolId: 'task:order-handler',
            displayName: 'OrderHandler',
            resolved: true,
            targets: ['server'],
        },
        narrativeId: 'order-flow',
        timeline: [target],
        causalChain: [target],
        concurrentEvents: [{ ...target, eventId: 9, taskId: 3 }],
        communications: [{
            eventId: 8,
            communicationId: 'comm:orders',
            kind: 'queue',
            pipelineSymbolId: 'pipeline:orders',
            sourceSymbolId: 'task:api',
            targetSymbolId: 'task:order-handler',
        }],
        evidence: ['Vector clocks prove event #9 is concurrent.'],
        ...overrides,
    };
}

test('JSPI-009 parses Diagnostic Story schema 1.x', () => {
    const result = parseDiagnosticStory(story());

    assert.equal(result.targetTask.symbolId, 'task:order-handler');
    assert.equal(result.concurrentEvents.length, 1);
});

test('JSPI-009 rejects an unsupported Diagnostic Story major version', () => {
    assert.throws(
        () => parseDiagnosticStory(story({ schemaVersion: '2.0' })),
        /Expected major version 1/,
    );
});

test('JSPI-009 renders causality, concurrency, communications and evidence', () => {
    const markdown = diagnosticStoryMarkdown(parseDiagnosticStory(story()));

    assert.match(markdown, /## Causal chain/);
    assert.match(markdown, /## Concurrent events/);
    assert.match(markdown, /comm:orders/);
    assert.match(markdown, /Vector clocks prove/);
    assert.match(markdown, /Static findings are not treated as runtime causes/);
});

test('JSPI-011 renders correlated Mentor findings as static context', () => {
    const markdown = diagnosticStoryMarkdown(parseDiagnosticStory(story()), [{
        code: 'M1001',
        severity: 'warning',
        message: 'Handler has no recovery policy.',
        relatedSymbolId: 'task:order-handler',
        source: { file: 'src/main.jnx', line: 12, column: 5 },
    }]);

    assert.match(markdown, /M1001/);
    assert.match(markdown, /task:order-handler/);
    assert.match(markdown, /src\/main\.jnx:12:5/);
    assert.match(markdown, /not runtime causes/);
});
