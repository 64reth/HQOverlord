'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('frontend/app/app.js', 'utf8');
const start = source.indexOf('  function launchRecipe(');
const end = source.indexOf('\n  // R5 "BOTTLE A RUN"', start);
assert.ok(start > 0 && end > start);
const calls = [];
let busy = false;
const ctx = {
  agent: {id:'test'}, Recipes: {fillTask:r=>r.task},
  Chat: {isBusy:()=>busy, load:()=>calls.push('load'), send:(text,meta)=>calls.push({text,meta})},
  Workstreams: {create:()=>{calls.push('create');return {id:'s'};}},
  ProspectStore: {noteLaunch:()=>calls.push('recipe-interest')},
  refreshUsage(){},renderRail(){},persist(){}
};
vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);
const task={id:'template',name:'Research',task:'Research this question',params:[]};
assert.equal(ctx.launchRecipe(task,{},{direct:true}),true);
assert.equal(calls.filter(c=>c==='create').length,1);
assert.equal(calls.includes('recipe-interest'),false);
let sent=calls.find(c=>c && c.meta);
assert.equal(sent.text,task.task);
assert.equal(sent.meta.fromRecipe,false);
assert.equal(sent.meta.recipeId,undefined);
calls.length=0;
ctx.launchRecipe(task,{});
sent=calls.find(c=>c && c.meta);
assert.equal(sent.meta.fromRecipe,true);
assert.equal(sent.meta.recipeId,'template');
assert.equal(calls.includes('recipe-interest'),true);
calls.length=0;busy=true;
assert.equal(ctx.launchRecipe(task,{},{direct:true}),false);
assert.equal(calls.length,0);
console.log('direct-work-launch: direct requests preserve text and avoid template attribution; busy launch creates no work');
