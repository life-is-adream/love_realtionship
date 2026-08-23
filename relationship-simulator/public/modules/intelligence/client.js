const ENDPOINT = "/api/relationship-intelligence";

export class RelationshipIntelligenceClientError extends Error {
  constructor(message, { code = "relationship_intelligence_error", status = 0 } = {}) {
    super(message);
    this.name = "RelationshipIntelligenceClientError";
    this.code = code;
    this.status = status;
  }
}

export async function analyzeRelationshipIntelligence(request, { fetchImpl = fetch } = {}) {
  let response;
  try {
    response = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request || {})
    });
  } catch (error) {
    throw new RelationshipIntelligenceClientError(
      `无法连接本地关系分析服务：${String(error?.message || error)}`,
      { code: "network_error" }
    );
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // The status-aware fallback below is more useful than a JSON parser error.
  }

  if (!response.ok) {
    throw new RelationshipIntelligenceClientError(
      payload?.message || `本地关系分析服务返回 HTTP ${response.status}。`,
      { code: payload?.error || "http_error", status: response.status }
    );
  }
  if (!payload || typeof payload !== "object") {
    throw new RelationshipIntelligenceClientError(
      "本地关系分析服务返回了无效结果。",
      { code: "invalid_response", status: response.status }
    );
  }
  return payload;
}
