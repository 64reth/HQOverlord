import { readFile } from "node:fs/promises";
import { currencyCode, money } from "@hqoverlord/core";
import { OpenAIModelProvider, ReferenceModelProvider, validateMeteredPricing, type ModelExecutionOptions, type ModelProvider, type MeteredPricing } from "@hqoverlord/runtime";
import { jobModelOptions } from "../../../businesses/business-001/manifest.ts";
export interface ModelProfile {readonly provider:ModelProvider;readonly options:ModelExecutionOptions;readonly hostConfig?:Readonly<Record<string,unknown>>;}
/** Host-owned allowlist; credentials never enter agent profiles, browser snapshots, or durable events. */
export async function loadModelProfiles(additionalPath?:string,additionalConfigs?:readonly Record<string,unknown>[]):Promise<readonly ModelProfile[]> {
  const profiles:ModelProfile[]=[{provider:new OpenAIModelProvider({apiKey:process.env.OPENAI_API_KEY??""}),hostConfig:{provider:"openai",format:"responses",endpoint:"https://api.openai.com/v1",keyEnv:"OPENAI_API_KEY"},options:{...jobModelOptions(),maxRetries:2}}];
  if(process.env.OLLAMA_MODEL){
    const model=process.env.OLLAMA_MODEL,endpoint=process.env.OLLAMA_BASE_URL??"http://127.0.0.1:11434/v1";
    if(!["127.0.0.1","localhost","[::1]"].includes(new URL(endpoint).hostname))throw new Error("Unmetered Ollama profile must be local");
    profiles.push({provider:new ReferenceModelProvider({name:"ollama",format:"chat",endpoint}),hostConfig:{provider:"ollama",format:"chat",endpoint},options:{model,maxRetries:2,maxInputTokens:4096,maxOutputTokens:1024,maxTurns:8,budget:money(5n,currencyCode("USD")),
      meteredPricing:{version:1,currency:"USD",unit:"nanodollar",provider:"ollama",model,tokensPerBlock:1n,inputNanodollars:0n,outputNanodollars:0n,cachedInputNanodollars:0n}}});
  }
  const fallbackRefs=new Map<ModelProfile,unknown>();
  const configs:Record<string,unknown>[]=[];
  for(const file of [...new Set([process.env.HQ_MODEL_PROFILES_PATH,additionalPath].filter((p):p is string=>!!p))]){if(file===additionalPath&&additionalConfigs!==undefined)continue;try{const entries:unknown=JSON.parse(await readFile(file,'utf8'));if(!Array.isArray(entries))throw new Error('Model profile file must contain an array');configs.push(...entries);}catch(error){if(file!==additionalPath||(error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
  if(additionalConfigs)configs.push(...additionalConfigs);
  {
    for(const c of configs){
      if(typeof c.provider!=="string"||typeof c.model!=="string"||typeof c.endpoint!=="string"||!["responses","chat","anthropic","gemini","openrouter"].includes(String(c.format)))throw new Error("Invalid host model profile");
      const rates=c.pricing as Record<string,string>,pricing:MeteredPricing={version:1,currency:"USD",unit:"nanodollar",provider:c.provider,model:c.model,
        tokensPerBlock:BigInt(rates.tokensPerBlock!),inputNanodollars:BigInt(rates.inputNanodollars!),outputNanodollars:BigInt(rates.outputNanodollars!),cachedInputNanodollars:BigInt(rates.cachedInputNanodollars!),...(rates.cacheCreationInputNanodollars!==undefined?{cacheCreationInputNanodollars:BigInt(rates.cacheCreationInputNanodollars)}:{})};
      validateMeteredPricing(pricing);
      const key=typeof c.keyEnv==="string"?process.env[c.keyEnv]:undefined;
      if(c.format==='responses'&&(c.provider!=='openai'||c.endpoint!=='https://api.openai.com/v1'))throw new Error('Responses profiles use the official OpenAI endpoint');
      profiles.push({hostConfig:c,provider:c.format==='responses'?new OpenAIModelProvider({apiKey:key??""}):new ReferenceModelProvider({name:c.provider,format:c.format as "chat"|"anthropic"|"gemini"|"openrouter",endpoint:c.endpoint,wireReasoningEffort:c.wireReasoningEffort===true,...(key?{apiKey:key}:{})}),
        options:{model:c.model,maxRetries:Number(c.maxRetries??2),maxInputTokens:Number(c.maxInputTokens??4096),maxOutputTokens:Number(c.maxOutputTokens??1024),maxTurns:8,meteredPricing:pricing,budget:money(5n,currencyCode("USD"))}});
      if(![profiles.at(-1)!.options.maxInputTokens,profiles.at(-1)!.options.maxOutputTokens].every(n=>Number.isSafeInteger(n)&&n>0&&n<=1_000_000)||!Number.isSafeInteger(profiles.at(-1)!.options.maxRetries)||profiles.at(-1)!.options.maxRetries!<0||profiles.at(-1)!.options.maxRetries!>6)throw new Error('Invalid host model limits');
      if(c.fallbacks!==undefined)fallbackRefs.set(profiles.at(-1)!,c.fallbacks);
    }
  }
  if(new Set(profiles.map(p=>JSON.stringify([p.provider.name,p.options.model]))).size!==profiles.length)throw new Error("Duplicate host model profile");
  for(const [profile,refs]of fallbackRefs){if(!Array.isArray(refs)||refs.length>8)throw new Error("Invalid explicit fallback chain");const fallbacks=refs.map(ref=>{const target=profiles.find(p=>p.provider.name===ref?.provider&&p.options.model===ref?.model);if(!target||target===profile)throw new Error("Fallback target is not a distinct priced host profile");const {fallbacks:_nested,...options}=target.options;return {provider:target.provider,options};});if(new Set(fallbacks.map(f=>JSON.stringify([f.provider.name,f.options.model]))).size!==fallbacks.length)throw new Error("Duplicate fallback target");profiles[profiles.indexOf(profile)]={...profile,options:{...profile.options,fallbacks}};}
  return profiles;
}
