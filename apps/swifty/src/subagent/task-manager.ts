import { asErrorString } from "@/utils/utils.js";

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
