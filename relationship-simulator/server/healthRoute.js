import { LLM_API_KEY, LLM_API_MODE, LLM_ENDPOINT, LLM_MODEL, maskEndpoint } from "./config.js";
import { sendJson } from "./http.js";

export function handleHealth(res) {
  return sendJson(res, 200, {
    ok: true,
    service: "heartflow",
    endpoint: maskEndpoint(LLM_ENDPOINT),
    model: LLM_MODEL,
    apiMode: LLM_API_MODE,
    hasApiKey: Boolean(LLM_API_KEY)
  });
}
