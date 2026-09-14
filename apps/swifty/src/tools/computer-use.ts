import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import sharp from "sharp";
import { safeParse, z } from "zod";

import type {
  Tool,
  ToolCategory,
  ToolContext,
  ToolResult,
  ToolResultContentBlock,
  ToolSchema,
} from "./types.js";

import { maybeResizeAndDownsampleImage } from "@/images/image.js";
import { asErrorString } from "@/utils/index.js";

const ACTIONS = [
  "key",
  "hold_key",
  "type",
  "cursor_position",
  "mouse_move",
  "left_mouse_down",
  "left_mouse_up",
  "left_click",
  "left_click_drag",
  "right_click",
  "middle_click",
  "double_click",
  "triple_click",
  "scroll",
  "wait",
  "screenshot",
  "zoom",
  "click",
  "drag",
  "keypress",
  "move",
] as const;

const CoordinateSchema = z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]);
const PathPointSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
});
const ComputerUseInputSchema = z.object({
  action: z.enum(ACTIONS),
  coordinate: CoordinateSchema.optional(),
  duration: z.number().nonnegative().max(60).optional(),
  region: z
    .tuple([
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
    ])
    .optional(),
  scroll_amount: z.number().optional(),
  scroll_direction: z.enum(["up", "down", "left", "right"]).optional(),
  start_coordinate: CoordinateSchema.optional(),
  text: z.string().max(10_000).optional(),
  x: z.number().int().nonnegative().optional(),
  y: z.number().int().nonnegative().optional(),
  button: z.enum(["left", "right", "wheel", "middle", "back", "forward"]).optional(),
  keys: z.array(z.string().min(1)).max(8).optional(),
  path: z.array(PathPointSchema).min(2).max(200).optional(),
  scroll_x: z.number().optional(),
  scroll_y: z.number().optional(),
});

type ComputerUseInput = z.infer<typeof ComputerUseInputSchema>;
type ComputerUseEnvironment = "windows" | "mac" | "browser" | "linux" | "ubuntu";
type Point = { x: number; y: number };
type NativeAction =
  | "cursor_position"
  | "hold_key"
  | "key"
  | "left_click_drag"
  | "left_mouse_down"
  | "left_mouse_up"
  | "mouse_click"
  | "mouse_move"
  | "scroll"
  | "type";

interface NativeInput {
  action: NativeAction;
  button?: "left" | "right" | "middle" | "back" | "forward";
  clicks?: number;
  duration?: number;
  keys?: string[];
  path?: Point[];
  scrollX?: number;
  scrollY?: number;
  text?: string;
  x?: number;
  y?: number;
}

interface CommandResult {
  code: number;
  stdout: Buffer;
  stderr: string;
}

interface CommandOptions {
  env?: NodeJS.ProcessEnv;
  maxOutputBytes?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

type CommandRunner = (
  command: string,
  args: readonly string[],
  options?: CommandOptions,
) => Promise<CommandResult>;

export interface ComputerUseToolOptions {
  environment?: ComputerUseEnvironment;
  platform?: NodeJS.Platform;
  runCommand?: CommandRunner;
}

const COMMAND_TIMEOUT_MS = 15_000;
const MAX_COMMAND_OUTPUT_BYTES = 32 * 1024 * 1024;
const MAX_SCREENSHOT_WIDTH = 1366;
const MAX_SCREENSHOT_HEIGHT = 900;

function defaultEnvironment(platform: NodeJS.Platform): ComputerUseEnvironment {
  if (platform === "darwin") {
    return "mac";
  }
  if (platform === "win32") {
    return "windows";
  }
  return "linux";
}

function runCommand(
  command: string,
  args: readonly string[],
  options: CommandOptions = {},
): Promise<CommandResult> {
  const timeoutMs = options.timeoutMs ?? COMMAND_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? MAX_COMMAND_OUTPUT_BYTES;

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, [...args], {
      env: options.env ?? process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let settled = false;
    let totalBytes = 0;
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    const finish = (callback: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const fail = (message: string): void => {
      child.kill();
      finish(() => {
        rejectPromise(new Error(message));
      });
    };
    const onAbort = (): void => {
      fail(`${command} was interrupted.`);
    };
    const append = (chunk: Buffer, target: Buffer[]): void => {
      totalBytes += chunk.length;
      if (totalBytes > maxOutputBytes) {
        fail(`${command} exceeded the ${String(maxOutputBytes)} byte output limit.`);
        return;
      }
      target.push(chunk);
    };
    const timer = setTimeout(() => {
      fail(`${command} timed out after ${String(timeoutMs)}ms.`);
    }, timeoutMs);
    timer.unref();

    child.stdout.on("data", (chunk: Buffer) => {
      append(chunk, stdout);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      append(chunk, stderr);
    });
    child.on("error", (err: NodeJS.ErrnoException) => {
      finish(() => {
        rejectPromise(
          err.code === "ENOENT" ? new Error(`${command} is not installed or not on PATH.`) : err,
        );
      });
    });
    child.on("close", (code) => {
      finish(() => {
        resolvePromise({
          code: code ?? 1,
          stdout: Buffer.concat(stdout),
          stderr: Buffer.concat(stderr).toString("utf8").trim(),
        });
      });
    });

    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) {
      onAbort();
    }
  });
}

