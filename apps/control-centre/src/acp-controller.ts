import { createAcpBridge, type CommandContext, type DurableRuntime, type ExecutionResult } from '@hqoverlord/runtime';
import { ids, type BusinessId } from '@hqoverlord/core';
interface Client {businessId:BusinessId;agentId:string;messages:unknown[];pending:Map<string,(value:unknown)=>void>;bridge:ReturnType<typeof createAcpBridge>;}
export function createAcpController(runtime:DurableRuntime,context:(id:BusinessId)=>CommandContext,run:(ctx:CommandContext,id:string)=>Promise<unknown>){
  const clients=new Map<string,Client>();let sequence=0;
  return {
    async handle(businessId:BusinessId,input:{clientId:string;agentId:string;message:unknown}){
      if(!/^[a-zA-Z0-9_-]{1,80}$/.test(input.clientId)||!input.message||typeof input.message!=='object')throw new Error('Invalid editor message');
      let client=clients.get(input.clientId);
      if(client&&(client.businessId!==businessId||client.agentId!==input.agentId))throw new Error('Editor binding cannot change');
      if(!client){
        if(clients.size>=16)throw new Error('Editor client limit reached');
        const messages:unknown[]=[],pending=new Map<string,(value:unknown)=>void>();
        const bridge=createAcpBridge({runtime,context:()=>context(businessId),agentId:ids.agent(input.agentId),execute:async(ctx,id)=>await run(ctx,id) as ExecutionResult,
          notify(method,params){if(messages.length>=1000)throw new Error('Editor stopped consuming notifications');messages.push({jsonrpc:'2.0',method,params});},
          request(method,params){return new Promise(resolve=>{const id=`hq-permission-${++sequence}`;
            const timeout=setTimeout(()=>{pending.delete(id);resolve(null);},110_000);timeout.unref();
            pending.set(id,value=>{clearTimeout(timeout);resolve(value);});messages.push({jsonrpc:'2.0',id,method,params});
          });}});
        client={businessId,agentId:input.agentId,messages,pending,bridge};clients.set(input.clientId,client);
      }
      const message=input.message as {id?:string;method?:string;result?:unknown};
      if(!message.method&&message.id!==undefined){const resolve=client.pending.get(message.id);if(!resolve)throw new Error('Unknown editor request');client.pending.delete(message.id);resolve(message.result);return null;}
      return client.bridge.handleRpc(input.message);
    },
    poll(businessId:BusinessId,id:string){const client=clients.get(id);if(!client||client.businessId!==businessId)throw new Error('Unknown editor client');return client.messages.splice(0);},
    disconnect(businessId:BusinessId,id:string){const client=clients.get(id);if(client?.businessId!==businessId)return;client.bridge.close();for(const resolve of client.pending.values())resolve(null);clients.delete(id);},
    close(){for(const [id,client]of clients)this.disconnect(client.businessId,id);}
  };
}
