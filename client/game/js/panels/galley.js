// THE GALLEY QUICK ACTIONS: a small floating panel over any vehicle with a galley. It shows what
// the galley holds, your hunger and thirst, and who else is aboard, with one button per thing you
// can do: eat or drink straight from it, or pass an item to a passenger.
//
// Like the truck's galley flap and the preparation HUD it holds no gameplay logic. Every button
// sends a verb string the server already answers (`<verb> eatid <id>`, `<verb> sendid <id> <pid>`),
// and the server replies with a fresh `galley_view`. The message names its own `verb`, so any
// vehicle's galley can answer with the same shape and this panel draws it unchanged.
//
// The bars are read from the client's own player state, which every player_update already keeps
// current, so watching your hunger costs no traffic. The window drags by its header and folds to
// a title bar (the − button) so it can stay up on a long flight without covering the view.
import { sendCmdSilent } from '../net.js';
import { state } from '../state.js';
import { makeFloatable } from './confirm.js';

let el = null, view = null, timer = 0;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function bar(label, v) {
  const n = Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
  const band = n <= 15 ? 'low' : n <= 40 ? 'mid' : 'ok';
  return `<div class="glly-vital glly-${band}"><span>${label}</span><div class="glly-track"><div class="glly-fill" style="width:${n}%"></div></div><b>${n}</b></div>`;
}

function build() {
  el = document.createElement('div');
  el.id = 'galley-panel';
  el.setAttribute('role', 'dialog');
  el.innerHTML = `<div class="glly-head"><span class="glly-title">Galley</span><span class="glly-mini" aria-live="off"></span>
    <span><button class="glly-min" aria-label="Minimise">−</button><button class="glly-close" aria-label="Close">✕</button></span></div>
    <div class="glly-body"></div>`;
  document.body.appendChild(el);
  makeFloatable(el, el.querySelector('.glly-head'));
  el.querySelector('.glly-close').onclick = closeGalley;
  el.querySelector('.glly-min').onclick = () => {
    const min = el.classList.toggle('glly-folded');
    // A dragged window carries an inline width; the folded bar sizes to its gauges instead.
    if (min) { el.dataset.w = el.style.width; el.style.width = ''; } else if (el.dataset.w) el.style.width = el.dataset.w;
    el.querySelector('.glly-min').textContent = min ? '▢' : '−';
    el.querySelector('.glly-min').setAttribute('aria-label', min ? 'Expand' : 'Reduce to a title bar');
  };
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmd]');
    if (b) sendCmdSilent(b.dataset.cmd);
  });
}

function render() {
  if (!el || !view) return;
  const p = state.player || {};
  const v = esc(view.verb);
  el.querySelector('.glly-title').textContent = view.title || 'Galley';
  // The folded bar's quick view: two small gauges, so a minimised galley still says how you are.
  const hu = Math.round(p.hunger ?? view.hunger ?? 0), th = Math.round(p.thirst ?? view.thirst ?? 0);
  const mini = (k, n) => '<span class="glly-mg glly-' + (n <= 15 ? 'low' : n <= 40 ? 'mid' : 'ok') + '" title="' + k + ' ' + n + '">' + k[0] + '<i><b style="width:' + Math.max(0, Math.min(100, n)) + '%"></b></i>' + n + '</span>';
  el.querySelector('.glly-mini').innerHTML = mini('Hunger', hu) + mini('Thirst', th);
  const pax = view.passengers || [];
  const items = (view.items || []).map((i) => {
    const send = pax.length
      ? `<select class="glly-to" aria-label="Pass to"><option value="">pass to…</option>${pax.map((q) => `<option value="${esc(q.id)}">${esc(q.name)}</option>`).join('')}</select>`
      : '';
    return `<li data-id="${esc(i.id)}"><span class="glly-name">${esc(i.name)}${i.qty > 1 ? ` <i>×${i.qty}</i>` : ''}</span>
      <button data-cmd="${v} ${i.verb === 'drink' ? 'drinkid' : 'eatid'} ${esc(i.id)}">${i.verb}</button>${send}</li>`;
  }).join('');
  const crew = pax.length
    ? `<div class="glly-sec">Aboard</div><ul class="glly-pax">${pax.map((q) => `<li>${esc(q.name)} <span>food ${Math.round(q.hunger ?? 0)} · water ${Math.round(q.thirst ?? 0)}</span></li>`).join('')}</ul>`
    : '';
  el.querySelector('.glly-body').innerHTML = `${bar('Hunger', p.hunger ?? view.hunger)}${bar('Thirst', p.thirst ?? view.thirst)}
    <div class="glly-sec">In the galley</div>
    ${items ? `<ul class="glly-items">${items}</ul>` : '<div class="glly-empty">Nothing to eat or drink.</div>'}${crew}`;
  el.querySelectorAll('.glly-to').forEach((s) => {
    s.onchange = () => { const id = s.closest('li').dataset.id; if (s.value) sendCmdSilent(`${view.verb} sendid ${id} ${s.value}`); };
  });
}

export function openGalley(msg) {
  view = msg;
  if (!el) build();
  el.classList.add('active');
  render();
  // The bars follow the live player state; the list only changes when the server says so.
  clearInterval(timer);
  timer = setInterval(() => { if (el?.classList.contains('active') && !el.querySelector('.glly-to:focus')) render(); }, 1000);
}

export function closeGalley() {
  clearInterval(timer); timer = 0;
  el?.classList.remove('active');
}
