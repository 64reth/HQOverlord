'use strict';
// Model-written working understanding, anchored to the user's actual words. Never global memory.
const DIMENSIONS = new Set(['objective','audience','deliverable','scope','constraints','sources','acceptance','safety']);
const clip = (x,n) => String(x == null ? '' : x).trim().slice(0,n);
const texts = (x,n) => (Array.isArray(x) ? x : []).map(v=>clip(v,400)).filter(Boolean).slice(0,n);
const delegate = s => /^\s*(?:use your judgment(?: for the rest)?|just do it|you decide)[.!\s]*$/i.test(String(s || '')) || /\nUse your judgment for the remaining choices\.$/.test(String(s || ''));
function latestAnswer(brief) {
  return (brief.questions || []).filter(q=>q.answer).slice(-1)[0] || null;
}
function normalize(value) {
  const v=value || {};
  return { revision:Math.max(0,Number(v.revision)||0), through:clip(v.through,100),
    facts:(Array.isArray(v.facts)?v.facts:[]).filter(f=>f && DIMENSIONS.has(f.dimension))
      .slice(0,12).map(f=>({dimension:f.dimension,text:clip(f.text,400),quote:clip(f.quote,600),sourceId:clip(f.sourceId,100)})),
    assumptions:texts(v.assumptions,6), unknowns:texts(v.unknowns,6), nextStep:clip(v.nextStep,500) };
}
function validate(value,brief) {
  const v=normalize(value), latest=latestAnswer(brief);
  const expected=latest ? latest.id : 'request';
  if(v.through!==expected) return {ok:false,error:'Read the entire latest answer and set through to '+expected};
  const sources=new Map([['request',brief.originalDirective || '']]);
  for(const q of brief.questions || []) if(q.answer) sources.set(q.id,q.answer);
  for(const f of v.facts) {
    if(!f.text || f.quote.length<3 || !sources.has(f.sourceId) || !sources.get(f.sourceId).includes(f.quote))
      return {ok:false,error:'Each understanding item needs a verbatim quote from request or an answered question, with its sourceId. Put guesses in assumptions.'};
  }
  if(!v.nextStep) return {ok:false,error:'Name the next useful action, including a draft when feedback would resolve the uncertainty.'};
  v.revision=(Number(brief.context && brief.context.revision)||0)+1;
  return {ok:true,context:v};
}
function current(brief) {
  const last=latestAnswer(brief);
  return !!brief.context && brief.context.through===(last ? last.id : 'request');
}
module.exports={normalize,validate,latestAnswer,current,delegate};
