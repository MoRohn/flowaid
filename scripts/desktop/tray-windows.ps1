# FlowAId's notification-area icon on Windows, started by ./flowaid (scripts/desktop.ts): the
# same icon and menu as the macOS menu bar helper (tray-macos.swift).
#
# - Its menu (or a click on the icon) opens FlowAId's window, or quits FlowAId: it prints `open`
#   or `quit` on stdout, and the launcher does the rest. Quitting while runs are in progress asks
#   first.
# - The launcher writes what runs in the background on stdin, one JSON line at a time:
#   {"type":"activity","runs":2,"approvals":1,"text":"2 runs in progress, 1 approval waiting"}.
#   The menu and the icon's tooltip show the text; a new approval shows a notification.
# - The icon goes away when stdin closes or the launcher's process does, however it stops.
#
# Usage: tray-windows.ps1 -Url <app url> -ParentPid <launcher pid> [-SelfTest]
param(
  [Parameter(Mandatory = $true)][string]$Url,
  [Parameter(Mandatory = $true)][int]$ParentPid,
  [switch]$SelfTest
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8

# the script stays ASCII (Windows PowerShell 5.1 reads it as ANSI): these come from code points
$Dot = [string][char]0x00B7
$Ellipsis = [string][char]0x2026

function Send([string]$command) {
  [Console]::Out.WriteLine($command)
  [Console]::Out.Flush()
}

# the logo mark (apps/web/public/favicon.svg) drawn at 32 px: a dark tile, the fork, the decision
$bitmap = New-Object System.Drawing.Bitmap 32, 32
$g = [System.Drawing.Graphics]::FromImage($bitmap)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)
$tile = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 23, 23, 28))
$g.FillRectangle($tile, 0, 0, 32, 32)
function Pen([int]$alpha) {
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb($alpha, 255, 255, 255)), 2.75
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  return $pen
}
$g.DrawLine((Pen 255), 5.5, 16, 11.5, 16)
$g.DrawBezier((Pen 255), 11.5, 16, 17, 16, 17, 8, 22.5, 8)
$g.DrawLine((Pen 110), 11.5, 16, 22.5, 16)
$g.DrawBezier((Pen 60), 11.5, 16, 17, 16, 17, 24, 22.5, 24)
$dot = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 107, 147, 255))
$g.FillEllipse($dot, 20.75, 5.25, 5.5, 5.5)
$g.Dispose()

$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
$tray.Text = "FlowAId"

$script:runs = 0
$script:approvals = 0
$script:seen = $false

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$open = $menu.Items.Add("Open FlowAId")
$open.Font = New-Object System.Drawing.Font ($open.Font, [System.Drawing.FontStyle]::Bold)
$open.add_Click({ Send "open" })
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
# what runs while the window is closed; choosing it opens the window
$status = $menu.Items.Add("Starting$Ellipsis")
$status.add_Click({ Send "open" })
$running = $menu.Items.Add("Running at $Url")
$running.Enabled = $false
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$quit = $menu.Items.Add("Quit FlowAId")
$quit.add_Click({
  if ($script:runs -gt 0) {
    $what = if ($script:runs -eq 1) { "1 run is" } else { "$($script:runs) runs are" }
    $answer = [System.Windows.Forms.MessageBox]::Show(
      "$what in progress. Running steps get up to 30 seconds to finish; queued work continues the next time you start FlowAId.",
      "Quit FlowAId?",
      [System.Windows.Forms.MessageBoxButtons]::OKCancel,
      [System.Windows.Forms.MessageBoxIcon]::Warning)
    if ($answer -ne [System.Windows.Forms.DialogResult]::OK) { return }
  }
  Send "quit"
})
$tray.ContextMenuStrip = $menu
$tray.add_MouseClick({
  param($sender, $e)
  if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) { Send "open" }
})
$tray.add_BalloonTipClicked({ Send "open" })

function Apply([string]$line) {
  try { $a = $line | ConvertFrom-Json } catch { return }
  if ($a.type -ne "activity") { return }
  $status.Text = [string]$a.text
  # the notification area keeps tooltips under 64 characters
  $tip = "FlowAId $Dot $($a.text)"
  if ($tip.Length -gt 63) { $tip = $tip.Substring(0, 62) + $Ellipsis }
  $tray.Text = $tip
  # a new approval, not the ones already waiting when FlowAId started
  if ($script:seen -and [int]$a.approvals -gt $script:approvals) {
    $n = [int]$a.approvals
    $body = if ($n -eq 1) { "1 approval waiting" } else { "$n approvals waiting" }
    $tray.ShowBalloonTip(5000, "FlowAId", $body, [System.Windows.Forms.ToolTipIcon]::Info)
  }
  $script:runs = [int]$a.runs
  $script:approvals = [int]$a.approvals
  $script:seen = $true
}

if ($SelfTest) {
  # CI: the menu, an activity update and a click, without anyone at the screen
  $text = "2 runs in progress $Dot 1 approval waiting"
  Apply ('{"type":"activity","runs":2,"approvals":1,"text":"' + $text + '"}')
  if ($status.Text -ne $text) { [Console]::Error.WriteLine("self-test failed: status line"); exit 1 }
  if ($script:runs -ne 2 -or $script:approvals -ne 1) { [Console]::Error.WriteLine("self-test failed: counts"); exit 1 }
  if (-not $tray.Text.StartsWith("FlowAId $Dot 2 runs")) { [Console]::Error.WriteLine("self-test failed: tooltip"); exit 1 }
  $open.PerformClick()
  Send "self-test ok"
  $tray.Dispose()
  exit 0
}

$tray.Visible = $true

# stdin: activity lines from the launcher, read without blocking the icon's message loop
$script:pending = [Console]::In.ReadLineAsync()
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 300
$timer.add_Tick({
  $gone = -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)
  while (-not $gone -and $script:pending.IsCompleted) {
    $line = $script:pending.Result
    if ($null -eq $line) { $gone = $true; break }
    Apply $line
    $script:pending = [Console]::In.ReadLineAsync()
  }
  if ($gone) {
    $timer.Stop()
    $tray.Visible = $false
    $tray.Dispose()
    [System.Windows.Forms.Application]::Exit()
  }
})
$timer.Start()

[System.Windows.Forms.Application]::Run()
$tray.Dispose()
