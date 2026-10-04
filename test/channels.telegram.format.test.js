/* node test/channels.telegram.format.test.js — markdown -> Telegram HTML, and the transport's parse-error floor.

   THE BUG (2026-07-28, visible in a member's own screenshots): every reply left the sidecar as plain text with
   no parse_mode, so an LLM's ordinary markdown landed on the phone as raw syntax — literal `**bold**`,
   backticks, `## headings`, ``` fences. Covers the converter's balanced-only contract, the security rules
   (escaping, http-only links), and the transport's guarantee that a rejected entity string still delivers. */
'use strict';
const A = require('./_assert.js');
const { toTelegramHtml, toPlainText, isParseError } = require('../sidecar/channels/telegram.format.js');
const { makeTelegramTransport } = require('../sidecar/channels/telegram.transport.js');

const html = s => toTelegramHtml(s).html;

(async () => {
  // ---- what the member was actually seeing ----
  A.eq(html('Here is **bold** text'), 'Here is <b>bold</b> text', '**bold** becomes a real bold entity');
  A.eq(html('run `npm test` now'), 'run <code>npm test</code> now', 'inline code becomes <code>');
  A.eq(html('## Findings'), '<b>Findings</b>', 'a markdown heading becomes a bold line, not a literal #');
  A.eq(html('```js\nconst x = 1;\n```'), '<pre>const x = 1;</pre>', 'a fenced block becomes <pre>');
  A.eq(html('- one\n- two'), '• one\n• two', 'bullet markers become a real bullet glyph');

  // ---- escaping: the case that broke the /tools card ----
  A.eq(html('WEB & BROWSER'), 'WEB &amp; BROWSER', 'a bare & is escaped (this is what would 400 an HTML send)');
  A.eq(html('/talk <name>'), '/talk &lt;name&gt;', 'angle brackets are escaped, never sent as a start tag');
  A.eq(html('a <b>injected</b> tag'), 'a &lt;b&gt;injected&lt;/b&gt; tag', 'model-authored HTML is neutralised, not honoured');

  // ---- balanced-only: an unmatched marker must stay literal rather than emit an unclosed tag ----
  A.eq(html('a **dangling bold'), 'a **dangling bold', 'an unpaired ** stays literal (a chunk split mid-bold)');
  A.eq(html('a `dangling code'), 'a `dangling code', 'an unpaired backtick stays literal');
  A.ok(html('```js\nnot closed').indexOf('<pre>') < 0, 'an unclosed fence never opens a <pre>');
  A.eq(html('snake_case_name and _under_'), 'snake_case_name and _under_', 'underscores are NEVER emphasis (tool names)');
  A.eq(html('2 * 3 * 4'), '2 * 3 * 4', 'a lone star is arithmetic, not emphasis');

  // ---- code interiors are verbatim: no markup is re-scanned inside them ----
  A.eq(html('`**not bold**`'), '<code>**not bold**</code>', 'markdown inside inline code is left alone');
  A.eq(html('`a < b && c`'), '<code>a &lt; b &amp;&amp; c</code>', 'code interiors are still escaped');

  // ---- links: http/https only ----
  A.eq(html('[docs](https://x.com/a)'), '<a href="https://x.com/a">docs</a>', 'an https link becomes an anchor');
  A.eq(html('[x](javascript:alert(1))'), '[x](javascript:alert(1))', 'a javascript: URL is NEVER made tappable');
  A.eq(html('[x](tg://resolve?domain=evil)'), '[x](tg://resolve?domain=evil)', 'a tg:// URL is never made tappable');

  // ---- a forged sentinel cannot inject raw HTML through the placeholder channel ----
  A.ok(html('\u0001' + '0' + '\u0002 <b>x</b>').indexOf('<b>x</b>') < 0, 'a forged placeholder cannot smuggle live HTML');

  // ---- plain-text fallback strips syntax rather than showing it ----
  A.eq(toPlainText('**bold** and `code`'), 'bold and code', 'the fallback strips markers instead of printing them');
  A.eq(toPlainText('[docs](https://x.com)'), 'docs (https://x.com)', 'the fallback keeps the URL readable');
  A.ok(isParseError("Bad Request: can't parse entities: unclosed start tag"), 'an entity error is recognised');
  A.ok(!isParseError('Bad Request: chat not found'), 'a non-entity 400 is NOT retried as plain');

  // ---- THE FLOOR: a rejected entity string must still deliver, exactly once, as plain text ----
  {
    const calls = [];
    const fetchImpl = async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push(body);
      // first attempt (the HTML one) is rejected the way Telegram rejects malformed entities
      if (body.parse_mode === 'HTML') {
        return { ok: true, status: 400, json: async () => ({ ok: false, error_code: 400, description: "Bad Request: can't parse entities: unsupported start tag" }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 42 } }) };
    };
    const t = makeTelegramTransport({ fetch: fetchImpl, token: 'TOK' });
    const r = await t.send('123', 'a **bold** reply');
    A.eq(r.ok, true, 'a parse rejection still delivers the message');
    A.eq(String(r.messageId), '42', 'the delivered message id comes from the successful resend');
    A.eq(calls.length, 2, 'exactly ONE resend — never a loop');
    A.eq(calls[1].parse_mode, undefined, 'the resend carries no parse_mode');
    A.eq(calls[1].text, 'a bold reply', 'the resend is stripped prose, not raw markdown syntax');
  }

  // ---- a NON-entity failure must NOT be resent (it would fail identically and double-post on a flake) ----
  {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push(JSON.parse(init.body));
      return { ok: true, status: 403, json: async () => ({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }) };
    };
    const t = makeTelegramTransport({ fetch: fetchImpl, token: 'TOK' });
    const r = await t.send('123', 'a **bold** reply');
    A.eq(r.ok, false, 'a blocked-bot 403 is reported as a failure');
    A.eq(calls.length, 1, 'a non-entity error is never resent');
  }

  // ---- a caller that sets its OWN parse_mode is left completely alone ----
  {
    const calls = [];
    const fetchImpl = async (url, init) => { calls.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 7 } }) }; };
    const t = makeTelegramTransport({ fetch: fetchImpl, token: 'TOK' });
    await t.send('123', '**raw**', { parse_mode: 'MarkdownV2' });
    A.eq(calls[0].parse_mode, 'MarkdownV2', "an explicit parse_mode is honoured");
    A.eq(calls[0].text, '**raw**', 'and its text is passed through untouched');
  }

  // ---- reply_markup (the consent keyboard) still rides alongside the formatting ----
  {
    const calls = [];
    const fetchImpl = async (url, init) => { calls.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 9 } }) }; };
    const t = makeTelegramTransport({ fetch: fetchImpl, token: 'TOK' });
    await t.send('123', 'Allow **fs_write**?', { reply_markup: { inline_keyboard: [[{ text: 'Yes', callback_data: 'c:t:0' }]] } });
    A.eq(calls[0].parse_mode, 'HTML', 'a keyboard message is still formatted');
    A.ok(!!calls[0].reply_markup, 'and keeps its inline keyboard');
    A.eq(calls[0].text, 'Allow <b>fs_write</b>?', 'the prompt body is formatted too');
  }

  // ---- the STAMPED consent card is formatted too (it is rewritten at the moment the member is looking) ----
  {
    const calls = [];
    const fetchImpl = async (url, init) => { calls.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }) }; };
    const t = makeTelegramTransport({ fetch: fetchImpl, token: 'TOK' });
    await t.editMessage('123', '55', 'Allow **fs_write**?\n\n> approved');
    A.eq(calls[0].parse_mode, 'HTML', 'an edited message is formatted, not reverted to raw markdown');
    A.ok(calls[0].text.indexOf('<b>fs_write</b>') >= 0, 'the stamped card keeps its bold instead of showing **');
  }

  A.report('channels.telegram.format.test');
})();
