import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
export type MemoryRecord=Record<string,unknown>;
export const memoryCore=require('../vendor/starnet/sidecar/memcore.js') as {
  reduceStats(records:MemoryRecord[],event:unknown,options:{now:number}):MemoryRecord[];
  applyPin(records:MemoryRecord[],id:string,pinned:boolean):{records:MemoryRecord[];found:boolean};
  applyForget(records:MemoryRecord[],id:string):{records:MemoryRecord[];found:boolean};
};
export const memoryContext=require('../vendor/starnet/sidecar/context.js') as {
  rank(records:MemoryRecord[],query:string,options:Record<string,unknown>):MemoryRecord[];
  redact<T>(value:T):T;setKnownSecretSource(source:()=>readonly string[]):void;
  flagInjection(text:string):boolean;
  makeContext(options:Record<string,unknown>):{planCompaction(history:unknown[]):{older:unknown[];tail:unknown[]}};
};
export function referenceRecords(notes:readonly {key:string;text:string;updatedAt:string;revision:number;record?:Readonly<MemoryRecord>}[]):MemoryRecord[]{
  return notes.map(n=>structuredClone(n.record??{id:n.key,title:n.key,body:n.text,kind:'note',scope:'global',origin:'commander',createdAt:Date.parse(n.updatedAt),revision:n.revision}));
}
export const reviseMemory=(require('../vendor/starnet/tools/builtin/notebook.js') as {reviseRecord(record:MemoryRecord,change:unknown,now:number):MemoryRecord}).reviseRecord;
