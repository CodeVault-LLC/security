import { BrowserWindow } from "electron";

import { PASSPHRASE_PROMPT_WEB_PREFERENCES } from "../security.js";

const PROMPT_HTML = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; form-action 'none'">
  <style>
    :root { color-scheme: dark; font: 13px system-ui, sans-serif; background: #161719; color: #f4f4f5; }
    body { margin: 0; padding: 22px; }
    h1 { font-size: 15px; margin: 0 0 8px; }
    p { color: #a1a1aa; line-height: 1.45; margin: 0 0 16px; }
    label { display: block; margin-bottom: 6px; }
    input { box-sizing: border-box; width: 100%; padding: 8px; color: inherit; background: #202124; border: 1px solid #4a4b50; border-radius: 5px; }
    .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
    button { padding: 7px 14px; color: inherit; background: #292a2e; border: 1px solid #4a4b50; border-radius: 5px; }
    button[type=submit] { background: #2859a8; border-color: #3972ca; }
  </style>
</head>
<body>
  <h1>Unlock local OpenPGP key</h1>
  <p>The passphrase is used once in memory. It is never stored or sent to CodeVault Security.</p>
  <form id="prompt-form">
    <label for="passphrase">Private-key passphrase</label>
    <input id="passphrase" type="password" autocomplete="off" spellcheck="false" autofocus>
    <div class="actions">
      <button id="cancel" type="button">Cancel</button>
      <button type="submit">Unlock</button>
    </div>
  </form>
</body>
</html>`;

/**
 * Dedicated trusted modal for a local key passphrase.
 *
 * It has no preload, Node, network, navigation, persistence, or DevTools. The
 * value resolves directly to main and never crosses the application bridge.
 */
export async function promptPrivateKeyPassphrase(
  parent: BrowserWindow,
): Promise<string | null> {
  const prompt = new BrowserWindow({
    parent,
    modal: true,
    show: false,
    width: 460,
    height: 290,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: "Unlock OpenPGP key",
    webPreferences: PASSPHRASE_PROMPT_WEB_PREFERENCES,
  });
  prompt.setMenuBarVisibility(false);
  prompt.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  prompt.webContents.on("will-navigate", (event) => event.preventDefault());
  await prompt.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(PROMPT_HTML)}`,
  );

  const closed = new Promise<null>((resolve) => {
    prompt.once("closed", () => resolve(null));
  });
  const entered = prompt.webContents.executeJavaScript(
    `(function () {
      const form = document.getElementById("prompt-form");
      const input = document.getElementById("passphrase");
      const cancel = document.getElementById("cancel");
      input.focus();
      return new Promise((resolve) => {
        form.addEventListener("submit", (event) => {
          event.preventDefault();
          resolve(input.value);
          input.value = "";
        }, { once: true });
        cancel.addEventListener("click", () => resolve(null), { once: true });
        document.addEventListener("keydown", (event) => {
          if (event.key === "Escape") resolve(null);
        });
      });
    })()`,
    true,
  ) as Promise<unknown>;
  prompt.show();
  const value = await Promise.race([entered, closed]);
  if (!prompt.isDestroyed()) prompt.close();
  return typeof value === "string" && value.length > 0 ? value : null;
}
