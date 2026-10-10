const assert = require('node:assert/strict');
const test = require('node:test');
const { PerformanceProfile } = require('../out/performance-profile.js');

test('performance profile records checkpoints and measured work', async () => {
    let current = 10;
    const profile = new PerformanceProfile('Junexis activation', () => current);

    current = 14;
    profile.checkpoint('core');
    await profile.measure('language services', async () => {
        current = 21;
    });
    const result = profile.measureSync('client construction', () => {
        current = 23;
        return 'ready';
    });
    current = 25;
    profile.finish();
    current = 1000;

    assert.equal(result, 'ready');
    assert.deepEqual(profile.snapshot(), {
        label: 'Junexis activation',
        totalMs: 15,
        entries: [
            { name: 'core', durationMs: 4 },
            { name: 'language services', durationMs: 7 },
            { name: 'client construction', durationMs: 2 },
        ],
    });
    assert.match(profile.render(), /Junexis activation: 15\.0 ms/);
});
