<#
  scripts/qa/register-watch.ps1 -- PREPARED scheduling glue for the Self-Testing Station (lane Q5).

  WHAT THIS IS: registers the HEADLESS, KEYLESS QA crew members as Windows Scheduled Tasks so the
  watch runs unattended. It is the single documented activation command for the cron-style jobs
  (see qa/QA_STATION.md section 11/section 13).

  HARD CONSTRAINT (Part 5 read-only / propose-only + this lane's charter): this script is INERT
  until an operator runs it WITH -Apply. Run it with no flags and it only PRINTS what it would
  register (dry-run) -- it registers nothing and changes no system state. Registration is the
  orchestrator's explicit final activation step, NEVER performed by the lane that wrote this file.

  IT REGISTERS (headless, no secret, no judgement -- safe unattended):
    StarNet-QA-Guardian-Hourly   npm run qa:guardian    hourly     (belt-and-suspenders trunk gate)
    StarNet-QA-Beginner-Daily    npm run qa:beginner    daily 09:00 (fresh-user --ui-only path)
    StarNet-QA-Janitor-Weekly    npm run qa:janitor     Sun 09:15  (hygiene sweep, propose-only)

  IT DELIBERATELY DOES NOT REGISTER (these are NOT Task-Scheduler jobs -- see qa/QA_STATION.md):
    - the per-merge Guardian (`npm run qa:guardian:watch`) -- a STANDING PROCESS, started once,
      not a time-triggered task.
    - the `--live` Beginner run -- spends tokens + needs SKYNET_OPENROUTER_KEY from env; a secret
      must NEVER live in a scheduled-task definition. Session-only, weekly.
    - the Overseer digest + Visual Auditor -- Claude /loop SESSIONS (they judge / need eyes); a
      headless task cannot notify or see.

  USAGE:
    pwsh -File scripts/qa/register-watch.ps1              # DRY-RUN: print the plan, register nothing (default)
    pwsh -File scripts/qa/register-watch.ps1 -Apply       # ACTUALLY register the three tasks
    pwsh -File scripts/qa/register-watch.ps1 -Remove      # unregister the three tasks
    pwsh -File scripts/qa/register-watch.ps1 -RepoRoot C:\Users\andro\Desktop\gen -Apply
                                                          # override the repo the tasks run `npm` in
#>

[CmdletBinding()]
param(
  [switch]$Apply,                 # without this, the script only PRINTS the plan (inert dry-run)
  [switch]$Remove,                # unregister the three tasks instead of registering them
  [string]$RepoRoot               # the repo the scheduled `npm` commands run in; defaults to this file's repo
)

$ErrorActionPreference = 'Stop'

# Resolve the repo root: explicit -RepoRoot wins, else two levels up from this script (scripts/qa/ -> repo).
if (-not $RepoRoot -or $RepoRoot.Trim() -eq '') {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}
if (-not (Test-Path (Join-Path $RepoRoot 'package.json'))) {
  Write-Error ("RepoRoot '" + $RepoRoot + "' has no package.json. Pass -RepoRoot pointing at the StarNet repo.")
  exit 1
}

# Resolve npm's launcher so the task doesn't depend on the scheduler's PATH.
$npmCmd = (Get-Command npm.cmd -ErrorAction SilentlyContinue)
if (-not $npmCmd) { $npmCmd = (Get-Command npm -ErrorAction SilentlyContinue) }
$npmPath = if ($npmCmd) { $npmCmd.Source } else { 'npm.cmd' }

# The three headless tasks. Each runs `cmd /c npm run <script>` with the repo as the working dir.
$tasks = @(
  @{ Name = 'StarNet-QA-Guardian-Hourly'; Script = 'qa:guardian'; When = 'hourly';  Desc = 'StarNet QA: hourly trunk green-gate (test:fast + shoot + golden + audit).' }
  @{ Name = 'StarNet-QA-Beginner-Daily';  Script = 'qa:beginner'; When = 'daily';   Desc = 'StarNet QA: daily fresh-user --ui-only reachability run.' }
  @{ Name = 'StarNet-QA-Janitor-Weekly';  Script = 'qa:janitor';  When = 'weekly';  Desc = 'StarNet QA: weekly hygiene sweep (propose-only).' }
)

Write-Host "StarNet QA watch -- scheduled-task registrar"
Write-Host "  repo root : $RepoRoot"
Write-Host "  npm       : $npmPath"
Write-Host "  mode      : $(if ($Remove) { 'REMOVE' } elseif ($Apply) { 'APPLY (registering)' } else { 'DRY-RUN (nothing will change)' })"
Write-Host ""

function New-QaTrigger([string]$when) {
  switch ($when) {
    'hourly' { return (New-ScheduledTaskTrigger -Once -At (Get-Date).Date.AddHours((Get-Date).Hour + 1) -RepetitionInterval (New-TimeSpan -Hours 1)) }
    'daily'  { return (New-ScheduledTaskTrigger -Daily -At '09:00') }
    'weekly' { return (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At '09:15') }
    default  { throw "unknown schedule '$when'" }
  }
}

foreach ($t in $tasks) {
  # No shell chaining: run npm directly with the repo as the working directory (Task Scheduler
  # honors -WorkingDirectory), so we never depend on '&&' (a PS 5.1 parse error) or cmd /c.
  $cmdline = "$npmPath run $($t.Script)   (WorkingDirectory: $RepoRoot)"
  if ($Remove) {
    Write-Host "[remove] $($t.Name)"
    if ($Apply -or $Remove) {
      try { Unregister-ScheduledTask -TaskName $t.Name -Confirm:$false -ErrorAction Stop; Write-Host "         unregistered." }
      catch { Write-Host "         (not present / could not remove: $($_.Exception.Message))" }
    }
    continue
  }

  Write-Host "[task] $($t.Name)  ($($t.When))"
  Write-Host "       run: $cmdline"
  Write-Host "       $($t.Desc)"

  if (-not $Apply) { Write-Host "       DRY-RUN -- not registered."; Write-Host ""; continue }

  $action  = New-ScheduledTaskAction -Execute $npmPath -Argument "run $($t.Script)" -WorkingDirectory $RepoRoot
  $trigger = New-QaTrigger $t.When
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 1)
  Register-ScheduledTask -TaskName $t.Name -Action $action -Trigger $trigger -Settings $settings -Description $t.Desc -Force | Out-Null
  Write-Host "       REGISTERED."
  Write-Host ""
}

if (-not $Apply -and -not $Remove) {
  Write-Host "Nothing was changed (dry-run). Re-run with -Apply to register, -Remove to unregister."
}
