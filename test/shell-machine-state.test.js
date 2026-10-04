/* node test/shell-machine-state.test.js — THE MACHINE IS NOT THE WORKSPACE (incident follow-up, 2026-07-12).
   Locks the shell.exec floors that keep agent builds from touching the user's machine: no shutdown/reboot,
   no killing processes it doesn't own, no persistence (scheduled tasks / Run keys / services / startup),
   no permanent config rewrites (setx/assoc/registry/firewall), no 0.0.0.0 network exposure, and headless
   browsers must --mute-audio. Just as important: the NON-trips — ordinary build/test/git commands that
   happen to contain a scary substring must stay allowed. Pure predicate, no spawning, fast gate. */
'use strict';
const A = require('./_assert.js');
const path = require('path');
const shell = require('../sidecar/tools/builtin/shell.js');
const { breaksMachineState, exposesNetwork, opensVisibleWindow } = shell;

// ---- BLOCKED: machine lifecycle ----
A.ok(breaksMachineState('shutdown /r /t 0'), 'shutdown blocked');
A.ok(breaksMachineState('shutdown -h now'), 'posix shutdown blocked');
A.ok(breaksMachineState('logoff'), 'logoff blocked');
A.ok(breaksMachineState('Restart-Computer -Force'), 'Restart-Computer cmdlet blocked');
A.ok(breaksMachineState('sudo reboot'), 'sudo reboot blocked');

// ---- BLOCKED: killing processes the agent doesn't own ----
A.ok(breaksMachineState('taskkill /im chrome.exe /f'), 'taskkill blocked');
A.ok(breaksMachineState('taskkill /pid 1234 /t /f'), 'taskkill by pid blocked');
A.ok(breaksMachineState('pkill -9 node'), 'pkill blocked');
A.ok(breaksMachineState('killall Safari'), 'killall blocked');
A.ok(breaksMachineState('Stop-Process -Name explorer'), 'Stop-Process cmdlet blocked');

// ---- BLOCKED: persistence that outlives StarNet ----
A.ok(breaksMachineState('schtasks /create /tn evil /tr calc.exe /sc onlogon'), 'schtasks create blocked');
A.ok(breaksMachineState('schtasks /change /tn x /tr y'), 'schtasks change blocked');
A.ok(breaksMachineState('reg add HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run /v x /d game.exe'), 'reg add Run key blocked');
A.ok(breaksMachineState('reg delete HKLM\\Software\\Foo /f'), 'reg delete blocked');
A.ok(breaksMachineState('type HKCU\\Software\\Foo'), 'bare registry hive reference blocked');
A.ok(breaksMachineState('sc create mysvc binPath= C:\\x.exe'), 'sc create service blocked');
A.ok(breaksMachineState('Register-ScheduledTask -TaskName x'), 'Register-ScheduledTask blocked');
A.ok(breaksMachineState('copy game.exe "%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\g.exe"'), 'Startup folder write blocked');
A.ok(breaksMachineState('cp app "shell:startup"'), 'shell:startup blocked');

// ---- BLOCKED: permanent config rewrites / disruptive system tools ----
A.ok(breaksMachineState('setx PATH C:\\broken'), 'setx blocked');
A.ok(breaksMachineState('assoc .txt=badfile'), 'assoc blocked');
A.ok(breaksMachineState('netsh advfirewall set allprofiles state off'), 'netsh blocked');
A.ok(breaksMachineState('net user hacker Pass123 /add'), 'net user blocked');
A.ok(breaksMachineState('format d:'), 'format blocked');
A.ok(breaksMachineState('diskpart /s script.txt'), 'diskpart blocked');
A.ok(breaksMachineState('vssadmin delete shadows /all'), 'vssadmin blocked');
A.ok(breaksMachineState('bcdedit /set safeboot minimal'), 'bcdedit blocked');
A.ok(breaksMachineState('Set-ExecutionPolicy Unrestricted'), 'Set-ExecutionPolicy blocked');
A.ok(breaksMachineState('defaults write com.apple.dock foo -bool true'), 'macOS defaults write blocked');
A.ok(breaksMachineState('systemctl stop firewalld'), 'systemctl blocked');
A.ok(breaksMachineState('crontab -r'), 'crontab blocked');

