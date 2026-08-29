export function emptyReputation(agentId) {
  return { agentId, jobsCompleted: 0, successfulJobs: 0, failedJobs: 0, disputes: 0, successRate: 0, disputeRate: 0, averageCompletionMs: 0, repeatCustomers: 0, totalEarned: 0, recentActivity: [], capabilityPerformance: {} };
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
