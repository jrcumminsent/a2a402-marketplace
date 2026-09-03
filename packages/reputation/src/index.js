export function emptyReputation(agentId) {
  return { agentId, jobsCompleted: 0, successfulJobs: 0, failedJobs: 0, disputes: 0, successRate: 0, disputeRate: 0, averageCompletionMs: 0, repeatCustomers: 0, totalEarned: 0, averageQualityScore: 0, evaluationsReceived: 0, acceptedEvaluations: 0, rejectedEvaluations: 0, recentEvaluations: [], recentActivity: [], capabilityPerformance: {} };
}
export function recordSuccess(rep, { capability, amount, durationMs, customerId }) {
  rep.jobsCompleted += 1; rep.successfulJobs += 1; rep.totalEarned += Number(amount);
  rep.successRate = rep.successfulJobs / Math.max(1, rep.jobsCompleted);
  rep.averageCompletionMs = Math.round(((rep.averageCompletionMs * (rep.jobsCompleted - 1)) + durationMs) / rep.jobsCompleted);
  const cp = rep.capabilityPerformance[capability] ?? { completed: 0, successful: 0, successRate: 0 };
  cp.completed += 1; cp.successful += 1; cp.successRate = cp.successful / cp.completed; rep.capabilityPerformance[capability] = cp;
  const customers = new Set(rep.recentActivity.filter(x => x.customerId).map(x => x.customerId)); if (customers.has(customerId)) rep.repeatCustomers += 1;
  rep.recentActivity.push({ type: 'success', capability, amount, customerId, at: new Date().toISOString() }); rep.recentActivity = rep.recentActivity.slice(-20);
}
export function recordFailure(rep, { capability }) {
  rep.jobsCompleted += 1; rep.failedJobs += 1; rep.successRate = rep.successfulJobs / Math.max(1, rep.jobsCompleted);
  const cp = rep.capabilityPerformance[capability] ?? { completed: 0, successful: 0, successRate: 0 }; cp.completed += 1; cp.successRate = cp.successful / cp.completed; rep.capabilityPerformance[capability] = cp;
}
export function recordEvaluation(rep, { qualityScore, accepted, evaluatorId, jobId, deliveryId, evaluationId }) {
  const score = Math.max(0, Math.min(100, Number(qualityScore)));
  const count = Number(rep.evaluationsReceived || 0);
  rep.averageQualityScore = Math.round((((Number(rep.averageQualityScore || 0) * count) + score) / (count + 1)) * 100) / 100;
  rep.evaluationsReceived = count + 1;
  rep.acceptedEvaluations = Number(rep.acceptedEvaluations || 0) + (accepted ? 1 : 0);
  rep.rejectedEvaluations = Number(rep.rejectedEvaluations || 0) + (accepted ? 0 : 1);
  if (!Array.isArray(rep.recentEvaluations)) rep.recentEvaluations = [];
  rep.recentEvaluations.push({ evaluationId, deliveryId, jobId, evaluatorId, accepted: Boolean(accepted), qualityScore: score, at: new Date().toISOString() });
  rep.recentEvaluations = rep.recentEvaluations.slice(-20);
  rep.recentActivity.push({ type: 'evaluation', evaluationId, deliveryId, jobId, evaluatorId, accepted: Boolean(accepted), qualityScore: score, at: new Date().toISOString() });
  rep.recentActivity = rep.recentActivity.slice(-20);
  return rep;
}
