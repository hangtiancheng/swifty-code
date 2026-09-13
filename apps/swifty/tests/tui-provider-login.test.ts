import { stripVTControlCharacters } from "node:util";

import { render, renderToString, useInput, usePaste } from "ink";
import type { Instance, Key } from "ink";
import type * as Ink from "ink";
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProviderConfig } from "@/config/config.js";
import { ProviderLogin } from "@/tui/provider-login.js";

vi.mock("ink", async (importOriginal) => ({
  ...(await importOriginal<typeof Ink>()),
  useInput: vi.fn(),
  usePaste: vi.fn(),
}));

const noKey: Key = {
  upArrow: false,
  downArrow: false,
  leftArrow: false,
  rightArrow: false,
  pageDown: false,
  pageUp: false,
  home: false,
  end: false,
  return: false,
  escape: false,
  ctrl: false,
  shift: false,
  tab: false,
  backspace: false,
  delete: false,
  meta: false,
  super: false,
  hyper: false,
  capsLock: false,
  numLock: false,
};

const validProvider: ProviderConfig = {
  name: "Anthropic",
  protocol: "anthropic",
  base_url: "https://api.anthropic.com/v1/messages",
  api_key: "sk-secret-value",
  model: "claude-sonnet-4-6",
  thinking: "high",
  context_window: 1_000_000,
  max_output_tokens: 128_000,
};

let instance: Instance | undefined;
let outputChunks: string[] = [];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  outputChunks = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    outputChunks.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  act(() => {
    instance?.unmount();
    instance?.cleanup();
  });
  instance = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount(
  initialValues: Partial<ProviderConfig> = validProvider,
  onSubmit = vi.fn(),
  onCancel = vi.fn(),
) {
  act(() => {
    instance = render(createElement(ProviderLogin, { initialValues, onSubmit, onCancel }), {
      patchConsole: false,
      interactive: false,
      debug: true,
    });
  });
  return { onSubmit, onCancel };
}

function send(input = "", key: Partial<Key> = {}): void {
  const handler = vi.mocked(useInput).mock.calls.at(-1)?.[0];
  if (typeof handler !== "function") {
    throw new Error("ProviderLogin input handler is not mounted");
  }
  act(() => {
    handler(input, { ...noKey, ...key });
  });
}

function paste(text: string): void {
  const handler = vi.mocked(usePaste).mock.calls.at(-1)?.[0];
  if (typeof handler !== "function") {
    throw new Error("ProviderLogin paste handler is not mounted");
  }
  act(() => {
    handler(text);
  });
}

function terminalOutput(): string {
  return stripVTControlCharacters(outputChunks.join(""));
}

describe("ProviderLogin", () => {
  it("renders defaults and masks the API key on a narrow terminal", () => {
    const rendered = stripVTControlCharacters(
      renderToString(
        createElement(ProviderLogin, {
          initialValues: validProvider,
          onSubmit: vi.fn(),
          onCancel: vi.fn(),
        }),
        { columns: 48 },
      ),
    );

    expect(rendered).toContain("Provider login");
    expect(rendered).toContain("1000000");
    expect(rendered).toContain("128000");
    expect(rendered).toContain("high");
    expect(rendered).not.toContain("sk-secret-value");
  });

  it("preserves pasted text, supports Ctrl+U, and submits ProviderConfig", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    mount({ ...validProvider, name: "existing" }, onSubmit);

    send("u", { ctrl: true });
    paste("provider name with spaces");
    send("", { return: true });
    await act(async () => {
      await Promise.resolve();
    });

    expect(onSubmit).toHaveBeenCalledWith({
      ...validProvider,
      name: "provider name with spaces",
    });
  });

  it("navigates with Tab and follows the protocol default for thinking", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    mount(validProvider, onSubmit);

    send("", { tab: true });
    send("", { rightArrow: true });
    send("", { tab: true });
    send("", { tab: true });
    send("", { tab: true });
    send("", { tab: true });
    send("", { rightArrow: true });
    send("", { return: true });
    await act(async () => {
      await Promise.resolve();
    });

    // Switching anthropic -> openai moves the untouched default from high to
    // off; the right arrow then advances off -> minimal.
    expect(onSubmit).toHaveBeenCalledWith({
      ...validProvider,
      protocol: "openai",
      thinking: "minimal",
    });
  });

  it("keeps an explicit thinking level when the protocol changes", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    mount({ ...validProvider, thinking: "medium" }, onSubmit);

    send("", { tab: true });
    send("", { rightArrow: true });
    send("", { return: true });
    await act(async () => {
      await Promise.resolve();
    });

    expect(onSubmit).toHaveBeenCalledWith({
      ...validProvider,
      thinking: "medium",
      protocol: "openai",
    });
  });

  it("maps schema issues to fields and rejects invalid ranges", () => {
    const { onSubmit } = mount({ ...validProvider, name: "", context_window: 999 });

    send("", { return: true });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(terminalOutput()).toContain("Name is required");
    expect(terminalOutput()).toContain("1000");
  });

  it("shows a rejected onSubmit error and cancels with Escape", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("invalid credentials"));
    const onCancel = vi.fn();
    mount(validProvider, onSubmit, onCancel);

    send("", { return: true });
    await act(async () => {
      await Promise.resolve();
    });
    expect(terminalOutput()).toContain("invalid credentials");

    send("\x1b", { escape: true });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