// ---- BLOCKED: network exposure ----
A.ok(exposesNetwork('vite --host 0.0.0.0'), '0.0.0.0 bind blocked');
A.ok(exposesNetwork('python -m http.server --bind 0.0.0.0 8000'), '0.0.0.0 python server blocked');
A.eq(exposesNetwork('vite --host 127.0.0.1'), null, 'loopback bind allowed');

// ---- BLOCKED: headless browser without --mute-audio (the phantom-audio half of the incident) ----
A.ok(opensVisibleWindow('msedge --headless=new --remote-debugging-port=9222 http://x'), 'headless browser without --mute-audio blocked');
A.eq(opensVisibleWindow('msedge --headless=new --mute-audio --remote-debugging-port=9222 http://x'), null, 'headless + --mute-audio allowed');

// ---- NON-TRIPS: ordinary build/test/git work must keep working ----
A.eq(breaksMachineState('npm run format'), null, 'npm run format not blocked');
A.eq(breaksMachineState('git log --format=%H'), null, 'git log --format not blocked');
A.eq(breaksMachineState('prettier --write src/'), null, 'prettier write not blocked');
A.eq(breaksMachineState('Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion | Format-List'), null,
  'PowerShell Format-List in a read-only GPU inventory pipeline is not confused with disk format');
A.eq(breaksMachineState('powershell -NoProfile -Command "Get-CimInstance Win32_VideoController | Select-Object Name | Format-List"'), null,
  'nested read-only PowerShell inventory with Format-List is allowed');
A.eq(breaksMachineState('Format-List'), null, 'PowerShell Verb-Noun commands do not collide with shorter machine executables');
A.eq(breaksMachineState('echo shutdown the server when done'), null, 'the WORD shutdown in echo not blocked');
A.eq(breaksMachineState('node kill-switch.js'), null, 'a file named kill-* not blocked');
A.eq(breaksMachineState('npm start'), null, 'npm start not blocked (machine floor)');
A.eq(breaksMachineState('grep -r "taskkill" docs/'), null, 'grepping for taskkill not blocked');
A.eq(breaksMachineState('cat src/registry.js'), null, 'a file named registry.js not blocked');
A.eq(breaksMachineState('node scripts/reset-db.js'), null, 'reset-db script not blocked');
A.eq(breaksMachineState('git net-fetch'), null, 'net as part of another token not blocked');
A.eq(breaksMachineState('service-worker.js'), null, 'service-worker filename not blocked');
A.eq(breaksMachineState(''), null, 'empty command not a machine trip');
A.ok(breaksMachineState('format.com d:'), 'the real Windows format.com utility remains blocked');

