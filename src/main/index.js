// MAIN-world entry: wraps fetch and XHR before the page's own scripts run.
import { installFetchHook } from "./fetch-hook.js";
import { installXhrHook } from "./xhr-hook.js";
import { ADAPTERS } from "./adapters/index.js";
import { requestRedaction, reportFailure } from "../shared/bridge.js";

const hookOptions = {
  win: window,
  adapters: ADAPTERS,
  redactTexts: (texts) => requestRedaction(window, texts),
  onError: (reason) => reportFailure(window, reason),
};

installFetchHook(hookOptions);
installXhrHook(hookOptions);
