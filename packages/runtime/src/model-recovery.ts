import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const classifier=require('../vendor/starnet/sidecar/providers/errorClass.js') as {REASONS:Record<string,{shouldFallback:boolean;shouldRotateCredential:boolean;retryable:boolean}>;classifyApiError(error:unknown,context?:unknown):{reason:string;shouldFallback:boolean;shouldRotateCredential:boolean;retryable:boolean;allowedMaxTokens?:number}};
const recovery=require('../vendor/starnet/sidecar/recovery-policy.js') as {providerFailure(input:unknown):{action:string;delayMs:number}};
export const recoveryReasons=['auth','billing','rate_limit','quota_exhausted','overloaded','server_error','timeout','context_overflow','output_cap','model_not_found','content_policy_blocked','format_error','tls_certificate','local_error','unknown'] as const;
export type RecoveryReason=typeof recoveryReasons[number];
/** Only a classifier enum crosses the durable boundary; provider messages, bodies, headers and keys do not. */
export function modelFailureReason(error:unknown):RecoveryReason {const reason=classifier.classifyApiError(error).reason;return recoveryReasons.includes(reason as RecoveryReason)?reason as RecoveryReason:'unknown';}
export function canFallback(reason:RecoveryReason):boolean {return recovery.providerFailure({classification:{...classifier.REASONS[reason],reason},hasFallback:true,recoveriesUsed:0,maxRecoveries:1,maxRetries:0}).action==='fallback';}
export function retryDelay(reason:RecoveryReason,retriesUsed:number,maxRetries:number,jitterSample=0.5):number|undefined{const next=recovery.providerFailure({classification:{...classifier.REASONS[reason],reason},hasFallback:false,retriesUsed,maxRetries,jitterSample});return next.action==='retry'?next.delayMs:undefined;}

export function modelOutputCeiling(error:unknown):number|undefined{const classification=classifier.classifyApiError(error),cap=classification.allowedMaxTokens;return classification.reason==='output_cap'&&Number.isSafeInteger(cap)&&cap!>0?cap:undefined;}
