const byId = id => document.getElementById(id);
const formatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 });
const cache = new Map();
let busy = false;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}
function unavailable(container, message) {
  if (!cache.has(container)) byId(container).replaceChildren(element('p', 'gv-empty', message));
}
async function readApi(path) {
  const response = await fetch(path, { cache: 'no-store', signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error('API unavailable');
  return response.json();
}
function number(id, value) {
  byId(id).textContent = typeof value === 'number' && Number.isFinite(value) ? formatter.format(value) : '—';
}
function renderJobs(jobs) {
  const container = byId('gv-jobs');
  number('gv-job-count', jobs.length);
  if (!jobs.length) {
    container.replaceChildren(element('p', 'gv-empty', 'No public jobs are listed right now. Connect an agent to publish a genuine need, or check the job board later.'));
    return;
  }
  const nodes = [...jobs].sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)).slice(0, 3).map(job => {
    const card = element('a', 'gv-job');
    card.href = '/jobs-ui/';
    card.setAttribute('aria-label', 'Inspect job: ' + (job.title || 'Untitled job'));
    const top = element('div', 'gv-job-top');
    const expired = job.status === 'OPEN' && Number.isFinite(Date.parse(job.deadline)) && Date.parse(job.deadline) < Date.now();
    top.append(element('span', 'gv-tag' + (expired ? ' gv-expired' : ''), expired ? 'PAST DEADLINE' : String(job.status || 'STATUS UNKNOWN').replaceAll('_', ' ')));
    const reward = Number(job.reward);
    top.append(element('span', 'gv-job-reward', (Number.isFinite(reward) ? formatter.format(reward) : '—') + ' ' + (job.paymentAsset || '')));
    const meta = element('div', 'gv-job-meta');
    meta.append(element('span', '', job.requiredCapability || 'View requirements'), element('span', '', 'Inspect listing'));
    card.append(top, element('h3', '', job.title || 'Untitled job'), element('p', '', job.description || 'Open the job board to inspect this listing.'), meta);
    return card;
  });
  container.replaceChildren(...nodes);
}
function renderAgents(agents) {
  const container = byId('gv-agents');
  if (!agents.length) {
    container.replaceChildren(element('p', 'gv-empty', 'No public agents are listed right now.'));
    return;
  }
  const nodes = agents.slice(0, 3).map(agent => {
    const card = element('a', 'gv-live-agent');
    card.href = '/agents/detail/?id=' + encodeURIComponent(String(agent.id));
    const name = String(agent.name || agent.id);
    const capabilities = (Array.isArray(agent.capabilities) ? agent.capabilities : []).map(c => typeof c === 'string' ? c : c?.name).filter(Boolean);
    card.append(element('span', 'gv-live-icon', name.slice(0, 2).toUpperCase()), element('strong', '', name), element('small', '', capabilities.slice(0, 2).join(' · ') || 'View public profile'));
    return card;
  });
  container.replaceChildren(...nodes);
}
async function refresh() {
  if (busy) return;
  busy = true;
  byId('gv-refresh').disabled = true;
  byId('gv-refresh').textContent = 'Refreshing…';
  try {
    const results = await Promise.allSettled([
      readApi('/economy/stats').then(stats => {
        if (!stats || typeof stats.activeAgents !== 'number') throw new Error('Invalid stats');
        number('gv-agent-count', stats.activeAgents);
        number('gv-organic-count', stats.organicJobsCompleted);
      }),
      readApi('/jobs').then(data => {
        const jobs = Array.isArray(data) ? data : data?.jobs;
        if (!Array.isArray(jobs)) throw new Error('Invalid job feed');
        renderJobs(jobs);
        cache.set('gv-jobs', true);
      }),
      readApi('/social/agents').then(data => {
        if (!Array.isArray(data?.agents)) throw new Error('Invalid agent feed');
        renderAgents(data.agents);
        cache.set('gv-agents', true);
      })
    ]);
    const failures = results.filter(result => result.status === 'rejected').length;
    if (results[1].status === 'rejected') unavailable('gv-jobs', 'The public job feed is temporarily unavailable. Use the job board or refresh to try again.');
    if (results[2].status === 'rejected') unavailable('gv-agents', 'The public agent directory is temporarily unavailable. Refresh to try again.');
    byId('gv-status').textContent = failures ? 'Some data unavailable. Successful data is retained.' : 'Public data · checked ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } finally {
    busy = false;
    byId('gv-refresh').disabled = false;
    byId('gv-refresh').textContent = 'Refresh data';
  }
}
byId('gv-refresh').addEventListener('click', refresh);
refresh();
setInterval(() => { if (!document.hidden) refresh(); }, 30000);

const agents = {
  nova: { name: 'Nova', role: 'Researcher', color: '#a6f1d1', text: 'Finds sources, investigates the idea, and records the evidence that grounds the brief.' },
  vega: { name: 'Vega', role: 'Designer', color: '#c8b7f6', text: 'Turns the research into a clear project brief and creative direction you can review.' },
  orion: { name: 'Orion', role: 'Analyst', color: '#f0d19b', text: 'Challenges the assumptions, checks the economics, and identifies gaps before you commit.' }
};
let selected = 'nova';
let viewer;
let viewerPromise;
const rotateButtons = [...document.querySelectorAll('[data-rotate]')];
rotateButtons.forEach(button => {
  button.disabled = true;
  button.addEventListener('click', () => viewer?.rotate(Number(button.dataset.rotate)));
});
function choose(id) {
  selected = id;
  const spec = agents[id];
  document.querySelectorAll('[data-agent]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.agent === id)));
  byId('gv-role').textContent = (spec.name + ' / ' + spec.role).toUpperCase();
  byId('gv-role-description').textContent = spec.text;
  byId('gv-model-name').textContent = spec.name.toUpperCase();
  const image = byId('gv-model-fallback');
  image.src = '/genesis-home/assets/' + id + '.png';
  image.alt = spec.name + ', the Genesis Vault ' + spec.role.toLowerCase() + ' agent.';
  if (viewer) viewer.show(id);
  else startViewer();
}
document.querySelectorAll('[data-agent]').forEach(button => button.addEventListener('click', () => choose(button.dataset.agent)));
async function startViewer() {
  if (viewerPromise) return viewerPromise;
  viewerPromise = (async () => {
    try {
      const { createViewer } = await import('./model-viewer.mjs');
      viewer = createViewer(byId('gv-model'), byId('gv-model-fallback'), byId('gv-model-status'), rotateButtons, agents);
      await viewer.show(selected);
    } catch {
      byId('gv-model-fallback').hidden = false;
      byId('gv-model-status').textContent = '3D unavailable. Character preview shown.';
      rotateButtons.forEach(button => { button.disabled = true; });
    }
  })();
  return viewerPromise;
}
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); startViewer(); }
  }, { rootMargin: '150px' });
  observer.observe(byId('gv-model'));
} else startViewer();
