/* node test/qa-message-content.test.js — locks the QA provider mocks to both
   supported message-content wire shapes, including cacheable Anthropic blocks. */
'use strict';
const A = require('./_assert.js');
const { messageContentText } = require('../scripts/lib/message-content.mjs');

A.eq(messageContentText('plain prompt'), 'plain prompt', 'plain string content is unchanged');
A.eq(messageContentText([
  { type: 'text', text: '[WORKSHOP_SHIFT] build journey demo', cache_control: { type: 'ephemeral' } }
]), '[WORKSHOP_SHIFT] build journey demo', 'cacheable structured text is extracted');
A.eq(messageContentText([
  { type: 'image_url', image_url: { url: 'data:image/png;base64,x' } },
  { type: 'text', text: 'write a short note to a file' }
]), 'write a short note to a file', 'non-text blocks are ignored without corrupting routing text');
A.eq(messageContentText({ type: 'text', text: 'single text block' }), 'single text block', 'a single text block is accepted defensively');
A.eq(messageContentText({ type: 'image_url' }), '', 'unknown objects never stringify as object noise');
A.eq(messageContentText(null), '', 'missing content is empty text');

A.report('qa-message-content.test');
