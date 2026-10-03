import { createRequire } from 'node:module';
interface Specialist {id:string;name:string;purpose:string;manual:string;persona:string;kit:readonly string[];skills:readonly string[];reasoningEffort?:string;}
const catalog=createRequire(import.meta.url)('../vendor/starnet/shared/specialties.js') as {BUILTINS:readonly Specialist[]};
const personas=createRequire(import.meta.url)('../vendor/starnet/frontend/app/personas.js') as {compose(id:string):string};
/** Source-proven instruction presets. Recommended gear does not bypass installation/placement. */
export const specialists=catalog.BUILTINS.map(spec=>({id:spec.id,name:spec.name,instructions:[spec.purpose,spec.manual].join('\n\n').replaceAll('web_search','web.search').replaceAll('web_fetch','web.read'),personality:personas.compose(spec.persona),recommendedGear:spec.kit,skills:spec.skills,reasoningEffort:spec.reasoningEffort}));

export interface SpecialistPreset {id:string;name:string;instructions:string;personality:string;recommendedGear:readonly string[];skills?:readonly string[];reasoningEffort?:string;}
interface CustomSource {id:string;name:string;purpose:string;manual:string;persona:string;kit:string[];skills:string[];reasoningEffort?:string;}
export function customSpecialists(records:readonly Record<string,unknown>[],change?:{remove?:string;save?:Record<string,unknown>}){
 const source=createRequire(import.meta.url)('../vendor/starnet/frontend/app/specialties.js') as {createForStore(storage:unknown):{saveCustom(value:unknown):CustomSource;removeCustom(id:string):boolean;customs():CustomSource[]}};
 const api=source.createForStore({getItem:()=>JSON.stringify(records),setItem:()=>{}});if(change?.remove)api.removeCustom(change.remove);if(change?.save)api.saveCustom(change.save);const customs=api.customs();
 return {records:JSON.parse(JSON.stringify(customs)) as Record<string,unknown>[],presets:customs.map(spec=>({id:spec.id,name:spec.name,instructions:[spec.purpose,spec.manual].join('\n\n'),personality:personas.compose(spec.persona),recommendedGear:spec.kit,skills:spec.skills,reasoningEffort:spec.reasoningEffort}))};
}