function requiredPoint(input: ComputerUseInput): Point {
  if (input.coordinate) {
    return { x: input.coordinate[0], y: input.coordinate[1] };
  }
  if (input.x !== undefined && input.y !== undefined) {
    return { x: input.x, y: input.y };
  }
  throw new Error(`action=${input.action} requires coordinate or x and y.`);
}

function keysFor(input: ComputerUseInput): string[] {
  if (input.keys?.length) {
    return input.keys;
  }
  if (input.text) {
    return input.text
      .split("+")
      .map((key) => key.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeAction(
  input: ComputerUseInput,
): NativeInput | "screenshot" | { region: number[] } | { action: "wait"; duration: number } {
  switch (input.action) {
    case "screenshot":
      return "screenshot";
    case "zoom": {
      if (
        !input.region ||
        input.region[2] <= input.region[0] ||
        input.region[3] <= input.region[1]
      ) {
        throw new Error("action=zoom requires region [x1, y1, x2, y2] with positive area.");
      }
      return { region: input.region };
    }
    case "wait":
      return { action: "wait", duration: input.duration ?? 1 };
    case "cursor_position":
      return { action: "cursor_position" };
    case "type":
      if (input.text === undefined) {
        throw new Error("action=type requires text.");
      }
      return { action: "type", text: input.text };
    case "key":
    case "keypress": {
      const keys = keysFor(input);
      if (keys.length === 0) {
        throw new Error(`action=${input.action} requires text or keys.`);
      }
      return { action: "key", keys };
    }
    case "hold_key": {
      const keys = keysFor(input);
      if (keys.length === 0 || input.duration === undefined) {
        throw new Error("action=hold_key requires text or keys and duration.");
      }
      return { action: "hold_key", keys, duration: input.duration };
    }
    case "mouse_move":
    case "move": {
      const point = requiredPoint(input);
      return { action: "mouse_move", ...point, keys: input.keys };
    }
    case "left_mouse_down":
    case "left_mouse_up":
      return { action: input.action, keys: input.keys };
    case "left_click_drag": {
      if (!input.start_coordinate) {
        throw new Error("action=left_click_drag requires start_coordinate.");
      }
      const end = requiredPoint(input);
      return {
        action: "left_click_drag",
        path: [{ x: input.start_coordinate[0], y: input.start_coordinate[1] }, end],
        keys: input.keys,
      };
    }
    case "drag": {
      if (!input.path) {
        throw new Error("action=drag requires a path with at least two points.");
      }
      return { action: "left_click_drag", path: input.path, keys: input.keys };
    }
    case "left_click":
    case "right_click":
    case "middle_click":
    case "double_click":
    case "triple_click":
    case "click": {
      const point = requiredPoint(input);
      const button =
        input.action === "right_click"
          ? "right"
          : input.action === "middle_click"
            ? "middle"
            : input.action === "click"
              ? input.button === "wheel"
                ? "middle"
                : (input.button ?? "left")
              : "left";
      const clicks = input.action === "double_click" ? 2 : input.action === "triple_click" ? 3 : 1;
      return {
        action: "mouse_click",
        button,
        clicks,
        ...point,
        keys: keysFor(input),
      };
    }
    case "scroll": {
      const point = input.coordinate
        ? { x: input.coordinate[0], y: input.coordinate[1] }
        : input.x !== undefined && input.y !== undefined
          ? { x: input.x, y: input.y }
          : {};
      if (input.scroll_x !== undefined || input.scroll_y !== undefined) {
        const toWheelClicks = (value: number): number =>
          value === 0 ? 0 : Math.sign(value) * Math.max(1, Math.round(Math.abs(value) / 100));
        return {
          action: "scroll",
          ...point,
          scrollX: toWheelClicks(input.scroll_x ?? 0),
          scrollY: toWheelClicks(input.scroll_y ?? 0),
          keys: keysFor(input),
        };
      }
      if (input.scroll_amount === undefined || !input.scroll_direction) {
        throw new Error(
          "action=scroll requires scroll_amount and scroll_direction, or scroll_x and scroll_y.",
        );
      }
      const amount = Math.max(1, Math.round(Math.abs(input.scroll_amount)));
      return {
        action: "scroll",
        ...point,
        scrollX:
          input.scroll_direction === "left"
            ? -amount
            : input.scroll_direction === "right"
              ? amount
              : 0,
        scrollY:
          input.scroll_direction === "up"
            ? -amount
            : input.scroll_direction === "down"
              ? amount
              : 0,
        keys: keysFor(input),
      };
    }
  }
}

const MACOS_SWIFT = String.raw`
import ApplicationServices
import AppKit
import Foundation

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data(message.utf8))
  exit(2)
}

guard let encoded = ProcessInfo.processInfo.environment["SWIFTY_COMPUTER_INPUT"],
      let data = Data(base64Encoded: encoded),
      let object = try? JSONSerialization.jsonObject(with: data),
      let input = object as? [String: Any],
      let action = input["action"] as? String else {
  fail("Invalid computer action payload.")
}

let keyCodes: [String: CGKeyCode] = [
  "A": 0, "S": 1, "D": 2, "F": 3, "H": 4, "G": 5, "Z": 6, "X": 7,
  "C": 8, "V": 9, "B": 11, "Q": 12, "W": 13, "E": 14, "R": 15,
  "Y": 16, "T": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22,
  "5": 23, "=": 24, "9": 25, "7": 26, "-": 27, "8": 28, "0": 29,
  "]": 30, "O": 31, "U": 32, "[": 33, "I": 34, "P": 35, "RETURN": 36,
  "ENTER": 36, "L": 37, "J": 38, "'": 39, "K": 40, ";": 41, "\\": 42,
  ",": 43, "/": 44, "N": 45, "M": 46, ".": 47, "TAB": 48, "SPACE": 49,
  "GRAVE": 50, "BACKTICK": 50, "BACKSPACE": 51, "DELETE": 51, "ESC": 53, "ESCAPE": 53,
  "CMD": 55, "COMMAND": 55, "META": 55, "SHIFT": 56, "CAPSLOCK": 57,
  "ALT": 58, "OPTION": 58, "CTRL": 59, "CONTROL": 59, "LEFT": 123,
  "RIGHT": 124, "DOWN": 125, "UP": 126, "HOME": 115, "END": 119,
  "PAGEUP": 116, "PAGEDOWN": 121, "F1": 122, "F2": 120, "F3": 99,
  "F4": 118, "F5": 96, "F6": 97, "F7": 98, "F8": 100, "F9": 101,
  "F10": 109, "F11": 103, "F12": 111
]

func number(_ name: String) -> CGFloat {
  guard let value = input[name] as? NSNumber else { fail("Missing " + name + ".") }
  return CGFloat(value.doubleValue)
}

func keys() -> [String] {
  return (input["keys"] as? [String] ?? []).map { $0.uppercased() }
}

func keyCode(_ name: String) -> CGKeyCode {
  guard let code = keyCodes[name.uppercased()] else { fail("Unsupported key: " + name) }
  return code
}

func keyEvent(_ name: String, _ down: Bool) {
  guard let event = CGEvent(keyboardEventSource: nil, virtualKey: keyCode(name), keyDown: down) else {
    fail("Unable to create keyboard event.")
  }
  event.post(tap: .cghidEventTap)
}

func withKeys(_ names: [String], _ body: () -> Void) {
  for name in names { keyEvent(name, true) }
  body()
  for name in names.reversed() { keyEvent(name, false) }
}

func mouseEvent(_ type: CGEventType, _ point: CGPoint, _ button: CGMouseButton, clicks: Int64 = 1) {
  guard let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: button) else {
    fail("Unable to create mouse event.")
  }
  event.setIntegerValueField(.mouseEventClickState, value: clicks)
  event.post(tap: .cghidEventTap)
}

if action == "screen_size" {
  let bounds = CGDisplayBounds(CGMainDisplayID())
  print("\(Int(bounds.width)),\(Int(bounds.height))")
  exit(0)
}

if action == "cursor_position" {
  guard let event = CGEvent(source: nil) else { fail("Unable to read cursor position.") }
  print("\(Int(event.location.x)),\(Int(event.location.y))")
  exit(0)
}

if !AXIsProcessTrusted() {
  fail("Accessibility permission is required. Enable it for the terminal running Swifty in System Settings > Privacy & Security > Accessibility.")
}

let point = CGPoint(
  x: (input["x"] as? NSNumber)?.doubleValue ?? 0,
  y: (input["y"] as? NSNumber)?.doubleValue ?? 0
)
let heldKeys = keys()

switch action {
case "mouse_move":
  withKeys(heldKeys) { mouseEvent(.mouseMoved, point, .left) }
case "left_mouse_down":
  mouseEvent(.leftMouseDown, CGEvent(source: nil)?.location ?? point, .left)
case "left_mouse_up":
  mouseEvent(.leftMouseUp, CGEvent(source: nil)?.location ?? point, .left)
case "mouse_click":
  let buttonName = input["button"] as? String ?? "left"
  let button: CGMouseButton = buttonName == "right" ? .right : buttonName == "middle" ? .center : .left
  let downType: CGEventType = button == .right ? .rightMouseDown : button == .center ? .otherMouseDown : .leftMouseDown
  let upType: CGEventType = button == .right ? .rightMouseUp : button == .center ? .otherMouseUp : .leftMouseUp
  let count = (input["clicks"] as? NSNumber)?.int64Value ?? 1
  withKeys(heldKeys) {
    mouseEvent(.mouseMoved, point, button)
    for click in 1...count {
      mouseEvent(downType, point, button, clicks: click)
      mouseEvent(upType, point, button, clicks: click)
      Thread.sleep(forTimeInterval: 0.08)
    }
  }
case "left_click_drag":
  guard let path = input["path"] as? [[String: NSNumber]], let first = path.first else {
    fail("Drag path is missing.")
  }
  let start = CGPoint(x: first["x"]?.doubleValue ?? 0, y: first["y"]?.doubleValue ?? 0)
  withKeys(heldKeys) {
    mouseEvent(.mouseMoved, start, .left)
    mouseEvent(.leftMouseDown, start, .left)
    for item in path.dropFirst() {
      let next = CGPoint(x: item["x"]?.doubleValue ?? 0, y: item["y"]?.doubleValue ?? 0)
      mouseEvent(.leftMouseDragged, next, .left)
      Thread.sleep(forTimeInterval: 0.02)
    }
    let end = path.last ?? first
    mouseEvent(.leftMouseUp, CGPoint(x: end["x"]?.doubleValue ?? 0, y: end["y"]?.doubleValue ?? 0), .left)
  }
case "scroll":
  if let x = input["x"] as? NSNumber, let y = input["y"] as? NSNumber {
    mouseEvent(.mouseMoved, CGPoint(x: x.doubleValue, y: y.doubleValue), .left)
  }
  let horizontal = Int32((input["scrollX"] as? NSNumber)?.intValue ?? 0)
  let vertical = Int32((input["scrollY"] as? NSNumber)?.intValue ?? 0)
  withKeys(heldKeys) {
    CGEvent(scrollWheelEvent2Source: nil, units: .line, wheelCount: 2, wheel1: -vertical, wheel2: -horizontal, wheel3: 0)?.post(tap: .cghidEventTap)
  }
case "key", "hold_key":
  let names = keys()
  if names.isEmpty { fail("No keys supplied.") }
  for name in names { keyEvent(name, true) }
  if action == "hold_key" {
    Thread.sleep(forTimeInterval: (input["duration"] as? NSNumber)?.doubleValue ?? 0)
  }
  for name in names.reversed() { keyEvent(name, false) }
case "type":
  let text = input["text"] as? String ?? ""
  let units = Array(text.utf16)
  units.withUnsafeBufferPointer { buffer in
    guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true),
          let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false) else {
      fail("Unable to create text input events.")
    }
    down.keyboardSetUnicodeString(stringLength: units.count, unicodeString: buffer.baseAddress)
    up.keyboardSetUnicodeString(stringLength: units.count, unicodeString: buffer.baseAddress)
    down.post(tap: .cghidEventTap)
    up.post(tap: .cghidEventTap)
  }
default:
  fail("Unsupported action: " + action)
}
`;

const WINDOWS_POWERSHELL = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public static class SwiftyComputer {
  [StructLayout(LayoutKind.Sequential)]
  private struct INPUT { public uint type; public InputUnion value; }
  [StructLayout(LayoutKind.Explicit)]
  private struct InputUnion { [FieldOffset(0)] public KEYBDINPUT keyboard; }
  [StructLayout(LayoutKind.Sequential)]
  private struct KEYBDINPUT {
    public ushort virtualKey;
    public ushort scanCode;
    public uint flags;
    public uint time;
    public UIntPtr extraInfo;
  }

  [DllImport("user32.dll")]
  private static extern void mouse_event(uint flags, uint dx, uint dy, int data, UIntPtr extraInfo);
  [DllImport("user32.dll", SetLastError = true)]
  private static extern uint SendInput(uint count, INPUT[] inputs, int size);

  private static void SendKeyboard(ushort virtualKey, ushort scanCode, uint flags) {
    var inputs = new[] {
      new INPUT {
        type = 1,
        value = new InputUnion {
          keyboard = new KEYBDINPUT {
            virtualKey = virtualKey,
            scanCode = scanCode,
            flags = flags,
            extraInfo = UIntPtr.Zero
          }
        }
      }
    };
    if (SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT))) != 1) {
      throw new InvalidOperationException("SendInput failed.");
    }
  }

  public static void Move(int x, int y) { Cursor.Position = new Point(x, y); }
  public static Point Position() { return Cursor.Position; }
  public static void Mouse(uint flags, int data = 0) { mouse_event(flags, 0, 0, data, UIntPtr.Zero); }
  public static void Key(int virtualKey, bool down) { SendKeyboard((ushort)virtualKey, 0, down ? 0u : 2u); }
  public static void Text(string text) {
    foreach (char value in text) {
      SendKeyboard(0, value, 4u);
      SendKeyboard(0, value, 6u);
    }
  }
}
'@

