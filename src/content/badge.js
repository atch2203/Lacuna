// In-page warning pill, isolated from page styles via a shadow root.

let host = null;
let label = null;

export function showWarningBadge(message) {
  if (!host || !host.isConnected) {
    host = document.createElement("div");
    host.setAttribute("data-llm-redactor", "badge");
    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = `
      <style>
        div {
          position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
          max-width: 360px; padding: 10px 14px; border-radius: 999px;
          background: #b42318; color: #fff; cursor: pointer;
          font: 13px/1.35 system-ui, sans-serif;
          box-shadow: 0 4px 16px rgba(0,0,0,.25);
        }
      </style>
      <div role="alert" title="Click to dismiss"></div>`;
    label = shadow.querySelector("div");
    label.addEventListener("click", () => host.remove());
    document.documentElement.appendChild(host);
  }
  label.textContent = `⚠ ${message}`;
}
