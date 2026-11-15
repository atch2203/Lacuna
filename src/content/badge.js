// In-page notice pills, isolated from page styles via a shadow root.
// One host element; each notice is its own pill, stacked bottom-right.

let stack = null;

function ensureStack() {
  if (stack?.isConnected) return stack;
  const host = document.createElement("div");
  host.setAttribute("data-llm-redactor", "badge");
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <style>
      .stack {
        position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
        display: flex; flex-direction: column; gap: 8px; align-items: flex-end;
      }
      .pill {
        max-width: 380px; padding: 10px 14px; border-radius: 14px; cursor: pointer;
        white-space: pre-line; overflow-wrap: anywhere;
        font: 13px/1.35 system-ui, sans-serif; color: #fff;
        box-shadow: 0 4px 16px rgba(0,0,0,.25);
      }
      .warn { background: #b42318; }
      .info { background: #1f2937; }
    </style>
    <div class="stack"></div>`;
  document.documentElement.appendChild(host);
  stack = shadow.querySelector(".stack");
  return stack;
}

// Returns an update function so a "working…" notice can be replaced in place.
function show(kind, message, timeoutMs) {
  const pill = document.createElement("div");
  pill.className = `pill ${kind}`;
  pill.setAttribute("role", kind === "warn" ? "alert" : "status");
  pill.title = "Click to dismiss";
  pill.addEventListener("click", () => pill.remove());
  ensureStack().appendChild(pill);
  let timer = null;
  const update = (nextKind, nextMessage, nextTimeout) => {
    pill.className = `pill ${nextKind}`;
    pill.textContent = nextKind === "warn" ? `⚠ ${nextMessage}` : nextMessage;
    clearTimeout(timer);
    if (nextTimeout) timer = setTimeout(() => pill.remove(), nextTimeout);
  };
  update(kind, message, timeoutMs);
  return update;
}

export function showWarningBadge(message) {
  return show("warn", message, 0);
}

export function showInfoBadge(message, { timeoutMs = 4000 } = {}) {
  return show("info", message, timeoutMs);
}
