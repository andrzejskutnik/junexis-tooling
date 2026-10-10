const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const fs = require('node:fs');
const cli = process.env.JUNEXIS_TEST_CLI;
const project = process.env.JUNEXIS_TEST_PROJECT;

test('real CLI readiness, laboratory API and owned Stop through VS Code session adapter',
    { skip: !cli || !project, timeout: 180000 }, async () => {
    const commands = new Map(), logs=[];
    let openedResolve, stoppedResolve;
    const opened = new Promise(resolve => { openedResolve=resolve; });
    const stopped = new Promise(resolve => { stoppedResolve=resolve; });
    class Disposable { constructor(fn) { this.fn=fn; } dispose() { this.fn(); } }
    const output={appendLine(line){logs.push(line);if(line==='Sesja zatrzymana.')stoppedResolve();},append(line){logs.push(line);},clear(){},show(){},dispose(){}};
    const vscode={Disposable,commands:{registerCommand:(id,fn)=>{commands.set(id,fn);return new Disposable(()=>commands.delete(id));}},window:{createOutputChannel:()=>output,activeTextEditor:{document:{}},showWarningMessage:line=>logs.push(line),showErrorMessage:line=>logs.push(line),showInformationMessage:line=>logs.push(line)},workspace:{saveAll:async()=>true},env:{openExternal:async uri=>{openedResolve(uri);return true;}},Uri:{parse:value=>value}};
    const original=Module._load;
    Module._load=function(id,parent,...rest) {
        if(id==='vscode')return vscode;
        if(id==='./backend-discovery')return {resolveCliBackend:()=>({source:'configured',command:'dotnet',args:[cli]})};
        if(id==='./project-discovery')return {discoverJunexisProjectContext:()=>({projectRoot:project})};
        return original.call(this,id,parent,...rest);
    };
    let registration;
    try { registration=require('../out/application-session').registerApplicationSession({extensionPath:'.'}); }
    finally { Module._load=original; }
    const evidence=process.env.JUNEXIS_TEST_EVIDENCE;
    let timer;
    try {
        await commands.get('junexis.application.run')();
        const url=await Promise.race([opened,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Readiness timeout: '+logs.join('\n'))),150000);})]);
        clearTimeout(timer);
        assert.equal(new URL(url).pathname,'/laboratory/');
        const response=await fetch(url);assert.equal(response.status,200);
        const checked=await promisify(execFile)('pwsh',['-NoProfile','-File',path.join(project,'verification','verify-running-laboratory.ps1'),'-BaseUrl',new URL(url).origin],{windowsHide:true,timeout:60000});
        commands.get('junexis.application.stop')();
        await Promise.race([stopped,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Stop timeout')),10000);})]);
        clearTimeout(timer);
        await assert.rejects(fetch(url));
        if(evidence)fs.writeFileSync(evidence,JSON.stringify({date:'2026-09-25',runtime:process.platform,adapter:'VS Code application-session',realCli:true,realProcessStop:true,panelHttpStatus:200,closedAfterStop:true,uiVerified:false,laboratory:JSON.parse(checked.stdout)},null,2)+'\n');
    } catch (error) { console.error(error); console.error(logs.join("\n")); throw error; }
    finally { clearTimeout(timer);registration.dispose(); }
});
