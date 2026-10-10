import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { parseBuildOutput } = require('../out/cli-contract');
const {
    buildOutputFromReceipt,
    loadLatestBuildReceipt,
} = require('../out/latest-build-contract');
const { restoreLatestBuild } = require('../out/latest-build-restore');

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const platformRoot = path.resolve(testDirectory, '../../..');
const compilerProject = path.join(
    platformRoot,
    'junexis-lang',
    'compiler',
    'JunexisLang.Compiler.CLI',
    'JunexisLang.Compiler.CLI.csproj');
const sourceProject = path.join(
    platformRoot,
    'junexis-lang',
    'examples',
    'projects',
    '01-temperature-monitor');

ensureBuilt(compilerProject);

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'junexis-latest-build-e2e-'));
const projectRoot = path.join(temporaryRoot, 'temperature-monitor');

try {
    fs.cpSync(sourceProject, projectRoot, { recursive: true });
    const entryFile = path.join(projectRoot, 'src', 'main.jnx');

    const successfulProcess = runBuild(projectRoot);
    assert.equal(successfulProcess.status, 0, successfulProcess.stderr || successfulProcess.stdout);
    const successfulBuild = parseBuildOutput(JSON.stringify(parseJsonOutput(successfulProcess.stdout)));
    assert.equal(successfulBuild.success, true, 'The real compiler build must succeed.');
    assert.match(successfulBuild.buildId ?? '', /^[0-9a-f]{64}$/);
    assert.ok(successfulBuild.latestBuildReceipt, 'The compiler must publish latestBuildReceipt.');

    const receiptJsonBeforeFailure = fs.readFileSync(successfulBuild.latestBuildReceipt, 'utf8');
    const receipt = await loadLatestBuildReceipt(successfulBuild.latestBuildReceipt);
    const activeState = buildOutputFromReceipt(receipt, successfulBuild);
    assert.equal(activeState.buildId, successfulBuild.buildId);
    assert.equal(activeState.artifactManifest, successfulBuild.artifactManifest);
    assert.equal(activeState.analysisSnapshot, successfulBuild.analysisSnapshot);

    const restored = await restoreLatestBuild(
        {
            mode: 'project',
            projectRoot,
            activeFile: entryFile,
        },
        [projectRoot]);
    assert.deepEqual(restored.errors, []);
    assert.equal(
        restored.receipt?.buildId,
        successfulBuild.buildId,
        'A fresh extension host must restore the same compiler buildId.');

    fs.appendFileSync(entryFile, '\nthis is not valid Junexis\n', 'utf8');
    const failedProcess = runBuild(projectRoot);
    assert.notEqual(failedProcess.status, 0, 'The deliberately invalid source must fail.');
    const failedBuild = parseBuildOutput(JSON.stringify(parseJsonOutput(failedProcess.stdout)));
    assert.equal(failedBuild.success, false);
    assert.equal(failedBuild.latestBuildReceipt, null);
    assert.equal(
        fs.readFileSync(successfulBuild.latestBuildReceipt, 'utf8'),
        receiptJsonBeforeFailure,
        'A failed build must preserve the atomically published last successful receipt.');

    const restoredAfterFailure = await restoreLatestBuild(
        {
            mode: 'project',
            projectRoot,
            activeFile: entryFile,
        },
        [projectRoot]);
    assert.equal(
        restoredAfterFailure.receipt?.buildId,
        successfulBuild.buildId,
        'Restart restoration after a failed build must keep the last complete world.');

    process.stdout.write(
        `Latest-build E2E passed: build ${successfulBuild.buildId?.slice(0, 12)}, `
        + `receipt restored before and after failed rebuild.\n`);
} finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

function runBuild(targetPath) {
    return childProcess.spawnSync(
        'dotnet',
        [
            'run',
            '--project',
            compilerProject,
            '--no-build',
            '--',
            'build',
            targetPath,
            '--json',
            '--output-schema',
            '2.0',
        ],
        {
            cwd: platformRoot,
            encoding: 'utf8',
            windowsHide: true,
        });
}

function ensureBuilt(project) {
    const result = childProcess.spawnSync(
        'dotnet',
        ['build', project, '--nologo'],
        {
            cwd: platformRoot,
            encoding: 'utf8',
            windowsHide: true,
        });
    assert.equal(result.status, 0, result.stderr || result.stdout);
}

function parseJsonOutput(output) {
    const objectStart = output.indexOf('{');
    if (objectStart < 0) {
        throw new Error(`Command did not return a JSON object:\n${output}`);
    }
    return JSON.parse(output.slice(objectStart));
}
