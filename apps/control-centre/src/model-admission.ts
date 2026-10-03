import {readFile,open,rename,mkdir,rm} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {validateMeteredPricing} from '@hqoverlord/runtime';
import {loadModelProfiles,type ModelProfile} from './model-profiles.ts';
/** Additive host profile admission: endpoint/key references are inherited, never supplied by a browser. */
export function createModelAdmission(file:string,initial:readonly ModelProfile[]){let profiles=initial,gate:Promise<unknown>=Promise.resolve();const catalogs=new Map<string,Set<string>>();
 return {profiles:()=>profiles,noteCatalog(provider:string,models:readonly Record<string,unknown>[]){catalogs.set(provider,new Set(models.flatMap(m=>typeof m.id==='string'?[m.id]:[])));},async admit(input:Record<string,unknown>){const work=gate.catch(()=>{}).then(async()=>{
  const base=profiles.find(p=>p.provider.name===input.provider)?.hostConfig;if(!base||typeof input.model!=='string'||!/^[-a-zA-Z0-9_./:]{1,200}$/.test(input.model)||!catalogs.get(String(input.provider))?.has(input.model))throw new Error('Read the real host provider catalog before selecting a model');
  if(profiles.some(p=>p.provider.name===input.provider&&p.options.model===input.model))throw new Error('Existing model tariffs are immutable; choose a new model');
  const rates=input.pricing as Record<string,unknown>;if(!rates||typeof rates!=='object')throw new Error('Exact tariff is required');const numeric=(name:string)=>{const value=rates[name];if(typeof value!=='string'||!/^\d{1,24}$/.test(value))throw new Error('Tariff must contain exact nonnegative decimal integers');return BigInt(value);};
  const pricing={version:1 as const,currency:'USD' as const,unit:'nanodollar' as const,provider:String(base.provider),model:input.model,tokensPerBlock:numeric('tokensPerBlock'),inputNanodollars:numeric('inputNanodollars'),outputNanodollars:numeric('outputNanodollars'),cachedInputNanodollars:numeric('cachedInputNanodollars'),...(rates.cacheCreationInputNanodollars!==undefined?{cacheCreationInputNanodollars:numeric('cacheCreationInputNanodollars')}:{})};validateMeteredPricing(pricing);
  const maxInputTokens=Number(input.maxInputTokens),maxOutputTokens=Number(input.maxOutputTokens);if(![maxInputTokens,maxOutputTokens].every(n=>Number.isSafeInteger(n)&&n>0&&n<=1_000_000))throw new Error('Explicit bounded token limits are required');
  if(base.keyEnv&&(!/^[A-Z][A-Z0-9_]*$/.test(String(base.keyEnv))||!process.env[String(base.keyEnv)]))throw new Error('The host provider credential is not configured');
  let saved:unknown=[];try{saved=JSON.parse(await readFile(file,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}if(!Array.isArray(saved))throw new Error('Invalid operator model file');
  const connection={provider:base.provider,format:base.format,endpoint:base.endpoint,...(base.keyEnv?{keyEnv:base.keyEnv}:{}),...(base.wireReasoningEffort===true?{wireReasoningEffort:true}:{})},config={...connection,model:input.model,maxInputTokens,maxOutputTokens,maxRetries:2,pricing:Object.fromEntries(Object.entries(pricing).filter(([key])=>['tokensPerBlock','inputNanodollars','outputNanodollars','cachedInputNanodollars','cacheCreationInputNanodollars'].includes(key)).map(([key,value])=>[key,String(value)]))},next=[...saved,config],raw=JSON.stringify(next,null,2)+'\n',temporary=file+'.'+randomUUID()+'.tmp';
  const validated=await loadModelProfiles(file,next);
  await mkdir(dirname(file),{recursive:true});let handle;try{handle=await open(temporary,'wx',0o600);await handle.writeFile(raw,'utf8');await handle.sync();await handle.close();handle=undefined;await rename(temporary,file);if(await readFile(file,'utf8')!==raw)throw new Error('Host profile readback failed');profiles=validated;}finally{await handle?.close();await rm(temporary,{force:true});}
  return {provider:base.provider,model:input.model,admitted:true};
 });gate=work;return work;}};
}
