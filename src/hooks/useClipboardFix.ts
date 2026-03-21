import { useEffect } from "react";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";

/**
 * WebKitGTK blocks navigator.clipboard.readText/writeText with NotAllowedError.
 * This module polyfills the Clipboard API with Tauri's clipboard-manager plugin
 * so that all code (including Monaco's built-in context menu) works transparently.
 */

let polyfilled = false;

function installClipboardPolyfill() {
  if (polyfilled) return;
  polyfilled = true;

  const origReadText = navigator.clipboard.readText.bind(navigator.clipboard);
  const origWriteText = navigator.clipboard.writeText.bind(navigator.clipboard);

  navigator.clipboard.readText = async () => {
    try {
      return await readText();
    } catch {
      return origReadText();
    }
  };

  navigator.clipboard.writeText = async (text: string) => {
    try {
      await writeText(text);
    } catch {
      await origWriteText(text);
    }
  };
}

/**
 * Additionally handles Ctrl+V for native input/textarea elements that
 * don't use the async Clipboard API (they rely on paste events instead).
 */
export function useClipboardFix() {
  // Install polyfill once on first render
  installClipboardPolyfill();

  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;

      const active = document.activeElement;
      if (!active) return;

      // Only handle native input/textarea — Monaco uses the polyfilled Clipboard API
      const isNativeInput =
        (active instanceof HTMLInputElement && active.type !== "checkbox" && active.type !== "radio") ||
        active instanceof HTMLTextAreaElement;

      if (!isNativeInput) return;

      if (e.key === "v") {
        e.preventDefault();
        try {
          const text = await readText();
          document.execCommand("insertText", false, text);
        } catch {
          // clipboard not available
        }
      }

      if (e.key === "c") {
        const input = active as HTMLInputElement | HTMLTextAreaElement;
        const selected = input.value.substring(input.selectionStart ?? 0, input.selectionEnd ?? 0);
        if (selected) {
          e.preventDefault();
          writeText(selected).catch(() => {});
        }
      }

      if (e.key === "x") {
        const input = active as HTMLInputElement | HTMLTextAreaElement;
        const selected = input.value.substring(input.selectionStart ?? 0, input.selectionEnd ?? 0);
        if (selected) {
          e.preventDefault();
          writeText(selected).catch(() => {});
          document.execCommand("delete");
        }
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);
}
