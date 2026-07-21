// HALCYON ASSURANCE — the underwriting-floor popup (insure/policies/claim).
// Same CRT-terminal language as atm.js (chassis/bezel/tube/scanlines) but its own
// dedicated markup/CSS, themed in the insurer's amber rather than a bank's green,
// plus a wireframe silhouette of the selected aircraft instead of a balance screen.
import { sendCmdSilent } from '../net.js';
import { drawWireframe3D, themeColor } from './wireframe-plane.js';

let data = null;
let selId = null;

// The stage's true-3D wireframe spins on its own tiny loop (render() rebuilds
// the CRT screen's innerHTML — and with it the canvas element — on every data
// push/selection change, so the draw can't just live inside render()).
let wfRaf = null, wfYaw = 0;
function startWfSpin() {
  if (wfRaf) return;
  let last = 0;
  const loop = (t) => {
    if (!data) { wfRaf = null; return; }
    if (last) wfYaw += Math.min(0.05, (t - last) / 1000) * 0.6;
    last = t;
    const wf = document.getElementById('ins-wf');
    const sel = data.fleet.find(f => f.id === selId) || null;
    if (wf && sel) drawWireframe3D(wf.getContext('2d'), { cls: sel.class, armed: sel.class === 'heli' && (sel.hardpoints > 0), w: wf.width, h: wf.height, accent: themeColor('--yellow', '#ffb43a'), yaw: wfYaw });
    else if (wf) wf.getContext('2d').clearRect(0, 0, wf.width, wf.height);
    wfRaf = requestAnimationFrame(loop);
  };
  wfRaf = requestAnimationFrame(loop);
}
function stopWfSpin() { if (wfRaf) cancelAnimationFrame(wfRaf); wfRaf = null; }

export function openInsurancePanel(d) {
  data = d;
  selId = d.fleet?.[0]?.id ?? null;
  render();
  document.getElementById('insurance-panel').classList.add('active');
  startWfSpin();
}

export function updateInsurancePanel(d) {
  if (!data || !document.getElementById('insurance-panel').classList.contains('active')) return;
  data = d;
  if (!data.fleet?.some(f => f.id === selId)) selId = data.fleet?.[0]?.id ?? null;
  render();
}

export function closeInsurancePanel() {
  document.getElementById('insurance-panel').classList.remove('active');
  data = null;
  stopWfSpin();
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (n) => '₵ ' + (n ?? 0).toLocaleString();

function render() {
  if (!data) return;
  const sel = data.fleet.find(f => f.id === selId) || null;

  const rows = data.fleet.map(f => `
    <button class="ins-row${f.id === selId ? ' ins-row-sel' : ''}" data-sel="${f.id}">
      <span class="ins-row-name">${esc(f.typeName)} <i>"${esc(f.name)}"</i></span>
      <span class="ins-row-status ${f.insured ? 'ins-ok' : 'ins-off'}">${f.insured ? `COVERED · ${f.daysLeft}d` : 'UNINSURED'}</span>
    </button>`).join('') || '<div class="ins-empty">No aircraft on record.</div>';

  const claims = (data.claims || []).map(c => `
    <div class="ins-claim">
      <span>${esc(c.typeName)} — pays ${fmt(c.payout)} <span class="ins-dim">(after ${fmt(c.deductible)} excess)</span></span>
      <button class="ins-btn ins-accent" data-claim="${c.id}">Collect</button>
    </div>`).join('');

  const selInfo = sel ? `
    <div class="ins-sel">
      <div class="ins-sel-name"><b>${esc(sel.typeName)}</b> "${esc(sel.name)}"</div>
      <div class="ins-sel-status ${sel.insured ? 'ins-ok' : 'ins-off'}">${sel.insured ? `COVERED · ${sel.daysLeft}d left` : 'UNINSURED'}</div>
      <div class="ins-sel-premium">Premium <b>${fmt(sel.premium)}</b> / ${data.periodDays}d</div>
      <button class="ins-btn ins-accent" data-bind="${sel.id}">${sel.insured ? 'Renew' : 'Insure'}</button>
    </div>` : '';

  const surcharge = data.paidClaims
    ? `<div class="ins-warn">${data.paidClaims} prior claim${data.paidClaims > 1 ? 's' : ''} surcharge your premiums.</div>` : '';

  document.getElementById('ins-crt-screen').innerHTML = `
    <div class="ins-top">
      <span class="ins-title">HALCYON ASSURANCE</span>
      <span class="ins-sub">◤ HULL COVER ◥</span>
    </div>
    <div class="ins-wfstage"><canvas id="ins-wf" width="220" height="130"></canvas></div>
    ${selInfo}
    <div class="ins-section">FLEET</div>
    <div class="ins-list">${rows}</div>
    ${claims ? `<div class="ins-section">OPEN CLAIMS</div><div class="ins-claims">${claims}</div>` : ''}
    ${surcharge}
    <div class="ins-note">A covered write-off pays ${data.payoutPct}% of agreed value, less a ${data.deductiblePct}% excess — we keep the wreck.</div>`;

  wire();
}

function wire() {
  const scr = document.getElementById('ins-crt-screen');
  scr.querySelectorAll('[data-sel]').forEach(el => el.addEventListener('click', () => { selId = el.getAttribute('data-sel'); render(); }));
  scr.querySelectorAll('[data-bind]').forEach(el => el.addEventListener('click', () => sendCmdSilent(`insure ${el.getAttribute('data-bind')}`)));
  scr.querySelectorAll('[data-claim]').forEach(el => el.addEventListener('click', () => sendCmdSilent(`claim ${el.getAttribute('data-claim')}`)));
}

export function initInsurancePanel() {
  document.getElementById('ins-close').addEventListener('click', closeInsurancePanel);
  document.getElementById('insurance-panel').addEventListener('click', e => {
    if (e.target.id === 'insurance-panel') closeInsurancePanel();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && data) closeInsurancePanel();
  });
}
