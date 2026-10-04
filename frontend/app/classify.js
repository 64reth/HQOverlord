/* STARNET — classify.js : is the Commander assigning a TASK (go act, with real tools) or just TALKING?
   Pure + testable (UMD: a `Classify` global in the browser, module.exports under node).

   isTaskDirective gates ONE thing now: TOOL AVAILABILITY (the sidecar wires tools only when isTask). It no
   longer forces the agent to run to its workstation — that desk trip is REACTIVE, fired by a real tool call
   (see chat.js walkToDesk). So the bias stays deliberately toward TASK: a missed task would hand the agent
   ZERO tools ("I can't reach the web / files"), whereas a missed chat only offers unused tools that the
   reactive walk keeps invisible until something is actually used. Explicit actionable intent ALWAYS wins,
   even wrapped in courtesy ("hey, could you research…", "thanks, now find…"); pleasantries, simple
   acknowledgements, and questions about the agent itself stay casual (no tools, no work framing). */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.Classify = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // a verb the agent can carry out (or a filename) -> TASK, regardless of any courtesy wrapper
  const ACTIONABLE = /\b(research|search|google|find|look ?up|fetch|scrape|crawl|download|browse|visit|go to|read|open|write|save|create|generate|build|make|draft|compile|summari[sz]e|report|list|extract|analy[sz]e|investigate|compare|check|calculate|translate|plan|schedule|email|post|send)\b|\.(md|txt|js|ts|py|csv|json|html?|pdf)\b/;
  // pure pleasantries / acknowledgements / short answers — a greeting or ack word, optionally trailed by a
  // few non-actionable tokens ("hey there", "thanks a lot", "sounds good", "good morning friend") over the
  // WHOLE message -> CHAT. (ACTIONABLE is tested first, so a greeting that carries a real instruction —
  // "sure, send it" — never reaches here.) Acks like "yes / got it / sounds good" are answers, not missions.
  const CHATTY = /^(hi+|hey+|hello|yo|sup|hiya|howdy|gm|good (morning|evening|night|afternoon)|good (idea|one|call)|thanks?|thank you|ty|np|nice( one)?|cool|awesome|great( job)?|good job|well done|perfect|exactly|agreed|makes sense|sounds? good|got it|will do|right|correct|ok(ay)?|k|yes|ya|yeah|yep|yup|no|nope|nah|sure|fine|lol|haha|nvm|never ?mind|bye|cya|see ya)([\s,!.?]+\w+){0,3}[\s!.?]*$/;
  // questions ABOUT the agent itself (the WHOLE message; a few trailing words allowed — "how are you today")
  // -> CHAT
  const ABOUT_SELF = /^(how are you|how('?s| is) it going|how do you feel|how'?s your day|who are you|what('?s| is) your name|what are you|are you (ok|okay|alright|there|conscious|sentient|alive|real|happy|sure|awake|busy|free))([\s,!.?]+\w+){0,3}[\s!.?]*$/;

  function isTaskDirective(text) {
    const t = String(text == null ? '' : text).trim().toLowerCase();
    if (!t) return false;
    if (ACTIONABLE.test(t)) return true;            // explicit intent beats a courtesy prefix
    if (CHATTY.test(t) || ABOUT_SELF.test(t)) return false;   // greetings / acks / self-questions: no tools, no work framing
    return true;                                    // default: keep TOOLS available (the desk trip is reactive, so an
                                                    // unused toolset stays invisible — a real task is never left tool-less)
  }

  /* CONTENT TAG — what KIND of work is this, so a FILTER junction can sort it to the right agent's bay.
     This is the conveyor's content-router input: getTag(text) -> the tag a work-item box carries, which a
     filter routes by (config.routes[tag] || config.def). Pure + deterministic + case-insensitive.

     'code' wins over 'research' when both signal (a "look up how to refactor this .ts" IS coding work),
     because a code task misrouted to a researcher loses the toolchain; an ambiguous prompt defaults to
     'general' (the filter's catch-all lane) so nothing is ever dropped. Keep both sets CONSERVATIVE —
     over-tagging mis-sorts work; the default lane is the safe sink. Mirror any change in a filter's routes. */
  const CODE = /\b(code|coding|program(?:ming)?|script(?:ing)?|function|class|method|variable|module|bug|debug|refactor|compile|deploy|commit|rebase|repo(?:sitory)?|git|api|endpoint|database|query|sql|regex|stack ?trace|exception|crash|typescript|javascript|python|rust|golang|css|html|react|node|npm|webpack|lint|unit ?test)\b|\.(?:js|ts|tsx|jsx|py|rs|go|java|cpp?|cs|css|html?|json|ya?ml|sh|sql)\b/;
  const RESEARCH = /\b(research|investigate|look ?up|search|google|web ?search|browse|sources?|cite|citations?|references?|study|survey|literature|paper|articles?|news|headlines?|wikipedia|market|trends?|competitors?|background|find out|gather|fact[ -]?check)\b/;

  // the content tag a work-item carries: 'code' | 'research' | 'general' (the default / catch-all lane)
  function getTag(text) {
    const t = String(text == null ? '' : text).trim().toLowerCase();
    if (!t) return 'general';
    if (CODE.test(t)) return 'code';                // code intent wins (misrouted code loses its toolchain)
    if (RESEARCH.test(t)) return 'research';
    return 'general';                               // ambiguous -> the filter's default lane, never dropped
  }

  /* THE AGENT'S BASELINE STANCE for a turn, from whether the message is a task: a task's baseline is 'task'
     (work pose), chatter's is 'talk' (face the Commander). NOTE: chat.js no longer applies this PREEMPTIVELY
     to start the walk — the live desk trip is reactive (it fires when a real tool runs; see walkToDesk). This
     pure mapping is kept as the canonical task->stance contract and as a regression guard.

     The speaker/voice setting (or any other UI state) MUST NEVER enter this decision. It once did — voice
     defaulting on forced every task to 'talk' — and that exact regression is what this signature forbids:
     stanceFor takes ONLY isTask, so nothing else can flip it. Do NOT add parameters or branches here.
     Locked by classify.test.js. */
  function stanceFor(isTask) { return isTask ? 'task' : 'talk'; }

  return { isTaskDirective, getTag, stanceFor };
});
