import { useCallback, useEffect, useRef, useState } from "react";

interface Options {
  blocked: boolean;
  send: (message: string) => Promise<void>;
  onError: (error: unknown) => void;
}

export function useFollowUpQueue({ blocked, send, onError }: Options) {
  const pending = useRef<string[]>([]);
  const active = useRef(false);
  const mounted = useRef(true);
  const callbacks = useRef({ send, onError });
  callbacks.current = { send, onError };
  const [messages, setMessages] = useState<string[]>([]);
  const [processing, setProcessing] = useState(false);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const enqueue = useCallback((message: string) => {
    if (!message.trim()) {
      return;
    }
    pending.current = [...pending.current, message];
    setMessages(pending.current);
    setPaused(false);
  }, []);

  const takeLast = useCallback((): string | undefined => {
    const message = pending.current.at(-1);
    if (message === undefined) {
      return undefined;
    }
    pending.current = pending.current.slice(0, -1);
    setMessages(pending.current);
    return message;
  }, []);

  useEffect(() => {
    if (blocked || paused || active.current || pending.current.length === 0) {
      return;
    }
    const next = pending.current[0];
    pending.current = pending.current.slice(1);
    active.current = true;
    setMessages(pending.current);
    setProcessing(true);
    void (async () => {
      try {
        await callbacks.current.send(next);
      } catch (error) {
        if (mounted.current) {
          setPaused(true);
          callbacks.current.onError(error);
        }
      } finally {
        active.current = false;
        if (mounted.current) {
          setProcessing(false);
        }
      }
    })();
  }, [blocked, messages, paused, processing]);

  return { messages, enqueue, takeLast, processing, paused };
}