// ---- BYPASS HARDENING (code-review 2026-07-12): dangerous verbs hidden behind a launcher, separator, or
//      interpreter must still be caught (command-head splitting), and false-positive rework must hold. ----
A.ok(breaksMachineState('powershell -Command "shutdown /r /t 0"'), 'powershell -Command shutdown blocked');
A.ok(breaksMachineState('powershell /Command "shutdown /r /t 0"'), 'powershell slash /Command shutdown blocked');
A.ok(breaksMachineState('powershell shutdown /r /t 0'), 'PowerShell default command payload shutdown blocked');
A.eq(breaksMachineState('powershell Write-Output STARNET_SAFE'), null, 'safe PowerShell default command payload allowed');
A.ok(breaksMachineState('cmd /c "shutdown /r /t 0"'), 'quoted whole cmd /c shutdown payload blocked');
A.ok(breaksMachineState('powershell -NoProfile -Command "Stop-Computer"'), 'powershell -Command Stop-Computer blocked');
A.ok(breaksMachineState('pwsh -c "Restart-Computer"'), 'pwsh -c Restart-Computer blocked');
A.ok(breaksMachineState('sh -c "shutdown -h now"'), 'sh -c shutdown blocked');
A.ok(breaksMachineState('bash -c reboot'), 'bash -c reboot blocked');
A.ok(breaksMachineState('Start-Process shutdown -ArgumentList /r'), 'Start-Process shutdown blocked');
A.ok(breaksMachineState('Start-Process -NoNewWindow -FilePath shutdown -ArgumentList /r'), 'Start-Process options before -FilePath shutdown blocked');
A.ok(breaksMachineState('powershell -Command "Start-Process -WorkingD . shutdown /r"'), 'Start-Process accepted -WorkingDirectory abbreviation consumes its value before shutdown');
A.ok(breaksMachineState('powershell -Command "Start-Process -FilePath:shutdown -ArgumentList /r"'), 'Start-Process inline -FilePath:value treats value as executable');
A.ok(breaksMachineState('powershell -Command "Start-Process -F:shutdown -ArgumentList /r"'), 'Start-Process abbreviated inline -F:value treats value as executable');
A.ok(breaksMachineState('powershell -Command "Start-Process -FilePath=shutdown -ArgumentList /r"'), 'Start-Process inline -FilePath=value is parsed fail-closed');
A.ok(breaksMachineState('echo hi\nshutdown /r'), 'newline-separated shutdown blocked');
A.ok(breaksMachineState('foo & reg add HKCU\\x /v y /d z'), 'reg add after & blocked');
A.ok(breaksMachineState('powershell -e UwB0AG8AcAAtAENvbXB1dGVy'), 'powershell -e (base64 encoded) blocked outright');
A.ok(breaksMachineState('powershell -EncodedCommand ABCDEF'), 'powershell -EncodedCommand blocked outright');
A.ok(breaksMachineState('schtasks /create /tn x /tr calc.exe & echo /query'), 'schtasks /create is NOT voided by a trailing /query');
// NON-trips that the hardening must preserve
A.eq(breaksMachineState('gcc -c file.c'), null, 'gcc -c (compile flag, not sh -c) allowed');
A.eq(breaksMachineState('grep -c pattern file.txt'), null, 'grep -c (count flag) allowed');
A.eq(breaksMachineState('powershell -ExecutionPolicy Bypass -File build.ps1'), null, 'powershell -ExecutionPolicy -File is NOT an encoded command');
A.eq(breaksMachineState('schtasks /query /tn x'), null, 'schtasks /query (read-only) allowed');
A.eq(breaksMachineState('echo restart-computer is a cmdlet'), null, 'the WORDS in an echo arg (no cmdlet at head) allowed');
A.eq(breaksMachineState('echo Start-Process shutdown /r'), null, 'Start-Process words in echo output are not a launcher');
if (process.platform === 'win32') A.eq(breaksMachineState('echo ^& shutdown /r'), null, 'cmd caret-escaped separator stays echo data, not a second command');
if (process.platform === 'win32') {
  A.ok(breaksMachineState('echo "x^" & shutdown /r /t 0'), 'cmd caret inside double quotes does not escape the closing quote');
  A.ok(breaksMachineState("echo 'x & shutdown /r /t 0 & rem '"), 'cmd.exe single quotes do not hide command separators');
  A.eq(breaksMachineState("echo 'x & shutdown /r /t 0 & rem '", 'posix'), null, 'POSIX single quotes still protect separators');
}
A.ok(breaksMachineState("echo 'x\\' ; shutdown -h now", 'posix'), 'POSIX backslash is literal inside single quotes and cannot hide shutdown');
A.ok(breaksMachineState("Write-Output 'x`' ; shutdown -h now", 'powershell'), 'PowerShell backtick is literal inside single quotes and cannot hide shutdown');
A.eq(breaksMachineState('Write-Output "x`" ; shutdown -h now"', 'powershell'), null, 'PowerShell backtick inside double quotes escapes the quote and keeps shutdown as string data');

// cmd expansion is too broad to emulate safely. Fail closed only when the whole executable head is dynamic.
A.ok(breaksMachineState('set "STARNET_VERB=shutdown" & call %STARNET_VERB% /r /t 0'), 'call-expanded %VAR% executable head refused');
A.ok(breaksMachineState('cmd /v:on /c "set STARNET_VERB=shutdown&!STARNET_VERB! /r /t 0"'), 'delayed !VAR! executable head refused');
A.eq(breaksMachineState('echo %PATH%'), null, 'ordinary percent expansion as an argument remains allowed');
A.eq(breaksMachineState('echo !STARNET_VERB!'), null, 'ordinary delayed expansion as an argument remains allowed');

