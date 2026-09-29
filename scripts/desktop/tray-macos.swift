// FlowAId's menu bar icon, started by ./flowaid (scripts/desktop.ts) and compiled once into
// .flowaid/tray.
//
// - Its menu opens FlowAId's window or quits FlowAId: choosing an item prints `open` or `quit` on
//   stdout, and the launcher does the rest. Quitting while runs are in progress asks first.
// - The launcher writes what runs in the background on stdin, one JSON line at a time:
//   {"type":"activity","runs":2,"approvals":1,"text":"2 runs in progress · 1 approval waiting"}.
//   The menu shows the text, and the icon shows the number of approvals waiting beside it.
// - The helper exits when its stdin closes, that is, with the launcher, however it stops.
//
// Usage: flowaid-tray <app url> [--self-test]
import AppKit

let appURL = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : ""
let selfTest = CommandLine.arguments.contains("--self-test")

func send(_ command: String) {
  FileHandle.standardOutput.write(Data((command + "\n").utf8))
}

/// The logo mark (apps/web/public/logo-mark.svg, a 32-unit grid) as an 18 pt template image, so
/// macOS tints it for light and dark menu bars. Opacity carries the fork's weights, as in the SVG.
func logoMark() -> NSImage {
  let image = NSImage(size: NSSize(width: 18, height: 18), flipped: true) { _ in
    let s: CGFloat = 18.0 / 32.0
    func p(_ x: CGFloat, _ y: CGFloat) -> NSPoint { NSPoint(x: x * s, y: y * s) }
    func stroke(_ path: NSBezierPath, _ alpha: CGFloat) {
      path.lineWidth = 2.5 * s
      path.lineCapStyle = .round
      path.lineJoinStyle = .round
      NSColor.black.withAlphaComponent(alpha).setStroke()
      path.stroke()
    }
    let input = NSBezierPath()
    input.move(to: p(4, 16))
    input.line(to: p(12, 16))
    stroke(input, 1)
    let up = NSBezierPath()
    up.move(to: p(12, 16))
    up.curve(to: p(24, 7), controlPoint1: p(18, 16), controlPoint2: p(18, 7))
    stroke(up, 1)
    let straight = NSBezierPath()
    straight.move(to: p(12, 16))
    straight.line(to: p(24, 16))
    stroke(straight, 0.55)
    let down = NSBezierPath()
    down.move(to: p(12, 16))
    down.curve(to: p(24, 25), controlPoint1: p(18, 16), controlPoint2: p(18, 25))
    stroke(down, 0.3)
    NSColor.black.setFill()
    NSBezierPath(ovalIn: NSRect(x: (26 - 2.6) * s, y: (7 - 2.6) * s, width: 5.2 * s, height: 5.2 * s)).fill()
    return true
  }
  image.isTemplate = true
  image.accessibilityDescription = "FlowAId"
  return image
}

struct Activity {
  var runs = 0
  var approvals = 0
  var text = "Starting…"
}

func parseActivity(_ line: String) -> Activity? {
  guard let data = line.data(using: .utf8),
    let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
    obj["type"] as? String == "activity",
    let runs = obj["runs"] as? Int, let approvals = obj["approvals"] as? Int,
    let text = obj["text"] as? String
  else { return nil }
  return Activity(runs: runs, approvals: approvals, text: text)
}

final class Tray: NSObject, NSApplicationDelegate {
  var item: NSStatusItem?
  let status = NSMenuItem(title: "Starting…", action: nil, keyEquivalent: "")
  var activity = Activity()

  func applicationDidFinishLaunching(_ notification: Notification) {
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    item.button?.image = logoMark()
    item.button?.imagePosition = .imageLeft
    item.button?.toolTip = "FlowAId"
    let menu = NSMenu()
    let open = NSMenuItem(title: "Open FlowAId", action: #selector(openApp), keyEquivalent: "o")
    open.target = self
    menu.addItem(open)
    menu.addItem(.separator())
    // what runs while the window is closed; choosing it opens the window
    status.action = #selector(openApp)
    status.target = self
    menu.addItem(status)
    let running = NSMenuItem(title: "Running at \(appURL)", action: nil, keyEquivalent: "")
    running.isEnabled = false
    menu.addItem(running)
    menu.addItem(.separator())
    let quit = NSMenuItem(title: "Quit FlowAId", action: #selector(quitApp), keyEquivalent: "q")
    quit.target = self
    menu.addItem(quit)
    item.menu = menu
    self.item = item

    if selfTest { runSelfTest() }
  }

  func apply(_ a: Activity) {
    activity = a
    status.title = a.text
    item?.button?.toolTip = "FlowAId · \(a.text)"
    // the approvals waiting, beside the icon
    item?.button?.title = a.approvals > 0 ? " \(a.approvals)" : ""
  }

  @objc func openApp() { send("open") }

  @objc func quitApp() {
    if activity.runs > 0 && !confirmQuit() { return }
    send("quit")
  }

  func confirmQuit() -> Bool {
    NSApp.activate(ignoringOtherApps: true)
    let alert = NSAlert()
    alert.messageText = "Quit FlowAId?"
    let runs = activity.runs == 1 ? "1 run is" : "\(activity.runs) runs are"
    alert.informativeText =
      "\(runs) in progress. Running steps get up to 30 seconds to finish; queued work continues the next time you start FlowAId."
    alert.alertStyle = .warning
    alert.addButton(withTitle: "Quit FlowAId")
    alert.addButton(withTitle: "Cancel")
    return alert.runModal() == .alertFirstButtonReturn
  }

  /// CI and `pnpm test`: the menu, an activity update and a click, without anyone at the screen.
  func runSelfTest() {
    guard let a = parseActivity(
      #"{"type":"activity","runs":2,"approvals":1,"text":"2 runs in progress · 1 approval waiting"}"#
    ) else { fail("activity line not parsed") }
    apply(a)
    if status.title != a.text { fail("status line not shown") }
    if item?.button?.title != " 1" { fail("approvals badge not shown") }
    if item?.menu?.items.first?.title != "Open FlowAId" { fail("menu not built") }
    openApp()
    send("self-test ok")
    exit(0)
  }

  func fail(_ why: String) -> Never {
    FileHandle.standardError.write(Data("self-test failed: \(why)\n".utf8))
    exit(1)
  }
}

let app = NSApplication.shared
let tray = Tray()
app.delegate = tray

// activity lines from the launcher; stdin closes when the launcher exits, however it exits
if !selfTest {
  Thread {
    while let line = readLine() {
      if let a = parseActivity(line) { DispatchQueue.main.async { tray.apply(a) } }
    }
    DispatchQueue.main.async { NSApp.terminate(nil) }
  }.start()
}

// a menu bar item only: no Dock icon, no app menu
app.setActivationPolicy(.accessory)
app.run()
