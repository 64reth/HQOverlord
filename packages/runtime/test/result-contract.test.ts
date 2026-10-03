import assert from 'node:assert/strict';
import test from 'node:test';
import {responseContract,inspectResultContract} from '../src/index.ts';
test('bounded source result contracts enforce local references, unions, numeric/string bounds and actual strict JSON without coercion',()=>{
 const schema={type:'object',required:['id','items'],properties:{id:{$ref:'#/$defs/id'},items:{type:'array',minItems:1,uniqueItems:true,items:{oneOf:[{type:'integer',minimum:0,maximum:10},{type:'string',pattern:'^[a-z]+$',maxLength:8}]}}},additionalProperties:false,$defs:{id:{type:'string',pattern:'^[a-z]+$',minLength:1,maxLength:8}}};
 const contract=responseContract({type:'json_schema',json_schema:{schema}});assert.equal(contract.ok,true);for(const value of [{id:'actual',items:[1,'evidence']},{id:'a',items:[0]}])assert.equal(inspectResultContract(schema,JSON.stringify(value)).ok,true);
 for(const value of [{id:'actual',items:[-1]},{id:'TOO-BIG',items:[1]},{id:'a',items:[1,1]},{id:'a',items:[]},{id:'a',items:[1],toString:1},{id:1,items:[1]}])assert.equal(inspectResultContract(schema,JSON.stringify(value)).ok,false);
 assert.equal(inspectResultContract(schema,'Here is JSON: {}').ok,false);assert.equal(inspectResultContract({enum:[{a:1,b:2}]},'{"b":2,"a":1}').ok,true);assert.equal(inspectResultContract({type:'array',contains:false},'[1]').ok,false);assert.equal(inspectResultContract({if:false,else:{const:42}},'41').ok,false);
});
test('source result contract rejects external or recursive resolution, unsafe regular expressions and unsupported grammar before dispatch',()=>{
 for(const schema of [{$ref:'https://attacker.invalid/schema'},{$ref:'#/$defs/cycle',$defs:{cycle:{$ref:'#/$defs/cycle'}}},{type:'string',pattern:'(a+)+'},{type:'object',patternProperties:{'.*':{}}},{type:'string',unknownConstraint:true},{type:'string',format:'unknown-format'},{type:'integer',minimum:'zero'}])assert.equal(responseContract({type:'json_schema',json_schema:{schema}}).ok,false);
 assert.deepEqual(responseContract({type:'json_object'}).schema,{type:'object'});assert.equal(responseContract({type:'text'}).schema,null);assert.equal(responseContract({type:'invented'}).ok,false);
});
