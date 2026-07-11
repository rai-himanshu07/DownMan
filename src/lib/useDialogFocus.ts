import { useEffect, useRef } from "react";

const FOCUSABLE = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "a[href]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function useDialogFocus<T extends HTMLElement>(onEscape: () => void, active = true) {
  const dialogRef = useRef<T>(null);
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;

  useEffect(() => {
    if (!active) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const hidden: { element: HTMLElement; inert: boolean; ariaHidden: string | null }[] = [];
    let branch: HTMLElement = dialog;
    let parent = branch.parentElement;
    const root = document.getElementById("root");
    while (parent) {
      for (const child of [...parent.children]) {
        if (child === branch || !(child instanceof HTMLElement)) continue;
        hidden.push({ element: child, inert: child.inert, ariaHidden: child.getAttribute("aria-hidden") });
        child.inert = true;
        child.setAttribute("aria-hidden", "true");
      }
      if (parent === root) break;
      branch = parent;
      parent = parent.parentElement;
    }
    const focusables = () => [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const initial = dialog.querySelector<HTMLElement>("[data-dialog-autofocus]") || focusables()[0] || dialog;
    const frame = requestAnimationFrame(() => initial.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        escapeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (!items.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      dialog.removeEventListener("keydown", onKeyDown);
      for (const item of hidden) {
        item.element.inert = item.inert;
        if (item.ariaHidden === null) item.element.removeAttribute("aria-hidden");
        else item.element.setAttribute("aria-hidden", item.ariaHidden);
      }
      if (previous?.isConnected) previous.focus();
    };
  }, [active]);

  return dialogRef;
}