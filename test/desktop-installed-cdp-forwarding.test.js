/* node test/desktop-installed-cdp-forwarding.test.js
   The installed smoke launches the real packaged Tauri shell and attaches through
   WebView2 CDP. Tauri's explicit environment options otherwise swallow the ambient
   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS variable. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'main.rs'), 'utf8');
const config = fs.readFileSync(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8');

A.ok(/cfg\(windows\)[\s\S]{0,900}std::env::var\("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"\)/.test(main),
  'Windows window construction reads the explicit WebView2 browser-argument override');
A.ok(/Ok\(args\) if !args\.trim\(\)\.is_empty\(\)[\s\S]{0,900}additional_browser_args\(&args\)/.test(main),
  'a non-empty explicit override reaches the Tauri WebView builder');
A.ok(/_ => main_window/.test(main),
  'ordinary launches preserve the closed production WebView configuration');
A.ok(!/remote-debugging-port/.test(config),
  'the production Tauri config never enables a debugger by default');
A.ok(/Never log the argument value/.test(main),
  'the diagnostic log records forwarding without echoing caller-controlled arguments');

A.report('desktop-installed-cdp-forwarding.test');
