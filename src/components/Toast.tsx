import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

interface ToastItem {
  id: number;
  message: string;
}

const ToastContext = createContext<(message: string) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

/** What to say when an action succeeds, and a fallback for when it does not. */
export interface ActionMessages {
  /** Fixed, or built from what the action resolved with — a send reports how many went out. */
  success: string | ((result: unknown) => string);
  failure: string;
}

/**
 * Runs an async workspace action and reports how it went: the success message on
 * resolve, the thrown error's own message on reject.
 *
 * Pages use this instead of `void action(); toast(...)` because a fire-and-forget
 * call announces success whatever happens — the workspace `error` state is not
 * rendered once data has loaded, so a failed write used to be invisible.
 */
export function useActionToast() {
  const toast = useToast();
  return useCallback(
    async (run: () => Promise<unknown>, messages: ActionMessages) => {
      try {
        const result = await run();
        toast(typeof messages.success === "function" ? messages.success(result) : messages.success);
      } catch (cause) {
        toast(cause instanceof Error ? cause.message : messages.failure);
      }
    },
    [toast],
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((message: string) => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, message }]);
    window.setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 3200);
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-5 left-1/2 z-50 flex w-full max-w-sm -translate-x-1/2 flex-col items-center gap-2 px-4">
        {items.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto w-full rounded-lg bg-slate-900 px-3.5 py-2.5 text-center text-sm text-white shadow-lg"
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
