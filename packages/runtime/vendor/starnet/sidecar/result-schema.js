'use strict';
// HQ adapter for the reference result-contract's bounded, non-coercing schema compiler.
const canonical=v=>JSON.stringify(v,(_k,x)=>object(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x),equal=(a,b)=>canonical(a)===canonical(b),has=(o,k)=>Object.hasOwn(o,k),object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const types=['null','boolean','object','array','number','integer','string'];
const keywords=new Set(['$schema','$id','$ref','$defs','definitions','$comment','title','description','default','examples','readOnly','writeOnly','deprecated','type','enum','const','properties','required','additionalProperties','propertyNames','minProperties','maxProperties','dependencies','items','additionalItems','minItems','maxItems','uniqueItems','contains','minLength','maxLength','pattern','minimum','maximum','exclusiveMinimum','exclusiveMaximum','multipleOf','allOf','anyOf','oneOf','not','if','then','else']);
module.exports=class BoundedSchema{
 compile(root){
  const pointer=ref=>ref.slice(2).split('/').reduce((v,k)=>v[k.replace(/~1/g,'/').replace(/~0/g,'~')],root);
  const seen=new Set();function check(s){if(typeof s==='boolean'||seen.has(s))return;seen.add(s);if(!object(s))throw Error('Invalid schema node');for(const k of Object.keys(s))if(!keywords.has(k))throw Error('Unsupported schema keyword: '+k);
   if(s.$ref!==undefined&&(typeof s.$ref!=='string'||!s.$ref.startsWith('#/')))throw Error('Only local JSON Pointer references are supported');if(s.$schema!==undefined&&!['http://json-schema.org/draft-07/schema#','https://json-schema.org/draft-07/schema#'].includes(s.$schema))throw Error('Unsupported schema dialect');
   if(s.type!==undefined&&!(Array.isArray(s.type)?s.type:[s.type]).every(t=>types.includes(t)))throw Error('Invalid schema type');
   for(const k of ['minProperties','maxProperties','minItems','maxItems','minLength','maxLength'])if(s[k]!==undefined&&(!Number.isSafeInteger(s[k])||s[k]<0))throw Error('Invalid schema bound');
   for(const k of ['minimum','maximum','exclusiveMinimum','exclusiveMaximum','multipleOf'])if(s[k]!==undefined&&(typeof s[k]!=='number'||!Number.isFinite(s[k])||k==='multipleOf'&&s[k]<=0))throw Error('Invalid numeric bound');
   if(s.required!==undefined&&(!Array.isArray(s.required)||!s.required.every(k=>typeof k==='string')||new Set(s.required).size!==s.required.length))throw Error('Invalid required properties');
   if(s.enum!==undefined&&(!Array.isArray(s.enum)||!s.enum.length))throw Error('Invalid enum');if(s.pattern!==undefined){if(typeof s.pattern!=='string')throw Error('Invalid pattern');new RegExp(s.pattern);}
   for(const k of ['uniqueItems','readOnly','writeOnly','deprecated'])if(s[k]!==undefined&&typeof s[k]!=='boolean')throw Error('Invalid boolean keyword');
   for(const k of ['properties','$defs','definitions'])if(s[k]!==undefined){if(!object(s[k]))throw Error('Invalid schema map');for(const child of Object.values(s[k]))check(child);}
   if(s.items!==undefined){if(Array.isArray(s.items))s.items.forEach(check);else check(s.items);}
   for(const k of ['additionalItems','additionalProperties','propertyNames','contains','not','if','then','else'])if(s[k]!==undefined)check(s[k]);
   for(const k of ['allOf','anyOf','oneOf'])if(s[k]!==undefined){if(!Array.isArray(s[k])||!s[k].length)throw Error('Invalid schema composition');s[k].forEach(check);}
   if(s.dependencies!==undefined){if(!object(s.dependencies))throw Error('Invalid dependencies');for(const child of Object.values(s.dependencies)){if(Array.isArray(child)){if(!child.every(k=>typeof k==='string'))throw Error('Invalid dependency');}else check(child);}}
  }check(root);
  function match(s,v,path,depth){if(depth>40)return false;if(typeof s==='boolean')return s;if(s.$ref&&!match(pointer(s.$ref),v,path,depth+1))return false;
   const type=t=>t==='null'?v===null:t==='array'?Array.isArray(v):t==='object'?object(v):t==='integer'?typeof v==='number'&&Number.isInteger(v):t==='number'?typeof v==='number'&&Number.isFinite(v):typeof v===t;
   if(s.type!==undefined&&!(Array.isArray(s.type)?s.type:[s.type]).some(type))return false;if(s.enum&&!s.enum.some(e=>equal(e,v))||has(s,'const')&&!equal(s.const,v))return false;
   if(s.allOf&&!s.allOf.every(c=>match(c,v,path,depth+1))||s.anyOf&&!s.anyOf.some(c=>match(c,v,path,depth+1))||s.oneOf&&s.oneOf.filter(c=>match(c,v,path,depth+1)).length!==1||s.not&&match(s.not,v,path,depth+1))return false;
   if(s.if!==undefined){const selected=match(s.if,v,path,depth+1)?s.then:s.else;if(selected!==undefined&&!match(selected,v,path,depth+1))return false;}
   if(typeof v==='number'){if(s.minimum!==undefined&&v<s.minimum||s.maximum!==undefined&&v>s.maximum||s.exclusiveMinimum!==undefined&&v<=s.exclusiveMinimum||s.exclusiveMaximum!==undefined&&v>=s.exclusiveMaximum||s.multipleOf!==undefined&&Math.abs(v/s.multipleOf-Math.round(v/s.multipleOf))>1e-10)return false;}
   if(typeof v==='string'){const length=Array.from(v).length;if(s.minLength!==undefined&&length<s.minLength||s.maxLength!==undefined&&length>s.maxLength||s.pattern!==undefined&&!new RegExp(s.pattern).test(v))return false;}
   if(Array.isArray(v)){if(s.minItems!==undefined&&v.length<s.minItems||s.maxItems!==undefined&&v.length>s.maxItems||s.uniqueItems&&new Set(v.map(canonical)).size!==v.length||s.contains!==undefined&&!v.some(x=>match(s.contains,x,path,depth+1)))return false;
    if(s.items!==undefined)for(let i=0;i<v.length;i++){const child=Array.isArray(s.items)?s.items[i]??s.additionalItems??true:s.items;if(!match(child,v[i],path+'['+i+']',depth+1))return false;}}
   if(object(v)){const keys=Object.keys(v);if(s.minProperties!==undefined&&keys.length<s.minProperties||s.maxProperties!==undefined&&keys.length>s.maxProperties||s.required?.some(k=>!has(v,k)))return false;
    for(const k of keys){if(s.propertyNames!==undefined&&!match(s.propertyNames,k,path,depth+1))return false;const child=has(s.properties??{},k)?s.properties[k]:s.additionalProperties??true;if(!match(child,v[k],path+'.'+k,depth+1))return false;}
    for(const [k,child]of Object.entries(s.dependencies??{}))if(has(v,k)&&(Array.isArray(child)?child.some(name=>!has(v,name)):!match(child,v,path,depth+1)))return false;
   }return true;
  }
  const validate=v=>{let ok=false;try{ok=match(root,v,'$',0);}catch{}validate.errors=ok?null:[{instancePath:'$',message:'does not match the captured result schema'}];return ok;};return validate;
 }
};
