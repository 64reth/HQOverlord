import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync} from 'node:fs';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ids} from '@hqoverlord/core';
import {registerBrowserTools,ToolRegistry,workspaceKey} from '../src/index.ts';
const nativeChrome=process.platform==='win32'&&existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe');
test('actual installed Chrome captures private PNG and PDF files without an injected driver or external page', {skip:!nativeChrome,timeout:30000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'hq-native-browser-')),registry=new ToolRegistry(),browser=registerBrowserTools(registry,join(root,'profiles'),{workspaceRoot:join(root,'workspaces')}),businessId=ids.business('native'),agent={id:ids.agent('native-agent'),businessId,name:'Native browser',status:'idle' as const,toolIds:[ids.tool('browser.screenshot'),ids.tool('browser.pdf')],capabilities:[]},job={id:ids.job('native-job'),businessId,agentId:agent.id,objective:'Capture the real private blank page',status:'running' as const},context={businessId,agent,job},key=workspaceKey(context);
 try{const capture=await registry.require(ids.tool('browser.screenshot')).execute({},context),output=capture.output as {images?:{data:string}[];content?:string};assert.ok(output.images?.[0]?.data);const png=Buffer.from(output.images![0]!.data,'base64');assert.ok(png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));assert.ok(png.length>100);
 const relative=/saved to ([^\s]+\.png)/.exec(output.content??'')?.[1];assert.ok(relative);assert.deepEqual(await readFile(join(root,'workspaces',key,relative)),png);
 const pdf=await registry.require(ids.tool('browser.pdf')).execute({},context);assert.match(JSON.stringify(pdf.output),/PDF saved/);const pdfPath=/saved to ([^\s]+\.pdf)/.exec((pdf.output as {content:string}).content)?.[1];assert.ok(pdfPath);assert.equal((await readFile(join(root,'workspaces',key,pdfPath))).subarray(0,5).toString(),'%PDF-');
 }finally{await browser.close();await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