// Windows PowerShell accepts every unambiguous prefix below. Drive only a SAFE payload on this host, then assert
// the parser rejects the same executable switches before an opaque/dangerous payload can ever reach PowerShell.
const PS_COMMAND_FLAGS = ['-c', '-co', '-com', '-comm', '-comma', '-comman', '-command'];
const PS_ENCODED_FLAGS = ['-e', '-ec', '-en', '-enc', '-enco', '-encod', '-encode', '-encoded', '-encodedc',
  '-encodedco', '-encodedcom', '-encodedcomm', '-encodedcomma', '-encodedcomman', '-encodedcommand'];
const PS_SLASH_COMMAND_FLAGS = PS_COMMAND_FLAGS.map(flag => '/' + flag.slice(1));
const PS_SLASH_ENCODED_FLAGS = PS_ENCODED_FLAGS.map(flag => '/' + flag.slice(1));
for (const flag of PS_COMMAND_FLAGS) {
  A.ok(breaksMachineState('powershell ' + flag + ' "shutdown /r /t 0"'), 'PowerShell ' + flag + ' command abbreviation blocked');
}
for (const flag of PS_ENCODED_FLAGS) {
  A.ok(breaksMachineState('powershell ' + flag + ' UwB0AG8AcAAtAENvbXB1dGVy'), 'PowerShell ' + flag + ' encoded abbreviation blocked');
}
for (const flag of PS_SLASH_COMMAND_FLAGS) {
  A.ok(breaksMachineState('powershell ' + flag + ' "shutdown /r /t 0"'), 'PowerShell ' + flag + ' slash command abbreviation blocked');
}
for (const flag of PS_SLASH_ENCODED_FLAGS) {
  A.ok(breaksMachineState('powershell ' + flag + ' UwB0AG8AcAAtAENvbXB1dGVy'), 'PowerShell ' + flag + ' slash encoded abbreviation blocked');
}
if (process.platform === 'win32') {
  const { spawnSync } = require('child_process');
  const psExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const cmdExe = process.env.ComSpec || path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe');
  const outputLines = (s) => String(s || '').split(/\r?\n/).filter(Boolean);
  const caretSafe = spawnSync(cmdExe, ['/d', '/s', '/c', 'echo "x^" & echo STARNET_CMD_SECOND'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  A.eq(caretSafe.status, 0, 'harmless host cmd caret/quote probe executed');
  A.ok(outputLines(caretSafe.stdout).includes('STARNET_CMD_SECOND'), 'host cmd confirms caret inside quotes did not hide the second command');
  for (const dynamic of [
    { args: ['/d', '/c', 'call %STARNET_VERB% STARNET_CALL_SECOND'], line: 'STARNET_CALL_SECOND' },
    { args: ['/d', '/v:on', '/c', '!STARNET_VERB! STARNET_DELAYED_SECOND'], line: 'STARNET_DELAYED_SECOND' }
  ]) {
    const safe = spawnSync(cmdExe, dynamic.args, { encoding: 'utf8', timeout: 10000, windowsHide: true, env: Object.assign({}, process.env, { STARNET_VERB: 'echo' }) });
    A.eq(safe.status, 0, 'harmless host cmd dynamic-head probe executed');
    A.ok(outputLines(safe.stdout).includes(dynamic.line), 'host cmd confirms dynamic executable head expansion');
  }
  const psSingleQuote = spawnSync(psExe, ['-NoProfile', '-NonInteractive', '-Command', "Write-Output 'x`' ; Write-Output STARNET_PS_SINGLE_SECOND"], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  A.ok(outputLines(psSingleQuote.stdout).includes('STARNET_PS_SINGLE_SECOND'), 'host PowerShell confirms backtick is literal inside single quotes');
  const psDoubleQuote = spawnSync(psExe, ['-NoProfile', '-NonInteractive', '-Command', 'Write-Output "x`" ; Write-Output STARNET_PS_DOUBLE_SECOND"'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  A.ok(!outputLines(psDoubleQuote.stdout).includes('STARNET_PS_DOUBLE_SECOND'), 'host PowerShell confirms backtick escapes a quote inside double quotes');
  const gitSh = 'C:\\Program Files\\Git\\bin\\sh.exe';
  if (require('fs').existsSync(gitSh)) {
    const posixSingleQuote = spawnSync(gitSh, ['-c', "printf '%s\\n' 'x\\' ; printf '%s\\n' STARNET_POSIX_SECOND"], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    A.eq(posixSingleQuote.status, 0, 'harmless Git sh single-quote probe executed');
    A.ok(outputLines(posixSingleQuote.stdout).includes('STARNET_POSIX_SECOND'), 'Git sh confirms backslash is literal inside POSIX single quotes');
  }
  const defaultSafe = spawnSync(psExe, ['-NoProfile', '-NonInteractive', 'Write-Output', 'STARNET_SAFE'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  A.eq(defaultSafe.status, 0, 'host accepts a safe implicit/default PowerShell command payload');
  A.ok(/STARNET_SAFE/.test(defaultSafe.stdout || ''), 'safe implicit/default PowerShell payload executed as expected');
  for (const flag of PS_COMMAND_FLAGS) {
    const safe = spawnSync(psExe, ['-NoProfile', '-NonInteractive', flag, 'Write-Output STARNET_SAFE'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    A.eq(safe.status, 0, 'host accepts PowerShell ' + flag + ' for a safe command payload');
    A.ok(/STARNET_SAFE/.test(safe.stdout || ''), 'safe PowerShell ' + flag + ' payload executed as expected');
  }
  const safeEncoded = Buffer.from('Write-Output STARNET_SAFE', 'utf16le').toString('base64');
  for (const flag of PS_ENCODED_FLAGS) {
    const safe = spawnSync(psExe, ['-NoProfile', '-NonInteractive', flag, safeEncoded], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    A.eq(safe.status, 0, 'host accepts PowerShell ' + flag + ' for a safe encoded payload');
    A.ok(/STARNET_SAFE/.test(safe.stdout || ''), 'safe PowerShell ' + flag + ' encoded payload executed as expected');
  }
  for (const flag of PS_SLASH_COMMAND_FLAGS) {
    const safe = spawnSync(psExe, ['-NoProfile', '-NonInteractive', flag, 'Write-Output STARNET_SAFE'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    A.eq(safe.status, 0, 'host accepts PowerShell ' + flag + ' for a safe command payload');
    A.ok(/STARNET_SAFE/.test(safe.stdout || ''), 'safe PowerShell ' + flag + ' payload executed as expected');
  }
  for (const flag of PS_SLASH_ENCODED_FLAGS) {
    const safe = spawnSync(psExe, ['-NoProfile', '-NonInteractive', flag, safeEncoded], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    A.eq(safe.status, 0, 'host accepts PowerShell ' + flag + ' for a safe encoded payload');
    A.ok(/STARNET_SAFE/.test(safe.stdout || ''), 'safe PowerShell ' + flag + ' encoded payload executed as expected');
  }
  for (const fileFlag of ['-FilePath:cmd.exe', '-F:cmd.exe']) {
    // The claim under test is PARSER SEMANTICS: the colon form binds FilePath and LAUNCHES the named
    // exe (which is why the blocker upstream must catch it). The child's exit code is NOT part of that
    // claim — under a Task-Scheduler batch-logon token (the hourly Guardian) $p.ExitCode reads
    // unreliably for -NoNewWindow children and turned this probe RED in every scheduled cycle while
    // interactive runs stayed green (2026-07-15). Assert launch, not child exit hygiene.
    const script = "$p=Start-Process " + fileFlag + " -ArgumentList '/d /c exit 0' -NoNewWindow -Wait -PassThru; if (-not $p -or $p.Id -le 0) { exit 9 }; Write-Output STARNET_SAFE; Write-Output (\"STARNET_CHILD_EXIT=[\" + $p.ExitCode + \"]\")";
    const safe = spawnSync(psExe, ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    A.eq(safe.status, 0, 'host accepts safe inline Start-Process ' + fileFlag + ' form (process launched)');
    A.ok(/STARNET_SAFE/.test(safe.stdout || '') && !/ParameterBindingException/.test(safe.stderr || ''), 'safe inline ' + fileFlag + ' target launched hidden with the flag bound as FilePath');
  }
  // Query metadata only (no process is launched): for every value-taking Start-Process parameter this host
  // actually exposes, derive its shortest unambiguous abbreviation and prove the parser consumes that value
  // before inspecting the positional executable. FilePath itself is the executable and is checked directly.
  const metadataScript = "$p=(Get-Command Start-Process).Parameters.Values; $p | ForEach-Object { [pscustomobject]@{ Name=$_.Name; Switch=($_.ParameterType.FullName -eq 'System.Management.Automation.SwitchParameter') } } | ConvertTo-Json -Compress";
  const metadataRun = spawnSync(psExe, ['-NoProfile', '-NonInteractive', '-Command', metadataScript], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  A.eq(metadataRun.status, 0, 'host Start-Process parameter metadata is readable without launching a process');
  let hostParams = JSON.parse(metadataRun.stdout || '[]');
  if (!Array.isArray(hostParams)) hostParams = [hostParams];
  const hostNames = hostParams.map(p => String(p.Name));
  const abbreviation = (name) => {
    for (let n = 1; n <= name.length; n++) {
      const prefix = name.slice(0, n).toLowerCase();
      if (hostNames.filter(x => x.toLowerCase().indexOf(prefix) === 0).length === 1) return name.slice(0, n);
    }
    return name;
  };
  for (const param of hostParams.filter(p => !p.Switch)) {
    const abbr = abbreviation(String(param.Name));
    const command = String(param.Name).toLowerCase() === 'filepath'
      ? 'powershell -Command "Start-Process -' + abbr + ' shutdown /r"'
      : 'powershell -Command "Start-Process -' + abbr + ' placeholder shutdown /r"';
    A.ok(breaksMachineState(command), 'host-accepted Start-Process -' + abbr + ' abbreviation cannot hide shutdown');
  }
}

// ---- network exposure rework: explicit all-interfaces binds blocked; client 0.0.0.0 + bare mentions allowed ----
A.ok(exposesNetwork('vite --host'), 'bare --host (framework binds 0.0.0.0) blocked');
A.ok(exposesNetwork('server --host=::'), '--host=:: (IPv6 all-interfaces) blocked');
A.ok(exposesNetwork('flask run --host 0.0.0.0'), '--host 0.0.0.0 (space form) blocked');
A.eq(exposesNetwork('curl http://0.0.0.0:3000/health'), null, 'curl to 0.0.0.0 (client target, resolves loopback) allowed');
A.eq(exposesNetwork('echo binding to 0.0.0.0 disabled'), null, 'echo mentioning 0.0.0.0 allowed');
A.eq(exposesNetwork('vite --host 127.0.0.1'), null, '--host 127.0.0.1 allowed');

// ---- integration: the real shell.exec tool refuses a machine-state command with a helpful message ----
const fs = require('fs'), os = require('os');
const { spawn } = require('child_process');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-mach-'));
const tool = shell.makeShellTool({ spawn, fs, pathMod: path, root, clock: { now: () => 0 }, redact: s => s }).execTool;
const ctx = { agentId: 'a1', runId: 'r1', callId: 'c1', emit: () => {} };
(async () => {
  A.throws(() => tool.run({ cmd: 'shutdown /r /t 0' }, ctx), 'shutdown refused by the tool');
  A.throws(() => tool.run({ cmd: 'reg add HKCU\\x /v y /d z' }, ctx), 'reg add refused by the tool');
  A.throws(() => tool.run({ cmd: 'vite --host 0.0.0.0' }, ctx), '0.0.0.0 bind refused by the tool');
  // and a normal command still runs
  const r = await tool.run({ cmd: 'echo machine-floor-ok' }, ctx);
  A.ok(/machine-floor-ok/.test(r.content), 'ordinary command still runs under the machine floor');
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
  A.report('shell-machine-state.test');
})().catch(e => { console.error(e); process.exit(1); });
