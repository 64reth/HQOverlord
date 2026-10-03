'use strict';
// HQ adaptation: do not log model-controlled paths/content or credentials.
const counts = new Map();
function note(tag) { const key=String(tag); counts.set(key,(counts.get(key)||0)+1); console.warn('[tool auxiliary failure]',key); }
module.exports={note,swallow:tag=>()=>note(tag)};
