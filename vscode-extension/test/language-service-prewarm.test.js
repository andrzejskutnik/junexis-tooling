const assert = require('node:assert/strict');
const test = require('node:test');
const { LanguageServicePrewarm } = require('../out/language-service-prewarm.js');

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

test('prewarm starts once after project detection', async () => {
    let starts = 0;
    const prewarm = new LanguageServicePrewarm(
        async () => true,
        () => { starts += 1; },
        0,
    );

    prewarm.schedule();
    await wait(10);

    assert.equal(starts, 1);
    prewarm.dispose();
});

test('prewarm cancellation invalidates pending project detection', async () => {
    let resolveDetection;
    let starts = 0;
    const detection = new Promise(resolve => {
        resolveDetection = resolve;
    });
    const prewarm = new LanguageServicePrewarm(
        () => detection,
        () => { starts += 1; },
        0,
    );

    prewarm.schedule();
    prewarm.cancel();
    resolveDetection(true);
    await wait(10);

    assert.equal(starts, 0);
    prewarm.dispose();
});

test('rescheduling supersedes an earlier workspace scan', async () => {
    const detections = [];
    let starts = 0;
    const prewarm = new LanguageServicePrewarm(
        () => new Promise(resolve => detections.push(resolve)),
        () => { starts += 1; },
        0,
    );

    prewarm.schedule();
    prewarm.schedule();
    detections[0](true);
    detections[1](true);
    await wait(10);

    assert.equal(starts, 1);
    prewarm.dispose();
});