$payload = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:SWIFTY_COMPUTER_INPUT)) | ConvertFrom-Json
function Resolve-Key([string]$name) {
  switch ($name.ToUpperInvariant()) {
    'CTRL' { return 0x11 }
    'CONTROL' { return 0x11 }
    'SHIFT' { return 0x10 }
    'ALT' { return 0x12 }
    'OPTION' { return 0x12 }
    'CMD' { return 0x5B }
    'COMMAND' { return 0x5B }
    'META' { return 0x5B }
    'WIN' { return 0x5B }
    'WINDOWS' { return 0x5B }
    'ENTER' { return 0x0D }
    'RETURN' { return 0x0D }
    'ESC' { return 0x1B }
    'ESCAPE' { return 0x1B }
    'BACKSPACE' { return 0x08 }
    'DELETE' { return 0x2E }
    'TAB' { return 0x09 }
    'SPACE' { return 0x20 }
    'LEFT' { return 0x25 }
    'UP' { return 0x26 }
    'RIGHT' { return 0x27 }
    'DOWN' { return 0x28 }
    'HOME' { return 0x24 }
    'END' { return 0x23 }
    'PAGEUP' { return 0x21 }
    'PAGEDOWN' { return 0x22 }
    default {
      if ($name.Length -eq 1) { return [int][char]$name.ToUpperInvariant() }
      try { return [int]([System.Enum]::Parse([System.Windows.Forms.Keys], $name, $true)) }
      catch { throw "Unsupported key: $name" }
    }
  }
}
function Key-Down($keys) { foreach ($key in $keys) { [SwiftyComputer]::Key((Resolve-Key $key), $true) } }
function Key-Up($keys) { for ($i = $keys.Count - 1; $i -ge 0; $i--) { [SwiftyComputer]::Key((Resolve-Key $keys[$i]), $false) } }
function Move-To($value) {
  $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  [SwiftyComputer]::Move($bounds.X + [int]$value.x, $bounds.Y + [int]$value.y)
}

