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

import { asErrorString } from "@/utils/utils.js";

export interface AgentTask {
  id: string;
  name: string;
  status: "running" | "completed" | "failed" | "cancelled";
  output: string;
  cancel: () => void;
}

export class TaskManager {
  private tasks = new Map<string, AgentTask>();
  private nextId = 1;

  create(name: string, runner: () => Promise<string>, cancel: () => void): AgentTask {
    const id = String(this.nextId++);
    const task: AgentTask = {
      id,
      name,
      status: "running",
      output: "",
      cancel,
    };
    this.tasks.set(id, task);

    runner()
      .then((output) => {
        task.status = "completed";
        task.output = output;
      })
      .catch((err: unknown) => {
        task.status = "failed";
        task.output = `Error: ${asErrorString(err)}`;
      });

    return task;
  }

  get(id: string): AgentTask | undefined {
    return this.tasks.get(id);
  }

  list(): AgentTask[] {
    return [...this.tasks.values()];
  }

  /** Abort a running task; returns whether a task was actually stopped. Returns false for tasks that have already finished. */
  stop(id: string): boolean {
    const task = this.tasks.get(id);
    if (task?.status === "running") {
      task.cancel();
      task.status = "cancelled";
      task.output = "Stopped by user";
      return true;
    }
    return false;
  }

  drainNotifications(): AgentTask[] {
    const completed: AgentTask[] = [];
    for (const task of this.tasks.values()) {
      if (task.status !== "running") {
        completed.push(task);
      }
    }
    return completed;
  }
}
