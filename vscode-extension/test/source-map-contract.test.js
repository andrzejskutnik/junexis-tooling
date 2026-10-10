const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const {
    mapGeneratedLocation,
    mapJunexisBreakpoints,
    parseDebugSourceMap,
} = require('../out/source-map-contract.js');

const root = path.join(path.parse(process.cwd()).root, 'project');
const outputRoot = path.join(root, 'out');
const source = path.join(root, 'main.jnx');

function contract(overrides = {}) {
    return JSON.stringify({
        schemaVersion: '1.0',
        kind: 'junexis.debug-source-map',
        sourceFile: source,
        mappings: [
            {
                symbolId: 'task:Read',
                kind: 'task',
                source: { file: source, line: 10, column: 1 },
                generated: {
                    target: 'server',
                    file: 'server/main.go',
                    startLine: 80,
                    endLine: 95,
                    startColumn: 1,
                },
            },
            {
                symbolId: 'task:Read',
                kind: 'statement',
                irPath: '/Tasks[0]/Body[0]',
                source: { file: source, line: 12, column: 3 },
                generated: {
                    target: 'server',
                    file: 'server/main.go',
                    startLine: 85,
                    endLine: 85,
                    startColumn: 1,
                },
            },
            {
                symbolId: 'task:Read',
                kind: 'statement',
                irPath: '/Tasks[0]/Body[0]',
                source: { file: source, line: 12, column: 3 },
                generated: {
                    target: 'server',
                    file: 'server/main.go',
                    startLine: 87,
                    endLine: 87,
                    startColumn: 5,
                },
            },
        ],
        ...overrides,
    });
}

test('JSPI-009 parses source-map 1.0 and confines generated paths to output', () => {
    const result = parseDebugSourceMap(contract(), outputRoot);

    assert.equal(result.mappings.length, 3);
    assert.equal(
        result.mappings[0].generated.fullPath,
        path.join(outputRoot, 'server', 'main.go'));
});

test('JSPI-009 rejects source-map traversal and unsupported contracts', () => {
    const unsafe = JSON.parse(contract());
    unsafe.mappings[0].generated.file = '../secret.go';
    assert.throws(
        () => parseDebugSourceMap(JSON.stringify(unsafe), outputRoot),
        /escapes output root/);
    assert.throws(
        () => parseDebugSourceMap(contract({ schemaVersion: '2.0' }), outputRoot),
        /Unsupported/);
});

test('JSPI-009 maps one Junexis breakpoint to all exact generated statements', () => {
    const sourceMap = parseDebugSourceMap(contract(), outputRoot);
    const mapped = mapJunexisBreakpoints(sourceMap, 'server', source, [{
        line: 12,
        condition: 'ready',
        hitCondition: '3',
        logMessage: 'value={value}',
    }]);

    assert.deepEqual(mapped.map(item => item.line), [85, 87]);
    assert.deepEqual(mapped.map(item => item.column), [1, 5]);
    assert.ok(mapped.every(item => item.condition === 'ready'));
});

test('JSPI-009 uses preceding statement and maps generated frames back to Junexis', () => {
    const sourceMap = parseDebugSourceMap(contract(), outputRoot);
    const mapped = mapJunexisBreakpoints(sourceMap, 'server', source, [{ line: 14 }]);
    const frame = mapGeneratedLocation(
        sourceMap,
        path.join(outputRoot, 'server', 'main.go'),
        85);

    assert.deepEqual(mapped.map(item => item.line), [85, 87]);
    assert.equal(frame.kind, 'statement');
    assert.equal(frame.source.line, 12);
    assert.equal(frame.symbolId, 'task:Read');
});
