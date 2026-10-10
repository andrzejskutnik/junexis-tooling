const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');
const { EventEmitter } = require('node:events');
test('application owns CLI session, deduplicates readiness and clears stale events on Stop/restart', async () => {
    const commands = new Map(), children=[], opened=[], spawned=[];
    class Disposable { constructor(fn) { this.fn=fn; } dispose() { this.fn(); } }
    const output={appendLine(){},append(){},clear(){},show(){},dispose(){}};
    const vscode={Disposable, commands:{registerCommand:(id,fn)=>{commands.set(id,fn);return new Disposable(()=>commands.delete(id));}},window:{createOutputChannel:()=>output,activeTextEditor:{document:{}},showWarningMessage(){},showErrorMessage(){},showInformationMessage(){}},workspace:{saveAll:async()=>true},env:{openExternal:async uri=>opened.push(uri)},Uri:{parse:value=>value}};
    const original=Module._load;
    Module._load=function(id,parent,...rest) {
        if(id==='vscode')return vscode;
        if(id==='./backend-discovery')return {resolveCliBackend:()=>({source:'configured',command:'dotnet',args:['compiler.dll']})};
        if(id==='./project-discovery')return {discoverJunexisProjectContext:()=>({projectRoot:'C:/project'})};
        if(id==='child_process')return {spawn:(command,args,options)=>{spawned.push({command,args,options});const child=new EventEmitter();child.pid=12345;child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdout.setEncoding=child.stderr.setEncoding=()=>{};children.push(child);return child;}};
        return original.call(this,id,parent,...rest);
    };
    let registration;
    try { delete require.cache[require.resolve('../out/application-session')];registration=require('../out/application-session').registerApplicationSession({extensionPath:'.'}); }
    finally { Module._load=original; }
    try {
        await commands.get('junexis.application.run')();
        assert.deepEqual(spawned[0].args,['compiler.dll','run','C:/project','--duration','300','--no-open']);
        await commands.get('junexis.application.run')(); assert.equal(children.length,1);
        const ready='READY report · http://127.0.0.1:4173/\n';
        children[0].stderr.emit('data',ready); assert.equal(opened.length,0);
        children[0].stdout.emit('data',ready+ready);assert.equal(opened.length,1);
        // Simulate natural exit, then ensure the old process cannot publish into a new session.
        const old=children[0];old.emit('close',0);
        await commands.get('junexis.application.open')();assert.equal(opened.length,1);
        await commands.get('junexis.application.run')();old.stdout.emit('data',ready);assert.equal(opened.length,1);
        children[1].stdout.emit('data',ready);assert.equal(opened.length,2);
        if(process.platform==='win32') { commands.get('junexis.application.stop')();assert.deepEqual(spawned[2].args,['/PID','12345','/T','/F']);children[1].stdout.emit('data',ready);assert.equal(opened.length,2); }
        children[1].emit('close',0);
    } finally { registration.dispose(); }
});
