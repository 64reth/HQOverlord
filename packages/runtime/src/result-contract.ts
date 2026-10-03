import {createRequire} from 'node:module';
const source=createRequire(import.meta.url)('../vendor/starnet/sidecar/result-contract.js') as {responseContract(format:unknown):{ok:boolean;schema:Readonly<Record<string,unknown>>|null;error?:string};inspect(schema:unknown,text:string):{ok:boolean;value:unknown;errors:readonly string[]}};
export const responseContract=source.responseContract;
export const inspectResultContract=source.inspect;
