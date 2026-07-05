import { create } from "zustand";

export type ToastKind = "success" | "error" | "info";

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  detail?: string;
  action?: { label: string; run: () => void };
  actions?: { label: string; run: () => void }[];
}

interface ToastState {
  toasts: Toast[];
  dismiss: (id: number) => void;
}

let seq = 1;

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

function push(kind: ToastKind, title: string, detail?: string, action?: Toast["action"], actions?: Toast["actions"]): number {
  const id = seq++;
  // Keep at most 5 on screen; drop the oldest.
  useToasts.setState((s) => ({ toasts: [...s.toasts, { id, kind, title, detail, action, actions }].slice(-5) }));
  const ttl = kind === "error" ? 9000 : 4000;
  window.setTimeout(() => useToasts.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ttl);
  return id;
}

/** Fire a transient in-app toast from anywhere (components or plain modules). */
export const toast = {
  success: (title: string, detail?: string) => push("success", title, detail),
  error: (title: string, detail?: string, action?: Toast["action"]) => push("error", title, detail, action),
  info: (title: string, detail?: string) => push("info", title, detail),
  done: (title: string, detail?: string, actions?: Toast["actions"]) => push("success", title, detail, undefined, actions),
};
