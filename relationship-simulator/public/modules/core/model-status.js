export function modelStatusLabel({ health = null, failed = false, completed = false } = {}) {
  if (failed) return "本地服务暂不可用";
  if (completed) return "本次模型调用成功";
  if (!health) return "本地服务待检查";
  if (health.ok !== true) return "本地服务暂不可用";
  if (health.hasApiKey !== true) return "本地服务可用 · 模型未配置";
  return "本地服务可用 · 模型已配置，连接未核验";
}
