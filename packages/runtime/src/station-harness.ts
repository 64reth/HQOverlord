import {createRequire} from 'node:module';
import {lstat,realpath,open,readdir,stat} from 'node:fs/promises';
import {isAbsolute,resolve,dirname,join,relative,sep} from 'node:path';
import {memoryContext} from './station-memory.ts';
const source=createRequire(import.meta.url)('../vendor/starnet/sidecar/harness-import.js') as {
 nonLocalPathReason(path:string):string;filesWanted(harness:string):{rel:string;base:'root'|'state'}[];
 scanProfile(input:unknown):HarnessPreview;
 detectCandidates(options:unknown):{harness:string;root:string;kind:string;label:string}[];
 parseJson5(text:string|null):unknown;openclawAgents(config:unknown):{id:string;workspace?:string;default:boolean}[];
};
export interface HarnessPreview {ok:boolean;reason?:string;name?:string;persona?:string;instructions?:string;userContext?:string;memory?:{curated:string;dailyCount:number};model?:{raw:string|null;provider:string|null;model:string|null};sources?:string[];warnings?:string[];}
const inside=(path:string,base:string)=>{const rel=relative(base,path);return !isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep);};
async function readBounded(path:string,base:string):Promise<string|null>{
 let fd:Awaited<ReturnType<typeof open>>|undefined;
 try{if(!(await lstat(path)).isFile()||!inside(await realpath(path),base))return null;fd=await open(path,'r');const info=await fd.stat();if(!info.isFile())return null;const bytes=Buffer.alloc(Math.min(info.size,128*1024));const {bytesRead}=await fd.read(bytes,0,bytes.length,0);return bytes.subarray(0,bytesRead).toString('utf8');}catch{return null;}finally{await fd?.close();}
}
async function directory(path:string):Promise<boolean>{try{return !source.nonLocalPathReason(path)&&(await stat(path)).isDirectory()&&!source.nonLocalPathReason(await realpath(path));}catch{return false;}}
/** Explicit operator-only import boundary: whitelist reads, no writes or credential transfer. */
export async function scanHarness(harness:'openclaw'|'hermes',root:string):Promise<HarnessPreview>{
 if(!['openclaw','hermes'].includes(harness)||source.nonLocalPathReason(root)||!isAbsolute(root)||!await directory(root))throw new TypeError('Existing ordinary local harness directory required');
 const roots={root:await realpath(root),state:await realpath(dirname(root))},files:Record<string,string>={},warnings:string[]=[];
 for(const item of source.filesWanted(harness)){const base=roots[item.base],path=resolve(base,item.rel);if(!inside(path,base)||/(^|[\\/])(\.env|auth\.json|state\.db|sessions)([\\/]|$)|\.sqlite$/i.test(item.rel))continue;const text=await readBounded(path,base);if(text!==null)files[item.rel]=text;}
 let dailyCount=0;const mem=join(roots.root,harness==='openclaw'?'memory':'memories');try{if(inside(await realpath(mem),roots.root))dailyCount=(await readdir(mem,{withFileTypes:true})).filter(e=>e.isFile()&&/\.md$/i.test(e.name)&&!(harness==='hermes'&&/^(MEMORY|USER)\.md$/i.test(e.name))).length;}catch{ /* No daily notes. */ }
 return memoryContext.redact(source.scanProfile({harness,files,warnings,dailyCount}));
}
export async function detectHarnesses(platform:string,env:Readonly<Record<string,string|undefined>>){
 const found:{harness:string;root:string;label:string}[]=[];
 for(const candidate of source.detectCandidates({platform,env})){if(!await directory(candidate.root))continue;
  if(candidate.harness==='openclaw'){const cfg=source.parseJson5(await readBounded(join(candidate.root,'openclaw.json'),await realpath(candidate.root)));for(const agent of source.openclawAgents(cfg)){const root=resolve(candidate.root,agent.workspace??(agent.default?'workspace':'workspace-'+agent.id));if(await directory(root))found.push({harness:'openclaw',root,label:'OpenClaw: '+agent.id});}}
  else{found.push({harness:'hermes',root:candidate.root,label:'Hermes: main'});try{for(const entry of await readdir(join(candidate.root,'profiles'),{withFileTypes:true})){const root=join(candidate.root,'profiles',entry.name);if(entry.isDirectory()&&await directory(root))found.push({harness:'hermes',root,label:'Hermes: '+entry.name});}}catch{ /* No profiles. */ }}
 }return found;
}
