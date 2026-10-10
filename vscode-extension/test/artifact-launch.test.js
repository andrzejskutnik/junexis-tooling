const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createArtifactLaunchPlan } = require('../out/artifact-launch.js');

function artifact(relativePath, target) {
    return {
        relativePath,
        fullPath: path.join(path.parse(process.cwd()).root, 'project', 'out', ...relativePath.split('/')),
        target,
        kind: relativePath.endsWith('.ini') ? 'configuration' : 'source',
        ownership: 'generated',
        sha256: 'abc',
    };
}

test('JSPI-001 creates a Go run and debug plan from the server entry artifact', () => {
    const plan = createArtifactLaunchPlan('server', [artifact('server/main.go', 'server')]);

    assert.equal(plan.profile, 'go');
    assert.deepEqual(plan.build.args, ['build', '-mod=mod', './...']);
    assert.deepEqual(plan.run.args, ['run', '-mod=mod', '.']);
    assert.equal(plan.debug.type, 'go');
    assert.equal(plan.debug.buildFlags, '-mod=mod');
    assert.equal(plan.debug.program, path.dirname(artifact('server/main.go', 'server').fullPath));
});

test('JSPI-001 creates a built-in JS debug plan for the TypeScript report entry', () => {
    const plan = createArtifactLaunchPlan('report', [artifact('report/index.ts', 'report')]);

    assert.equal(plan.profile, 'typescript');
    assert.equal(plan.debug.type, 'pwa-node');
    assert.deepEqual(plan.debug.runtimeArgs, ['--experimental-strip-types']);
});

test('JSPI-001 treats embedded run as an explicit PlatformIO device upload', () => {
    const plan = createArtifactLaunchPlan(
        'embedded',
        [artifact('embedded/platformio.ini', 'embedded')]);

    assert.equal(plan.profile, 'platformio');
    assert.equal(plan.run.command, 'pio');
    assert.equal(plan.runMutatesDevice, true);
    assert.equal(plan.debug, undefined);
});

test('JSPI-001 refuses unknown or incomplete artifact targets', () => {
    assert.throws(() => createArtifactLaunchPlan('server', []), /main\.go/);
    assert.throws(() => createArtifactLaunchPlan('custom', []), /no Junexis launch profile/);
});
