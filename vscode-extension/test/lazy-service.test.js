const assert = require('node:assert/strict');
const test = require('node:test');
const { LazyService } = require('../out/lazy-service.js');

test('lazy service starts once for concurrent demand', async () => {
    const states = [];
    const service = new LazyService(state => states.push(state));
    let starts = 0;
    let release;
    const gate = new Promise(resolve => {
        release = resolve;
    });

    const start = async () => {
        starts += 1;
        await gate;
    };

    const first = service.ensureStarted(start);
    const second = service.ensureStarted(start);
    await Promise.resolve();
    assert.equal(starts, 1);
    assert.equal(service.state, 'starting');

    release();
    await Promise.all([first, second]);

    assert.equal(service.state, 'running');
    assert.deepEqual(states, ['starting', 'running']);
});

test('lazy service can retry after a failed start and reset after success', async () => {
    const service = new LazyService();

    await assert.rejects(service.ensureStarted(async () => {
        throw new Error('start failed');
    }), /start failed/);
    assert.equal(service.state, 'idle');

    await service.ensureStarted(async () => {});
    assert.equal(service.state, 'running');

    service.reset();
    assert.equal(service.state, 'idle');
});
