/* node test/shell-visible-window.test.js — BUILDS ARE INVISIBLE (mouse-confinement incident, 2026-07-12).
   Locks the shell.exec floor that refuses commands which would put a window on the user's screen: cmd `start`,
   explorer, rundll32 url.dll, and headed browser launches. Equally important: the NON-trips — `npm start`,
   `findstr chrome`, `taskkill /im chrome.exe`, and --headless browser launches must all stay allowed, or the
   agent loses its legitimate build/verify loop. Pure predicate — no spawning, fast gate. */
'use strict';
const A = require('./_assert.js');
const { opensVisibleWindow, inputIsolationRisk } = require('../sidecar/tools/builtin/shell.js');

// ---- blocked: window openers at command position ----
A.ok(opensVisibleWindow('start http://localhost:5173'), 'cmd `start <url>` blocked');
A.ok(opensVisibleWindow('start index.html'), 'cmd `start <file>` blocked');
A.ok(opensVisibleWindow('start'), 'bare `start` (new console window) blocked');
A.ok(opensVisibleWindow('npm run build && start dist\\index.html'), '`start` after && blocked');
A.ok(opensVisibleWindow('echo done & start report.html'), '`start` after & blocked');
A.ok(opensVisibleWindow('echo "x^" & start http://x'), 'cmd caret inside double quotes does not hide a following start command');
A.ok(opensVisibleWindow('cmd /c start http://x'), '`start` behind cmd /c blocked');
A.ok(opensVisibleWindow('cmd /c "start http://x"'), 'quoted whole cmd /c start payload blocked');
A.ok(opensVisibleWindow('call start x.html'), '`start` behind call blocked');
A.ok(opensVisibleWindow('explorer .'), 'explorer blocked');
A.ok(opensVisibleWindow('explorer.exe C:\\somewhere'), 'explorer.exe blocked');
A.ok(opensVisibleWindow('rundll32 url.dll,FileProtocolHandler http://x'), 'rundll32 url.dll blocked');

// ---- blocked: headed browser launches (any path form), allowed again with --headless ----
A.ok(opensVisibleWindow('msedge --remote-debugging-port=9222 http://localhost:5173'), 'headed msedge blocked');
A.ok(opensVisibleWindow('"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" http://x'), 'headed chrome (full path) blocked');
A.ok(opensVisibleWindow('firefox http://localhost:3000'), 'headed firefox blocked');
A.eq(opensVisibleWindow('msedge --headless=new --mute-audio --remote-debugging-port=9222 http://localhost:5173'), null, 'msedge WITH --headless --mute-audio allowed (the sanctioned smoke-test path)');
A.eq(opensVisibleWindow('chrome --headless --mute-audio --dump-dom http://localhost:5173'), null, 'chrome --headless --mute-audio allowed');
A.eq(opensVisibleWindow('chrome "--headless=new" "--mute-audio" about:blank'), null, 'quoted whole-token headless + mute flags allowed');
A.ok(inputIsolationRisk('msedge --headless=new --mute-audio --remote-debugging-port=9222 http://localhost:5173'), 'input-isolation floor still refuses direct headless browsers');
A.ok(inputIsolationRisk('chrome --headless --mute-audio --dump-dom http://localhost:5173'), 'local browser checks must use the owned browser.test_* path');
// a headless browser still plays audio on the user's speakers unless muted — that half of the incident is blocked too
A.ok(opensVisibleWindow('msedge --headless=new --remote-debugging-port=9222 http://x'), 'headless browser without --mute-audio is refused');

// ---- BYPASS HARDENING (code-review 2026-07-12): a browser launched via an alternate launcher, a newline, or
//      a fake headless flag must still be caught (command-head splitting + whole-token flag checks). ----
A.ok(opensVisibleWindow('Start-Process chrome https://evil/game'), 'Start-Process chrome (headed) blocked');
A.ok(opensVisibleWindow('Start-Process -FilePath msedge'), 'Start-Process -FilePath msedge blocked');
A.ok(opensVisibleWindow('Start-Process -NoNewWindow -FilePath "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" https://evil/game'),
  'Start-Process with intervening option + quoted full browser path blocked');
A.ok(opensVisibleWindow('saps firefox'), 'saps (Start-Process alias) firefox blocked');
A.ok(opensVisibleWindow('powershell -Command "start chrome"'), 'start chrome inside powershell -Command blocked');
A.ok(opensVisibleWindow('powershell /Command "start chrome"'), 'start chrome inside slash-prefixed PowerShell /Command blocked');
A.ok(opensVisibleWindow('powershell start http://x'), 'PowerShell default command payload start blocked');
A.ok(opensVisibleWindow('echo hi\nchrome https://x'), 'newline-separated chrome launch blocked');
A.ok(opensVisibleWindow('chrome --headlessx https://evil/game --mute-audio'), 'fake --headlessx (Chrome opens headed) blocked');
A.ok(opensVisibleWindow('msedge --headless-new http://x'), 'fake --headless-new token blocked');
// NON-trips the hardening must preserve
A.eq(opensVisibleWindow('curl -o ./chrome.exe https://example.com/x'), null, 'downloading a file named chrome.exe (browser as ARG) not blocked');
A.eq(opensVisibleWindow('curl https://example.com/firefox.exe -o out'), null, 'firefox.exe as a URL arg not blocked');
A.eq(opensVisibleWindow('git commit -m "start the chrome build"'), null, 'browser words in a commit message not blocked');
A.eq(opensVisibleWindow('echo Start-Process chrome https://example.com'), null, 'Start-Process words in echo output are not a launcher');

// ---- NON-trips: the build/verify loop must keep working ----
A.eq(opensVisibleWindow('npm start'), null, '`npm start` is NOT the cmd start builtin');
A.eq(opensVisibleWindow('npm run start:dev'), null, 'npm run start:* not blocked');
A.eq(opensVisibleWindow('start-server --port 3000'), null, 'start-prefixed binary names not blocked');
A.eq(opensVisibleWindow('findstr chrome tasks.txt'), null, 'chrome as an ARGUMENT not blocked');
A.eq(opensVisibleWindow('tasklist | findstr msedge'), null, 'msedge as a findstr pattern not blocked');
A.eq(opensVisibleWindow('taskkill /im chrome.exe /f'), null, 'taskkill /im chrome.exe not blocked');
A.eq(opensVisibleWindow('node scripts/build.js && npm test'), null, 'plain build chain not blocked');
A.eq(opensVisibleWindow('curl http://localhost:5173/'), null, 'curl verification not blocked');
A.eq(opensVisibleWindow('echo restart the server'), null, 'words containing "start" not blocked');
A.eq(opensVisibleWindow(''), null, 'empty command is not a visible-window trip (empty is refused elsewhere)');

A.report('shell-visible-window.test');
