/**
 * Copyright (c) 2026 hangtiancheng
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { Box, Text, useInput, usePaste, useWindowSize } from "ink";
import { useRef, useState } from "react";
import type { ReactNode } from "react";

import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_THINKING_LEVEL,
  type ProviderConfig,
  type ThinkingLevel,
  THINKING_LEVELS,
} from "../config/config.js";
import { ProviderLoginSchema } from "../config/provider-login.js";

import { SelectorFrame } from "./selector-frame.js";
import { THEME } from "./styles.js";
import { truncateToWidth } from "./terminal-text.js";

const PROTOCOLS = ["anthropic", "openai", "openai-compat"] as const;
const FIELD_KEYS = [
  "name",
  "protocol",
  "base_url",
  "api_key",
  "model",
  "thinking",
  "context_window",
  "max_output_tokens",
] as const;

type FieldKey = (typeof FIELD_KEYS)[number];

interface FormState {
  name: string;
  protocol: ProviderConfig["protocol"];
  base_url: string;
  api_key: string;
  model: string;
  thinking: ThinkingLevel;
  context_window: string;
  max_output_tokens: string;
}

interface FieldErrors {
  [key: string]: string | undefined;
}

export interface ProviderLoginProps {
  initialValues?: Partial<ProviderConfig>;
  onSubmit: (provider: ProviderConfig) => Promise<void> | void;
  onCancel: () => void;
}

const FIELD_LABELS: Record<FieldKey, string> = {
  name: "Name",
  protocol: "Protocol",
  base_url: "Base URL",
  api_key: "API key",
  model: "Model",
  thinking: "Thinking",
  context_window: "Context window",
  max_output_tokens: "Max output tokens",
};

function normalizeThinkingLevel(value: ProviderConfig["thinking"]): ThinkingLevel {
  return value ?? DEFAULT_THINKING_LEVEL;
}

function createInitialForm(initialValues?: Partial<ProviderConfig>): FormState {
  return {
    name: initialValues?.name ?? "",
    protocol: initialValues?.protocol ?? "anthropic",
    base_url: initialValues?.base_url ?? "",
    api_key: initialValues?.api_key ?? "",
    model: initialValues?.model ?? "",
    thinking: normalizeThinkingLevel(initialValues?.thinking),
    context_window: String(initialValues?.context_window ?? DEFAULT_CONTEXT_WINDOW),
    max_output_tokens: String(initialValues?.max_output_tokens ?? DEFAULT_MAX_OUTPUT_TOKENS),
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error) {
    return error;
  }
  return "Unable to save provider";
}

function validateForm(form: FormState): {
  provider?: ProviderConfig;
  errors: FieldErrors;
  formError?: string;
} {
  const errors: FieldErrors = {};
  const parsed = ProviderLoginSchema.safeParse(form);

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path[0];
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      if (typeof path === "string" && FIELD_KEYS.includes(path as FieldKey) && !errors[path]) {
        errors[path] = issue.message;
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }
  if (!parsed.success) {
    return {
      errors,
      formError: parsed.error.issues.map((issue) => issue.message).join("; "),
    };
  }
  return { provider: parsed.data, errors };
}

function displayValue(form: FormState, field: FieldKey): string {
  if (field === "protocol") {
    return form.protocol;
  }
  if (field === "thinking") {
    return form.thinking;
  }
  if (field === "api_key") {
    return form.api_key ? "•".repeat(form.api_key.length) : "";
  }
  return form[field];
}

function cursorValue(value: string, cursor: number, maxWidth: number): ReactNode {
  const position = Math.min(cursor, value.length);
  if (value.length + 1 <= maxWidth) {
    return (
      <>
        {value.slice(0, position)}
        <Text inverse>{value[position] ?? " "}</Text>
        {value.slice(position + 1)}
      </>
    );
  }

  const contentWidth = Math.max(1, maxWidth - 1);
  const start = Math.max(
    0,
    Math.min(position - Math.floor(contentWidth / 2), value.length - contentWidth),
  );
  const end = Math.min(value.length, start + contentWidth);
  const before = value.slice(start, position);
  const current = value[position] ?? " ";
  const after = value.slice(position + 1, end);
  return (
    <>
      {start > 0 ? "…" : null}
      {before}
      <Text inverse>{current}</Text>
      {after}
      {end < value.length ? "…" : null}
    </>
  );
}

export function ProviderLogin({ initialValues, onSubmit, onCancel }: ProviderLoginProps) {
  const { columns } = useWindowSize();
  const [form, setForm] = useState<FormState>(() => createInitialForm(initialValues));
  const [field, setField] = useState<FieldKey>("name");
  const [cursor, setCursor] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef(form);
  const fieldRef = useRef<FieldKey>(field);
  const cursorRef = useRef(cursor);
  const submittingRef = useRef(false);

  formRef.current = form;
  fieldRef.current = field;
  cursorRef.current = cursor;

  const updateText = (value: string, nextCursor = value.length) => {
    const activeField = fieldRef.current;
    if (activeField === "protocol" || activeField === "thinking") {
      return;
    }
    setForm((current) => ({ ...current, [activeField]: value }));
    formRef.current = { ...formRef.current, [activeField]: value };
    setCursor(nextCursor);
    cursorRef.current = nextCursor;
    setFieldErrors((current) => ({ ...current, [activeField]: undefined }));
    setFormError("");
  };

  const insertText = (text: string) => {
    if (!text || submittingRef.current) {
      return;
    }
    const activeField = fieldRef.current;
    if (activeField === "protocol" || activeField === "thinking") {
      return;
    }
    const value = formRef.current[activeField];
    const position = Math.min(cursorRef.current, value.length);
    const inserted = text.replace(/\r\n?/g, "\n").replace(/\n/g, "");
    updateText(
      value.slice(0, position) + inserted + value.slice(position),
      position + inserted.length,
    );
  };

  const submit = async () => {
    if (submittingRef.current) {
      return;
    }
    const result = validateForm(formRef.current);
    setFieldErrors(result.errors);
    setFormError(result.formError ?? "");
    if (!result.provider) {
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    try {
      await onSubmit(result.provider);
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const moveField = (delta: number) => {
    const index = FIELD_KEYS.indexOf(fieldRef.current);
    const next = (index + delta + FIELD_KEYS.length) % FIELD_KEYS.length;
    const nextField = FIELD_KEYS[next] ?? FIELD_KEYS[0];
    setField(nextField);
    fieldRef.current = nextField;
    const nextCursor =
      nextField === "protocol" || nextField === "thinking" ? 0 : formRef.current[nextField].length;
    setCursor(nextCursor);
    cursorRef.current = nextCursor;
  };

  usePaste(
    (text) => {
      insertText(text);
    },
    { isActive: !submitting },
  );

  useInput((input, key) => {
    if (submittingRef.current) {
      return;
    }
    if (key.escape || input === "\x1b") {
      onCancel();
      return;
    }
    if (key.tab) {
      moveField(key.shift ? -1 : 1);
      return;
    }
    if (key.upArrow) {
      moveField(-1);
      return;
    }
    if (key.downArrow) {
      moveField(1);
      return;
    }
    if (key.return || input === "\r" || input === "\n") {
      void submit();
      return;
    }

    const activeField = fieldRef.current;
    if (activeField === "protocol") {
      if (key.leftArrow || key.rightArrow) {
        const index = PROTOCOLS.indexOf(formRef.current.protocol);
        const next = (index + (key.rightArrow ? 1 : -1) + PROTOCOLS.length) % PROTOCOLS.length;
        const protocol = PROTOCOLS[next] ?? PROTOCOLS[0];
        const nextForm = { ...formRef.current, protocol };
        formRef.current = nextForm;
        setForm(nextForm);
        setFieldErrors((current) => ({ ...current, protocol: undefined }));
        setFormError("");
      }
      return;
    }
    if (activeField === "thinking") {
      if (key.leftArrow || key.rightArrow) {
        const index = THINKING_LEVELS.indexOf(formRef.current.thinking);
        const next =
          (index + (key.rightArrow ? 1 : -1) + THINKING_LEVELS.length) % THINKING_LEVELS.length;
        const thinking = THINKING_LEVELS[next] ?? DEFAULT_THINKING_LEVEL;
        const nextForm = { ...formRef.current, thinking };
        formRef.current = nextForm;
        setForm(nextForm);
        setFieldErrors((current) => ({ ...current, thinking: undefined }));
        setFormError("");
      }
      return;
    }

    const value = formRef.current[activeField];
    const position = Math.min(cursorRef.current, value.length);
    if (key.ctrl && input === "u") {
      updateText("", 0);
    } else if (key.leftArrow) {
      const next = Math.max(0, position - 1);
      setCursor(next);
      cursorRef.current = next;
    } else if (key.rightArrow) {
      const next = Math.min(value.length, position + 1);
      setCursor(next);
      cursorRef.current = next;
    } else if (key.home) {
      setCursor(0);
      cursorRef.current = 0;
    } else if (key.end) {
      setCursor(value.length);
      cursorRef.current = value.length;
    } else if (key.backspace || key.delete) {
      if (key.backspace && position > 0) {
        updateText(value.slice(0, position - 1) + value.slice(position), position - 1);
      } else if (key.delete && position < value.length) {
        updateText(value.slice(0, position) + value.slice(position + 1), position);
      }
    } else if (input && !key.ctrl && !key.meta) {
      insertText(input);
    }
  });

  const frameWidth = Math.max(1, columns || 80);
  const framePadding = frameWidth > 2 ? 2 : 0;
  const contentWidth = Math.max(1, frameWidth - framePadding);
  const labelWidth = Math.max(1, Math.min(24, Math.floor(contentWidth * 0.36)));
  const valueWidth = Math.max(1, contentWidth - labelWidth - (contentWidth > labelWidth ? 1 : 0));

  return (
    <SelectorFrame
      hint="↑↓/Tab field · ←→ choose · Enter submit · Esc cancel"
      subtitle={submitting ? "Saving provider…" : formError || "Add a provider connection"}
      title="Provider login"
      width={frameWidth}
    >
      <Box flexDirection="column" width="100%">
        {FIELD_KEYS.map((key) => {
          const selected = key === field;
          const rawValue = displayValue(form, key);
          const value =
            key === "protocol" && selected
              ? `‹ ${rawValue} ›`
              : key === "thinking" && selected
                ? `‹ ${rawValue} ›`
                : selected && key !== "protocol" && key !== "thinking"
                  ? cursorValue(rawValue, cursor, valueWidth)
                  : truncateToWidth(rawValue || "(empty)", valueWidth);
          return (
            <Box key={key} flexDirection="column" width="100%">
              <Box
                backgroundColor={selected ? THEME.selectedBg : undefined}
                paddingRight={contentWidth > labelWidth ? 1 : 0}
                width="100%"
              >
                <Box flexShrink={0} width={labelWidth}>
                  <Text color={selected ? THEME.accent : THEME.muted} wrap="truncate-end">
                    {truncateToWidth(`${selected ? "›" : " "} ${FIELD_LABELS[key]}:`, labelWidth)}
                  </Text>
                </Box>
                <Text color={selected ? THEME.text : THEME.muted} wrap="truncate-end">
                  {value}
                </Text>
              </Box>
              {fieldErrors[key] ? (
                <Text color={THEME.error} wrap="truncate-end">
                  {truncateToWidth(`  ${fieldErrors[key]}`, contentWidth)}
                </Text>
              ) : null}
            </Box>
          );
        })}
      </Box>
    </SelectorFrame>
  );
}
