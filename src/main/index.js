// MAIN-world entry: wraps fetch before the page's own scripts run.
import { installFetchHook } from "./fetch-hook.js";
import { ADAPTERS } from "./adapters/index.js";
import { requestRedaction, reportFailure } from "../shared/bridge.js";

installFetchHook({
  win: window,
  adapters: ADAPTERS,
  redactTexts: (texts) => requestRedaction(window, texts),
  onError: (reason) => reportFailure(window, reason),
});
