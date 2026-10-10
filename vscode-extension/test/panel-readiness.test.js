const assert = require('node:assert/strict');
const test = require('node:test');
const { parsePanelReady, CliLines } = require('../out/panel-readiness');
const event = (patch = {}) => 'JUNEXIS_READY ' + JSON.stringify({schema:'junexis.panel-ready/1',sessionId:'12345678-1234-1234-1234-123456789abc',kind:'server',url:'http://127.0.0.1:12345/custom/',...patch});
test('accepts server, report and legacy report, rejects raw child output', () => {
    assert.equal(parsePanelReady(event()).kind, 'server');
    assert.equal(parsePanelReady(event({kind:'report'})).kind, 'report');
    assert.ok(parsePanelReady('READY report · http://localhost:4173/'));
    assert.equal(parsePanelReady('[server] ' + event()), undefined);
});
test('rejects malformed or unsupported records and external URLs', () => {
    for (const line of ['JUNEXIS_READY null', 'JUNEXIS_READY {', event({schema:'future'}),event({sessionId:''}),event({kind:'unknown'}),event({url:'https://example.com/'}),event({url:'http://user@localhost/'}),event({url:'file:///tmp/a'})]) assert.equal(parsePanelReady(line), undefined, line);
});
test('frames chunked CRLF and drops oversized records without trusting suffix', () => {
    const received=[]; const lines=new CliLines(line=>received.push(line));
    const record=event();
    lines.push(record.slice(0,20)); lines.push(record.slice(20)+'\r'); lines.push('\n');
    lines.push('x'.repeat(17000)); lines.push(record+'\n'+record+'\n');
    assert.deepEqual(received,[record,record]);
});