$keys = @($payload.keys)
switch ($payload.action) {
  'cursor_position' {
    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $point = [SwiftyComputer]::Position()
    Write-Output "$(($point.X - $bounds.X)),$(($point.Y - $bounds.Y))"
  }
  'mouse_move' { Key-Down $keys; Move-To $payload; Key-Up $keys }
  'left_mouse_down' { [SwiftyComputer]::Mouse(0x0002) }
  'left_mouse_up' { [SwiftyComputer]::Mouse(0x0004) }
  'mouse_click' {
    Move-To $payload
    Key-Down $keys
    $down = switch ($payload.button) { 'right' { 0x0008 } 'middle' { 0x0020 } default { 0x0002 } }
    $up = switch ($payload.button) { 'right' { 0x0010 } 'middle' { 0x0040 } default { 0x0004 } }
    for ($i = 0; $i -lt [int]$payload.clicks; $i++) {
      [SwiftyComputer]::Mouse($down); [SwiftyComputer]::Mouse($up); Start-Sleep -Milliseconds 80
    }
    Key-Up $keys
  }
  'left_click_drag' {
    Key-Down $keys
    Move-To $payload.path[0]
    [SwiftyComputer]::Mouse(0x0002)
    foreach ($point in $payload.path | Select-Object -Skip 1) { Move-To $point; Start-Sleep -Milliseconds 20 }
    [SwiftyComputer]::Mouse(0x0004)
    Key-Up $keys
  }
  'scroll' {
    if ($null -ne $payload.x -and $null -ne $payload.y) { Move-To $payload }
    Key-Down $keys
    [SwiftyComputer]::Mouse(0x0800, -([int]$payload.scrollY * 120))
    [SwiftyComputer]::Mouse(0x01000, [int]$payload.scrollX * 120)
    Key-Up $keys
  }
  'key' { Key-Down $keys; Key-Up $keys }
  'hold_key' { Key-Down $keys; Start-Sleep -Milliseconds ([int]([double]$payload.duration * 1000)); Key-Up $keys }
  'type' { [SwiftyComputer]::Text([string]$payload.text) }
  default { throw "Unsupported action: $($payload.action)" }
}
`;

function commandError(command: string, result: CommandResult): Error {
  return new Error(
    `${command} failed: ${result.stderr || result.stdout.toString("utf8").trim() || `exit ${String(result.code)}`}`,
  );
}

export class ComputerUseTool implements Tool {
  name = "ComputerUse";
  description: string;
  category: ToolCategory = "command";

  private readonly environment: ComputerUseEnvironment;
  private readonly platform: NodeJS.Platform;
  private readonly run: CommandRunner;
  private coordinateScaleX = 1;
  private coordinateScaleY = 1;
  private macHelperPromise?: Promise<string>;

  constructor(options: ComputerUseToolOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.environment = options.environment ?? defaultEnvironment(this.platform);
    this.run = options.runCommand ?? runCommand;
    this.description =
      `Control the current ${this.environment} computer with screenshots, mouse, keyboard, scrolling, waiting, and zoom. ` +
      "Use screenshot before choosing coordinates and verify consequential actions with another screenshot. " +
      "Anthropic-style actions are supported directly; OpenAI action aliases click, drag, keypress, and move are also accepted.";
  }

  isConcurrencySafe(): boolean {
    return false;
  }

  schema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      input_schema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ACTIONS,
            description: "The computer action to perform.",
          },
          coordinate: {
            type: "array",
            items: { type: "integer", minimum: 0 },
            minItems: 2,
            maxItems: 2,
            description: "Anthropic-style [x, y] coordinate in the latest screenshot space.",
          },
          duration: {
            type: "number",
            minimum: 0,
            maximum: 60,
            description: "Seconds for hold_key or wait.",
          },
          region: {
            type: "array",
            items: { type: "integer", minimum: 0 },
            minItems: 4,
            maxItems: 4,
            description: "Zoom region [x1, y1, x2, y2] in the latest screenshot space.",
          },
          scroll_amount: {
            type: "number",
            description: "Anthropic-style number of wheel clicks to scroll.",
          },
          scroll_direction: {
            type: "string",
            enum: ["up", "down", "left", "right"],
          },
          start_coordinate: {
            type: "array",
            items: { type: "integer", minimum: 0 },
            minItems: 2,
            maxItems: 2,
            description: "Anthropic-style drag start coordinate.",
          },
          text: {
            type: "string",
            description: "Text to type, or a '+'-separated key combination.",
          },
          x: {
            type: "integer",
            minimum: 0,
            description: "OpenAI-style x coordinate.",
          },
          y: {
            type: "integer",
            minimum: 0,
            description: "OpenAI-style y coordinate.",
          },
          button: {
            type: "string",
            enum: ["left", "right", "wheel", "middle", "back", "forward"],
            description: "Button for action=click.",
          },
          keys: {
            type: "array",
            items: { type: "string" },
            maxItems: 8,
            description: "OpenAI-style keys held during an action or pressed by keypress.",
          },
          path: {
            type: "array",
            items: {
              type: "object",
              properties: {
                x: { type: "integer", minimum: 0 },
                y: { type: "integer", minimum: 0 },
              },
              required: ["x", "y"],
              additionalProperties: false,
            },
            minItems: 2,
            maxItems: 200,
            description: "OpenAI-style drag path.",
          },
          scroll_x: {
            type: "number",
            description: "OpenAI-style horizontal scroll delta.",
          },
          scroll_y: {
            type: "number",
            description: "OpenAI-style vertical scroll delta.",
          },
        },
        required: ["action"],
        additionalProperties: false,
      },
    };
  }

  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const parsed = safeParse(ComputerUseInputSchema, args);
    if (!parsed.success) {
      return {
        output: `Error: ${z.prettifyError(parsed.error)}`,
        isError: true,
      };
    }

    try {
      ctx.abortSignal?.throwIfAborted();
      const action = normalizeAction(parsed.data);
      if (action === "screenshot") {
        return await this.screenshot(ctx.abortSignal);
      }
      if ("region" in action) {
        return await this.screenshot(ctx.abortSignal, action.region);
      }
      if (action.action === "wait") {
        await delay((action.duration ?? 1) * 1000, undefined, {
          signal: ctx.abortSignal,
        });
        return { output: "Wait completed.", isError: false };
      }

      const native = this.toNativeCoordinates(action);
      let output = await this.executeNative(native, ctx.abortSignal);
      if (native.action === "cursor_position" && output) {
        const [x, y] = output.split(",").map(Number);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          output = `${String(Math.round(x / this.coordinateScaleX))},${String(Math.round(y / this.coordinateScaleY))}`;
        }
      }
      return {
        output: output || `Computer action ${parsed.data.action} completed.`,
        isError: false,
      };
    } catch (err) {
      return { output: `Error: ${asErrorString(err)}`, isError: true };
    }
  }

  private toNativeCoordinates(action: NativeInput): NativeInput {
    const scalePoint = (point: Point): Point => ({
      x: Math.round(point.x * this.coordinateScaleX),
      y: Math.round(point.y * this.coordinateScaleY),
    });
    return {
      ...action,
      ...(action.x !== undefined && action.y !== undefined
        ? scalePoint({ x: action.x, y: action.y })
        : {}),
      ...(action.path ? { path: action.path.map(scalePoint) } : {}),
    };
  }

  private async executeNative(action: NativeInput, signal?: AbortSignal): Promise<string> {
    switch (this.platform) {
      case "darwin":
        return this.executeMac(action, signal);
      case "win32":
        return this.executeWindows(action, signal);
      case "linux":
        return this.executeLinux(action, signal);
      default:
        throw new Error(`ComputerUse is not supported on ${this.platform}.`);
    }
  }

  private async executeMac(action: NativeInput, signal?: AbortSignal): Promise<string> {
    return this.runMacPayload(
      action,
      signal,
      action.action === "hold_key"
        ? Math.max(COMMAND_TIMEOUT_MS, (action.duration ?? 0) * 1000 + 5_000)
        : COMMAND_TIMEOUT_MS,
    );
  }

  private async runMacPayload(
    payload: object,
    signal?: AbortSignal,
    timeoutMs = COMMAND_TIMEOUT_MS,
  ): Promise<string> {
    const helper = await this.getMacHelper(signal);
    const result = await this.run(helper, [], {
      env: {
        ...process.env,
        SWIFTY_COMPUTER_INPUT: Buffer.from(JSON.stringify(payload)).toString("base64"),
      },
      signal,
      timeoutMs,
    });
    if (result.code !== 0) {
      throw commandError("macOS computer helper", result);
    }
    return result.stdout.toString("utf8").trim();
  }

  private async getMacHelper(signal?: AbortSignal): Promise<string> {
    this.macHelperPromise ??= this.compileMacHelper(signal);
    try {
      return await this.macHelperPromise;
    } catch (err) {
      this.macHelperPromise = undefined;
      throw err;
    }
  }

  private async compileMacHelper(signal?: AbortSignal): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), "swifty-computer-helper-"));
    const sourcePath = join(directory, "main.swift");
    const executablePath = join(directory, "computer-helper");
    try {
      await writeFile(sourcePath, MACOS_SWIFT, "utf8");
      const result = await this.run(
        "/usr/bin/xcrun",
        ["swiftc", "-O", sourcePath, "-o", executablePath],
        { signal, timeoutMs: 120_000 },
      );
      if (result.code !== 0) {
        throw commandError("swiftc", result);
      }
      return executablePath;
    } catch (err) {
      await rm(directory, { recursive: true, force: true });
      throw err;
    }
  }

  private async executeWindows(action: NativeInput, signal?: AbortSignal): Promise<string> {
    const result = await this.run(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Sta", "-Command", WINDOWS_POWERSHELL],
      {
        env: {
          ...process.env,
          SWIFTY_COMPUTER_INPUT: Buffer.from(JSON.stringify(action)).toString("base64"),
        },
        signal,
        timeoutMs:
          action.action === "hold_key"
            ? Math.max(COMMAND_TIMEOUT_MS, (action.duration ?? 0) * 1000 + 5_000)
            : COMMAND_TIMEOUT_MS,
      },
    );
    if (result.code !== 0) {
      throw commandError("powershell.exe", result);
    }
    return result.stdout.toString("utf8").trim();
  }

  private async executeLinux(action: NativeInput, signal?: AbortSignal): Promise<string> {
    const runXdotool = async (args: readonly string[]): Promise<string> => {
      const result = await this.run("xdotool", args, { signal });
      if (result.code !== 0) {
        throw commandError("xdotool", result);
      }
      return result.stdout.toString("utf8").trim();
    };
    const keys = action.keys ?? [];
    const keyDown = async (): Promise<void> => {
      for (const key of keys) {
        await runXdotool(["keydown", key]);
      }
    };
    const keyUp = async (): Promise<void> => {
      for (const key of [...keys].reverse()) {
        await runXdotool(["keyup", key]);
      }
    };
    const withKeys = async (operation: () => Promise<void>): Promise<void> => {
      await keyDown();
      try {
        await operation();
      } finally {
        await keyUp();
      }
    };
    const move = async (): Promise<void> => {
      if (action.x !== undefined && action.y !== undefined) {
        await runXdotool(["mousemove", "--sync", String(action.x), String(action.y)]);
      }
    };

    switch (action.action) {
      case "cursor_position": {
        const output = await runXdotool(["getmouselocation", "--shell"]);
        const x = /(?:^|\n)X=(\d+)/.exec(output)?.[1];
        const y = /(?:^|\n)Y=(\d+)/.exec(output)?.[1];
        if (!x || !y) {
          throw new Error(`Unable to parse cursor position: ${output}`);
        }
        return `${x},${y}`;
      }
      case "mouse_move":
        await withKeys(move);
        return "";
      case "left_mouse_down":
        await runXdotool(["mousedown", "1"]);
        return "";
      case "left_mouse_up":
        await runXdotool(["mouseup", "1"]);
        return "";
      case "mouse_click": {
        await move();
        const button =
          action.button === "right"
            ? 3
            : action.button === "middle"
              ? 2
              : action.button === "back"
                ? 8
                : action.button === "forward"
                  ? 9
                  : 1;
        await withKeys(async () => {
          await runXdotool([
            "click",
            "--repeat",
            String(action.clicks ?? 1),
            "--delay",
            "80",
            String(button),
          ]);
        });
        return "";
      }
      case "left_click_drag": {
        const path = action.path ?? [];
        if (path.length < 2) {
          throw new Error("Drag path must contain at least two points.");
        }
        await withKeys(async () => {
          await runXdotool(["mousemove", "--sync", String(path[0].x), String(path[0].y)]);
          await runXdotool(["mousedown", "1"]);
          try {
            for (const point of path.slice(1)) {
              await runXdotool(["mousemove", "--sync", String(point.x), String(point.y)]);
            }
          } finally {
            await runXdotool(["mouseup", "1"]);
          }
        });
        return "";
      }
      case "scroll": {
        await move();
        await withKeys(async () => {
          const clicks: [number, number][] = [
            [action.scrollY ?? 0, (action.scrollY ?? 0) < 0 ? 4 : 5],
            [action.scrollX ?? 0, (action.scrollX ?? 0) < 0 ? 6 : 7],
          ];
          for (const [amount, button] of clicks) {
            if (amount !== 0) {
              await runXdotool(["click", "--repeat", String(Math.abs(amount)), String(button)]);
            }
          }
        });
        return "";
      }
      case "key":
        await runXdotool(["key", keys.join("+")]);
        return "";
      case "hold_key":
        await keyDown();
        try {
          await delay((action.duration ?? 0) * 1000, undefined, { signal });
        } finally {
          await keyUp();
        }
        return "";
      case "type":
        await runXdotool(["type", "--delay", "1", "--", action.text ?? ""]);
        return "";
    }
  }

  private async screenshot(signal?: AbortSignal, region?: number[]): Promise<ToolResult> {
    const capture = await this.captureScreenshot(signal);
    const metadata = await sharp(capture.bytes).metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error("Unable to determine screenshot dimensions.");
    }

    if (region) {
      const left = Math.round(region[0] * this.coordinateScaleX);
      const top = Math.round(region[1] * this.coordinateScaleY);
      const right = Math.round(region[2] * this.coordinateScaleX);
      const bottom = Math.round(region[3] * this.coordinateScaleY);
      const rawScaleX = metadata.width / capture.width;
      const rawScaleY = metadata.height / capture.height;
      const rawLeft = Math.max(0, Math.min(metadata.width - 1, Math.round(left * rawScaleX)));
      const rawTop = Math.max(0, Math.min(metadata.height - 1, Math.round(top * rawScaleY)));
      const rawRight = Math.max(
        rawLeft + 1,
        Math.min(metadata.width, Math.round(right * rawScaleX)),
      );
      const rawBottom = Math.max(
        rawTop + 1,
        Math.min(metadata.height, Math.round(bottom * rawScaleY)),
      );
      const cropped = await sharp(capture.bytes)
        .extract({
          left: rawLeft,
          top: rawTop,
          width: rawRight - rawLeft,
          height: rawBottom - rawTop,
        })
        .png({ compressionLevel: 8 })
        .toBuffer();
      return this.imageResult(cropped, `Zoomed screenshot of [${region.join(", ")}].`);
    }

    const targetScale = Math.min(
      1,
      MAX_SCREENSHOT_WIDTH / capture.width,
      MAX_SCREENSHOT_HEIGHT / capture.height,
    );
    const targetWidth = Math.max(1, Math.round(capture.width * targetScale));
    const targetHeight = Math.max(1, Math.round(capture.height * targetScale));
    const normalized = await sharp(capture.bytes)
      .resize(targetWidth, targetHeight, { fit: "fill" })
      .png({ compressionLevel: 8 })
      .toBuffer();
    const result = await this.imageResult(
      normalized,
      `Screenshot ${String(targetWidth)}x${String(targetHeight)}. Use this coordinate space for subsequent actions.`,
    );
    const outputBlock = result.contentBlocks?.[0];
    if (outputBlock?.type === "image" && outputBlock.source.type === "base64") {
      const finalMetadata = await sharp(Buffer.from(outputBlock.source.data, "base64")).metadata();
      if (finalMetadata.width && finalMetadata.height) {
        this.coordinateScaleX = capture.width / finalMetadata.width;
        this.coordinateScaleY = capture.height / finalMetadata.height;
        result.output = `Screenshot ${String(finalMetadata.width)}x${String(finalMetadata.height)}. Use this coordinate space for subsequent actions.`;
      }
    }
    return result;
  }

  private async imageResult(bytes: Buffer, output: string): Promise<ToolResult> {
    const image = await maybeResizeAndDownsampleImage(bytes, "image/png");
    const imageBlock = {
      type: "image",
      source: {
        type: "base64",
        media_type: image.mediaType,
        data: image.data,
      },
    } satisfies ToolResultContentBlock;
    return { output, contentBlocks: [imageBlock], isError: false };
  }

  private async captureScreenshot(
    signal?: AbortSignal,
  ): Promise<{ bytes: Buffer; width: number; height: number }> {
    const directory = await mkdtemp(join(tmpdir(), "swifty-computer-"));
    const screenshotPath = join(directory, "screenshot.png");
    try {
      switch (this.platform) {
        case "darwin": {
          const capture = await this.run(
            "/usr/sbin/screencapture",
            ["-x", "-m", "-t", "png", screenshotPath],
            { signal },
          );
          if (capture.code !== 0) {
            throw commandError("screencapture", capture);
          }
          const size = await this.runMacPayload({ action: "screen_size" }, signal).catch(() => "");
          const [width, height] = size.split(",").map(Number);
          const bytes = await readFile(screenshotPath);
          const metadata = await sharp(bytes).metadata();
          return {
            bytes,
            width: Number.isFinite(width) && width > 0 ? width : (metadata.width ?? 1),
            height: Number.isFinite(height) && height > 0 ? height : (metadata.height ?? 1),
          };
        }
        case "win32": {
          const script = [
            "$ErrorActionPreference = 'Stop'",
            "Add-Type -AssemblyName System.Drawing",
            "Add-Type -AssemblyName System.Windows.Forms",
            "$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds",
            "$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height",
            "$graphics = [System.Drawing.Graphics]::FromImage($bitmap)",
            "$graphics.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $bounds.Size)",
            "$bitmap.Save($env:SWIFTY_SCREENSHOT_PATH, [System.Drawing.Imaging.ImageFormat]::Png)",
            "$graphics.Dispose()",
            "$bitmap.Dispose()",
            'Write-Output "$($bounds.Width),$($bounds.Height)"',
          ].join("; ");
          const capture = await this.run(
            "powershell.exe",
            ["-NoProfile", "-NonInteractive", "-Sta", "-Command", script],
            {
              env: { ...process.env, SWIFTY_SCREENSHOT_PATH: screenshotPath },
              signal,
            },
          );
          if (capture.code !== 0) {
            throw commandError("powershell.exe", capture);
          }
          const [width, height] = capture.stdout.toString("utf8").trim().split(",").map(Number);
          return { bytes: await readFile(screenshotPath), width, height };
        }
        case "linux": {
          const backends: [string, string[]][] = [
            ["gnome-screenshot", ["-f", screenshotPath]],
            ["scrot", [screenshotPath]],
            ["import", ["-window", "root", screenshotPath]],
          ];
          let lastError = "No screenshot backend succeeded.";
          for (const [command, args] of backends) {
            try {
              const capture = await this.run(command, args, { signal });
              if (capture.code === 0) {
                const bytes = await readFile(screenshotPath);
                const metadata = await sharp(bytes).metadata();
                return {
                  bytes,
                  width: metadata.width ?? 1,
                  height: metadata.height ?? 1,
                };
              }
              lastError = commandError(command, capture).message;
            } catch (err) {
              lastError = asErrorString(err);
            }
          }
          throw new Error(
            `${lastError} Install gnome-screenshot, scrot, or ImageMagick; xdotool is required for input control.`,
          );
        }
        default:
          throw new Error(`ComputerUse is not supported on ${this.platform}.`);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
