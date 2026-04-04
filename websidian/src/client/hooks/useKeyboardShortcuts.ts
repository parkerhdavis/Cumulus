import { useEffect } from "react";

type ShortcutHandler = () => void;

interface Shortcut {
  key: string;
  meta?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  handler: ShortcutHandler;
}

export function useKeyboardShortcuts(shortcuts: Shortcut[]) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      for (const shortcut of shortcuts) {
        const metaMatch = shortcut.meta ? e.metaKey || e.ctrlKey : true;
        const ctrlMatch = shortcut.ctrl ? e.ctrlKey : true;
        const shiftMatch = shortcut.shift ? e.shiftKey : !e.shiftKey;

        if (e.key.toLowerCase() === shortcut.key.toLowerCase() && metaMatch && ctrlMatch && shiftMatch) {
          e.preventDefault();
          shortcut.handler();
          return;
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [shortcuts]);
}
