/**
 * Copy text to the clipboard, returning whether it worked.
 *
 * The async Clipboard API (`navigator.clipboard`) only exists in a secure
 * context — HTTPS or localhost. This app is frequently served over plain HTTP
 * on a LAN address (e.g. a Raspberry Pi at http://192.168.x.x:3002), where
 * `navigator.clipboard` is undefined, so fall back to the legacy
 * `document.execCommand("copy")` via an off-screen textarea.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the execCommand path
  }

  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
