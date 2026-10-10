import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const {
    assertCurrentMentorAnalysis,
    mentorFindingDelta,
    parseMentorAnalysis,
} = require('../out/mentor-contract');
const {
    createM1002Proposal,
    createM1012Proposal,
    parseAnalysisSnapshot,
} = require('../out/mentor-refactoring');

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const platformRoot = path.resolve(testDirectory, '../../..');
const compilerProject = path.join(
    platformRoot,
    'junexis-lang',
    'compiler',
    'JunexisLang.Compiler.CLI',
    'JunexisLang.Compiler.CLI.csproj');
const mentorProject = path.join(
    platformRoot,
    'junexis-mentor',
    'JunexisLang.Mentor.CLI',
    'JunexisLang.Mentor.CLI.csproj');
const sourceExample = path.join(
    platformRoot,
    'junexis-lang',
    'examples',
    '13-minimal-pipeline.jnx');

ensureBuilt(compilerProject);
ensureBuilt(mentorProject);

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'junexis-mentor-e2e-'));

try {
    const sourcePath = path.join(temporaryRoot, 'main.jnx');
    fs.copyFileSync(sourceExample, sourcePath);

    const beforeBuild = build(sourcePath, path.join(temporaryRoot, 'before'));
    assert.equal(beforeBuild.success, true, 'Initial compiler build must succeed.');
    assert.ok(beforeBuild.buildId);
    assert.ok(beforeBuild.analysisSnapshot);

    const beforeMentor = analyze(beforeBuild.analysisSnapshot);
    assertCurrentMentorAnalysis(beforeMentor, beforeBuild.buildId);
    const finding = beforeMentor.findings.find(item =>
        item.code === 'M1002'
        && item.relatedSymbolId === 'pipeline:PotokSensora');
    assert.ok(finding, 'Mentor must report M1002 for pipeline:PotokSensora.');

    const snapshot = parseAnalysisSnapshot(
        fs.readFileSync(beforeBuild.analysisSnapshot, 'utf8'));
    const original = fs.readFileSync(sourcePath, 'utf8');
    const proposal = createM1002Proposal(
        snapshot,
        finding,
        temporaryRoot,
        original);
    assert.equal(proposal.filePath, sourcePath);
    fs.writeFileSync(sourcePath, proposal.updatedContent, 'utf8');

    const check = runDotnet(
        compilerProject,
        ['check', '--json', sourcePath]);
    assert.equal(check.status, 0, check.stderr || check.stdout);
    const checkResult = parseJsonOutput(check.stdout);
    const checkDiagnostics = Array.isArray(checkResult)
        ? checkResult
        : checkResult.diagnostics ?? [];
    assert.equal(
        checkDiagnostics.some(item => item.level === 'error'),
        false,
        'Compiler check must accept the exact reviewed patch.');

    const afterBuild = build(sourcePath, path.join(temporaryRoot, 'after'));
    assert.equal(afterBuild.success, true, 'Build after refactoring must succeed.');
    assert.notEqual(
        afterBuild.buildId,
        beforeBuild.buildId,
        'Source refactoring must produce a new buildId.');
    const afterMentor = analyze(afterBuild.analysisSnapshot);
    assertCurrentMentorAnalysis(afterMentor, afterBuild.buildId);
    assert.equal(
        afterMentor.findings.some(item =>
            item.code === 'M1002'
            && item.relatedSymbolId === 'pipeline:PotokSensora'),
        false,
        'M1002 must be resolved after the Narrative refactoring.');

    const delta = mentorFindingDelta(beforeMentor.findings, afterMentor.findings);
    assert.ok(delta.resolved >= 1, 'Mentor delta must include the resolved M1002.');
    assert.throws(
        () => assertCurrentMentorAnalysis(beforeMentor, afterBuild.buildId),
        /does not match/,
        'Evidence from the previous build must be rejected as stale.');

    const m1012Fixture = JSON.parse(fs.readFileSync(
        path.join(
            platformRoot,
            'junexis-mentor',
            'docs',
            'mentor-refactoring-m1012.fixture.json'),
        'utf8'));
    const m1012Root = path.join(temporaryRoot, 'm1012');
    fs.mkdirSync(m1012Root);
    const m1012SourcePath = path.join(m1012Root, 'main.jnx');
    fs.writeFileSync(m1012SourcePath, m1012Fixture.originalContent, 'utf8');

    const m1012BeforeBuild = build(
        m1012SourcePath,
        path.join(m1012Root, 'before'));
    const m1012BeforeMentor = analyze(m1012BeforeBuild.analysisSnapshot);
    assertCurrentMentorAnalysis(m1012BeforeMentor, m1012BeforeBuild.buildId);
    const m1012Finding = m1012BeforeMentor.findings.find(item =>
        item.code === 'M1012'
        && item.relatedSymbolId === 'narrative:Telemetry operations');
    assert.ok(m1012Finding, 'Mentor must report M1012 for the disconnected Narrative.');

    const m1012Snapshot = parseAnalysisSnapshot(
        fs.readFileSync(m1012BeforeBuild.analysisSnapshot, 'utf8'));
    const m1012Proposal = createM1012Proposal(
        m1012Snapshot,
        m1012Finding,
        m1012Root,
        fs.readFileSync(m1012SourcePath, 'utf8'));
    assert.equal(
        m1012Proposal.updatedContent,
        m1012Fixture.expectedUpdatedContent,
        'M1012 must use the shared exact patch.');
    fs.writeFileSync(m1012SourcePath, m1012Proposal.updatedContent, 'utf8');

    const m1012Check = runDotnet(
        compilerProject,
        ['check', '--json', m1012SourcePath]);
    assert.equal(m1012Check.status, 0, m1012Check.stderr || m1012Check.stdout);
    const m1012AfterBuild = build(
        m1012SourcePath,
        path.join(m1012Root, 'after'));
    const m1012AfterMentor = analyze(m1012AfterBuild.analysisSnapshot);
    assertCurrentMentorAnalysis(m1012AfterMentor, m1012AfterBuild.buildId);
    assert.equal(
        m1012AfterMentor.findings.some(item =>
            item.code === 'M1012'
            && item.relatedSymbolId === 'narrative:Telemetry operations'),
        false,
        'M1012 must be resolved after connecting the Narrative.');
    const m1012Delta = mentorFindingDelta(
        m1012BeforeMentor.findings,
        m1012AfterMentor.findings);
    assert.ok(
        m1012Delta.resolved >= 1,
        'Mentor delta must include the resolved M1012.');

    process.stdout.write(
        `Mentor E2E passed: ${beforeBuild.buildId.slice(0, 12)} → `
        + `${afterBuild.buildId.slice(0, 12)}, M1002 resolved=${delta.resolved}; `
        + `M1012 resolved=${m1012Delta.resolved}\n`);
} finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

function build(sourcePath, outputPath) {
    const result = runDotnet(
        compilerProject,
        ['build', sourcePath, '--out', outputPath, '--json', '--output-schema', '2.0']);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return parseJsonOutput(result.stdout);
}

function analyze(snapshotPath) {
    const result = runDotnet(
        mentorProject,
        ['analyze', '--snapshot', snapshotPath, '--json']);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return parseMentorAnalysis(JSON.stringify(parseJsonOutput(result.stdout)));
}

function runDotnet(project, args) {
    return childProcess.spawnSync(
        'dotnet',
        ['run', '--project', project, '--no-build', '--', ...args],
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
    const arrayStart = output.indexOf('[');
    const jsonStart = objectStart < 0
        ? arrayStart
        : arrayStart < 0
            ? objectStart
            : Math.min(objectStart, arrayStart);
    if (jsonStart < 0) {
        throw new Error(`Command did not return JSON:\n${output}`);
    }
    return JSON.parse(output.slice(jsonStart));
}
