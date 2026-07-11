import type { ReactElement } from "react";
import { useToasts, ToastKind } from "../lib/toast";
import { I } from "./icons";

const KIND: Record<ToastKind, { border: string; icon: string; Icon: (p: { className?: string }) => ReactElement }> = {
  success: { border: "border-lime-500/30", icon: "text-lime-400", Icon: I.Done },
  error: { border: "border-rose-500/40", icon: "text-rose-400", Icon: I.Close },
  info: { border: "border-aurora-500/30", icon: "text-aurora-300", Icon: I.More },
};

export default function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]">
      {toasts.map((t) => {
        const k = KIND[t.kind];
        return (
          <div
            key={t.id}
            className={`flex items-start gap-2.5 rounded-xl border ${k.border} bg-ink-800/95 backdrop-blur-md p-3 shadow-glow animate-fade-up`}
          >
            <k.Icon className={`w-4 h-4 shrink-0 mt-0.5 ${k.icon}`} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-slate-100 break-words">{t.title}</div>
              {t.detail && <div className="mt-0.5 text-xs text-slate-400 break-words">{t.detail}</div>}
              {t.action && (
                <button
                  className="mt-1.5 text-xs font-medium text-aurora-300 hover:text-aurora-200"
                  onClick={() => { t.action!.run(); dismiss(t.id); }}
                >
                  {t.action.label}
                </button>
              )}
              {t.actions && t.actions.length > 0 && (
                <div className="mt-1.5 flex gap-3">
                  {t.actions.map((a, i) => (
                    <button
                      key={i}
                      className="text-xs font-medium text-aurora-300 hover:text-aurora-200"
                      onClick={() => { a.run(); dismiss(t.id); }}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button className="shrink-0 text-slate-500 hover:text-slate-200" title="Dismiss" onClick={() => dismiss(t.id)}>
              <I.Close className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
