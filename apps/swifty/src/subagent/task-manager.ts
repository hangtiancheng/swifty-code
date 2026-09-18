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

import { asErrorString } from "@/utils/index.js";

export type AgentTaskStatus = "running" | "completed" | "failed" | "cancelled";

export interface AgentTask {
  id: string;
  name: string;
  originToolCallId?: string;
  status: AgentTaskStatus;
  output: string;
  cancel: () => void;
  done: Promise<void>;
}

interface CreateTaskOptions {
  originToolCallId?: string;
}

export class TaskManager {
  private tasks = new Map<string, AgentTask>();
  private notifiedTaskIds = new Set<string>();
  private listeners = new Set<(tasks: AgentTask[]) => void>();
  private nextId = 1;

  create(
    name: string,
    runner: (task: AgentTask) => Promise<string>,
    cancel: () => void,
    options: CreateTaskOptions = {},
  ): AgentTask {
    const id = `agent-${String(this.nextId++)}`;
    const task: AgentTask = {
      id,
      name,
      ...(options.originToolCallId ? { originToolCallId: options.originToolCallId } : {}),
      status: "running",
      output: "",
      cancel,
      done: Promise.resolve(),
    };
    this.tasks.set(id, task);
    this.emitChange();

    task.done = Promise.resolve()
      .then(() => runner(task))
      .then((output) => {
        if (task.status === "running") {
          task.status = "completed";
          task.output = output;
          this.emitChange();
        }
      })
      .catch((error: unknown) => {
        if (task.status === "running") {
          task.status = "failed";
          task.output = `Error: ${asErrorString(error)}`;
          this.emitChange();
        }
      });

    return task;
  }

  get(id: string): AgentTask | undefined {
    return this.tasks.get(id);
  }

  list(): AgentTask[] {
    return [...this.tasks.values()];
  }

  subscribe(listener: (tasks: AgentTask[]) => void): () => void {
    this.listeners.add(listener);
    listener(this.list());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitChange(): void {
    const tasks = this.list();
    for (const listener of this.listeners) {
      listener(tasks);
    }
  }

  hasRunning(): boolean {
    return this.list().some((task) => task.status === "running");
  }

  stop(id: string): boolean {
    const task = this.tasks.get(id);
    if (task?.status !== "running") {
      return false;
    }
    task.status = "cancelled";
    task.output = "Stopped by user";
    task.cancel();
    this.emitChange();
    return true;
  }

  async stopAndWait(id: string): Promise<boolean> {
    const task = this.tasks.get(id);
    if (!task || !this.stop(id)) {
      return false;
    }
    await task.done;
    return true;
  }

  async stopAll(): Promise<void> {
    const running = this.list().filter((task) => task.status === "running");
    for (const task of running) {
      this.stop(task.id);
    }
    await Promise.allSettled(running.map((task) => task.done));
  }

  async waitAll(): Promise<void> {
    await Promise.allSettled(this.list().map((task) => task.done));
  }

  drainNotifications(): AgentTask[] {
    const completed = this.list().filter(
      (task) => task.status !== "running" && !this.notifiedTaskIds.has(task.id),
    );
    for (const task of completed) {
      this.notifiedTaskIds.add(task.id);
    }
    return completed;
  }

  clear(): void {
    this.tasks.clear();
    this.notifiedTaskIds.clear();
    this.emitChange();
  }
}

export function formatAgentTaskNotification(task: AgentTask): string {
  return [
    `<task-notification task_id="${task.id}" status="${task.status}">`,
    `name=${task.name}`,
    task.output,
    "</task-notification>",
  ].join("\n");
}
