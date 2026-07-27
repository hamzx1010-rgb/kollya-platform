/**
 * KOLIYA — features/campus_sm.js
 * ============================================================
 * Channels, events, Q&A, explore and saved.
 *
 * These five share one shape — a searchable list of cards — so they
 * share one module rather than five near-identical files.
 *
 * Events and Q&A keep the original app's identity: a tall gradient
 * hero with the create button sitting on it, not a thin grey toolbar.
 * You asked for that back specifically, and it is the right call:
 * the hero is what tells you at a glance which screen you are on.
 *
 * Q&A keeps the anonymity guarantee too: an anonymous question never
 * carries its author to the client — enforced in RLS, and stripped
 * again in api_sm.js.
 * ============================================================
 */

import {
  $, $$, el, on, esc, richText, timeAgo, compact, initials, avatarColor,
  debounce, uid, truncate, safeUrl, cssEscape
} from '../core/utils_sm.js';
import { me, scoped, frequency } from '../core/store_sm.js';
import { person, cachePeople } from '../core/people_sm.js';
import { act, rankBadge } from '../core/game_sm.js';
import { I, icon } from '../core/icons_sm.js';
import {
  toast, modal, contextMenu, confirmDialog, emptyState, skeletonList, optimistic
} from '../core/ui_sm.js';
import { route, go } from '../core/router_sm.js';

let api = null;
export function useApi(impl) { api = impl; }

const store = scoped('campus');

/** Rendered while the first request is in flight. */
const loading = (n = 3) => skeletonList(n, 'conv');

/** Every screen fails the same way: say what happened, offer a retry. */
function failed(host, err, retry) {
  host.innerHTML = '';
  host.append(emptyState({
    icon: I.inbox,
    title: 'Chargement impossible',
    text: err?.status === 401
      ? 'Session expirée — reconnectez-vous.'
      : (err?.message || 'Réessayez dans un instant.'),
    action: { label: 'Réessayer', onClick: retry }
  }));
}

const avatarChip = (u, cls = 'av sm') => u?.avatar_url
  ? `<span class="${cls}"><img src="${esc(safeUrl(u.avatar_url))}" alt=""></span>`
  : `<span class="${cls}" style="background:${avatarColor(u?.id)}">${esc(initials(u?.full_name || ''))}</span>`;

/* ============================================================
   CHANNELS
   ============================================================ */

let channels = [];

function channelCard(c) {
  return `<article class="cc" data-id="${esc(c.id)}">
      <div class="cc-ic" style="background:${avatarColor(c.id)}">${icon(c.official ? 'globe' : 'hash', { size: 18 })}</div>
      <div class="grow" style="min-width:0">
        <div class="row g2" style="flex-wrap:wrap">
          <span class="t-bold">${esc(c.name)}</span>
          ${c.official ? '<span class="pill on" style="height:20px">Officiel</span>' : ''}
          ${c.faculty ? `<span class="pill" style="height:20px">${esc(c.faculty)}</span>` : ''}
          ${c.unread ? `<span class="count">${c.unread > 99 ? '99+' : c.unread}</span>` : ''}
        </div>
        ${c.description ? `<div class="t-sm t-dim truncate">${esc(c.description)}</div>` : ''}
        <div class="t-xs t-dim2">${compact(c.members || 0)} membre${(c.members || 0) > 1 ? 's' : ''}${
          c.last_at ? ' · ' + timeAgo(c.last_at) : ''}</div>
      </div>
      <button class="btn ${c.joined ? 'btn-outline' : 'btn-primary'} btn-sm" data-join>
        ${c.joined ? 'Rejoint' : 'Rejoindre'}
      </button>
    </article>`;
}

async function renderChannels(q = '') {
  const host = $('#campusList');
  if (!host) return;
  host.innerHTML = loading();

  try {
    channels = await api.listChannels();
  } catch (err) { failed(host, err, () => renderChannels(q)); return; }

  const list = channels.filter(c =>
    !q || c.name.toLowerCase().includes(q) || (c.faculty || '').toLowerCase().includes(q));

  if (!list.length) {
    host.innerHTML = '';
    host.append(emptyState({
      icon: I.hash,
      title: q ? 'Aucun canal' : "Aucun canal pour l'instant",
      text: q ? 'Essayez un autre mot-clé.' : 'Créez le premier canal de votre faculté.',
      action: q ? null : { label: 'Créer un canal', onClick: openChannelComposer }
    }));
    return;
  }
  host.innerHTML = list.map(channelCard).join('');
}

/** The "Création de canal bientôt" placeholder, implemented. */
function openChannelComposer() {
  const name = el('input', { class: 'input', placeholder: 'Nom du canal', maxlength: '48' });
  const desc = el('textarea', { class: 'textarea', rows: '2', placeholder: 'De quoi parle-t-on ici ?', maxlength: '160' });
  const fac  = el('input', { class: 'input', value: me.get()?.faculty || '', placeholder: 'Faculté (facultatif)' });
  const foot = el('div', { class: 'row g2' });

  const m = modal({
    title: 'Créer un canal',
    body: el('div', { class: 'col g3' },
      el('div', { class: 'field' }, el('label', { class: 'label' }, 'Nom'), name),
      el('div', { class: 'field' }, el('label', { class: 'label' }, 'Description'), desc),
      el('div', { class: 'field' }, el('label', { class: 'label' }, 'Faculté'), fac)),
    footer: foot
  });

  foot.append(
    el('button', { class: 'btn btn-ghost', onclick: () => m.close() }, 'Annuler'),
    el('button', { class: 'btn btn-primary', onclick: async e => {
      const btn = e.currentTarget;
      if (name.value.trim().length < 3) { toast('Nom trop court', 'err'); return; }
      btn.disabled = true;
      try {
        await api.createChannel({
          name: name.value.trim(),
          description: desc.value.trim(),
          faculty: fac.value.trim() || null
        });
        m.close();
        toast('Canal créé', 'ok');
        renderChannels();
      } catch { btn.disabled = false; toast('Création échouée', 'err'); }
    }}, 'Créer')
  );
  setTimeout(() => name.focus(), 80);
}

/* ============================================================
   EVENTS
   ============================================================ */

let events = [];

function countdown(iso) {
  if (!iso) return 'Date à préciser';
  const ms = new Date(iso) - Date.now();
  if (ms < 0) return 'Terminé';
  const d = Math.floor(ms / 86400000);
  if (d >= 1) return `Dans ${d} jour${d > 1 ? 's' : ''}`;
  const h = Math.floor(ms / 3600000);
  if (h >= 1) return `Dans ${h} h`;
  return `Dans ${Math.max(1, Math.floor(ms / 60000))} min`;
}

/**
 * The hero from the original app, restored.
 * Gradient, 28px corners, the soft circle bleeding off the corner,
 * and the create button living inside it instead of in a toolbar.
 */
function eventsHero() {
  const upcoming = events.filter(e => !e.starts_at || new Date(e.starts_at) > Date.now()).length;
  const mine = events.filter(e => (e.going || []).includes(me.id)).length;
  return `
  <section class="events-hero">
    <div class="hero-body">
      <div class="hero-eyebrow">${icon('calendar', { size: 14 })} Campus</div>
      <h2 class="hero-title">Événements</h2>
      <p class="hero-sub">Révisions, conférences, sorties — tout ce qui se passe autour de vous.</p>
      <div class="hero-stats">
        <div class="hero-stat"><b>${upcoming}</b><span>à venir</span></div>
        <div class="hero-stat"><b>${mine}</b><span>vos inscriptions</span></div>
      </div>
    </div>
    <button class="hero-cta" id="heroCreateEvent">
      <span class="hero-cta-ic">${icon('plus', { size: 22 })}</span>
      <span class="hero-cta-txt">Créer un<br>événement</span>
    </button>
  </section>`;
}

function eventCard(e) {
  const going = (e.going || []).includes(me.id);
  const d = e.starts_at ? new Date(e.starts_at) : null;
  const owner = person(e.owner_id);
  return `<article class="ev" data-id="${esc(e.id)}">
      <div class="ev-date">
        <span class="ev-day">${d ? d.getDate() : '—'}</span>
        <span class="ev-mon">${d ? d.toLocaleDateString('fr', { month: 'short' }) : ''}</span>
      </div>
      <div class="grow" style="min-width:0">
        <div class="row g2" style="flex-wrap:wrap">
          <span class="t-bold">${esc(e.title)}</span>
          <span class="pill" style="height:20px">${countdown(e.starts_at)}</span>
        </div>
        <div class="t-sm t-dim">${esc(e.location || 'Lieu à préciser')}${
          d ? ' · ' + d.toLocaleTimeString('fr', { hour: '2-digit', minute: '2-digit' }) : ''}</div>
        ${e.description ? `<p class="t-sm" style="margin-top:6px">${esc(truncate(e.description, 110))}</p>` : ''}
        <div class="row g2" style="margin-top:var(--s2)">
          ${(e.going || []).length ? `<span class="av-stack">${e.going.slice(0, 3).map(id =>
            avatarChip(person(id), 'av xs')).join('')}</span>` : ''}
          <span class="t-xs t-dim">${(e.going || []).length} participant${(e.going || []).length > 1 ? 's' : ''}</span>
          <span class="t-xs t-dim2">· par ${esc(owner.full_name)}</span>
        </div>
      </div>
      <button class="btn ${going ? 'btn-outline' : 'btn-primary'} btn-sm" data-going>
        ${going ? 'Inscrit' : 'Je participe'}
      </button>
    </article>`;
}

async function renderEvents(q = '') {
  const host = $('#campusList');
  if (!host) return;
  host.innerHTML = eventsHero() + loading(2);

  try {
    events = await api.listEvents();
  } catch (err) { failed(host, err, () => renderEvents(q)); return; }

  const list = events
    .filter(e => !q || e.title.toLowerCase().includes(q) || (e.location || '').toLowerCase().includes(q))
    .sort((a, b) => new Date(a.starts_at || 0) - new Date(b.starts_at || 0));

  host.innerHTML = eventsHero() + (list.length
    ? list.map(eventCard).join('')
    : `<div class="tg-empty tall">${icon('calendar', { size: 26 })}
        <span>${q ? 'Aucun événement pour cette recherche' : "Rien de prévu pour l'instant"}</span></div>`);

  on($('#heroCreateEvent'), 'click', openEventComposer);
}

function openEventDetail(e) {
  const d = e.starts_at ? new Date(e.starts_at) : null;
  const owner = person(e.owner_id);
  const isMine = String(e.owner_id) === String(me.id);
  const foot = el('div', { class: 'row g2' });

  const m = modal({
    title: e.title,
    body: `<div class="col g3">
      ${e.cover_url ? `<div class="ev-cover"><img src="${esc(safeUrl(e.cover_url))}" alt=""></div>` : ''}
      <div class="row g3"><span class="tg-ic">${icon('calendar', { size: 16 })}</span>
        <div><div class="t-sm">${d ? d.toLocaleDateString('fr', { weekday: 'long', day: 'numeric', month: 'long' }) : 'Date à préciser'}</div>
        <div class="t-xs t-dim">${d ? d.toLocaleTimeString('fr', { hour: '2-digit', minute: '2-digit' }) + ' · ' : ''}${countdown(e.starts_at)}</div></div></div>
      <div class="row g3"><span class="tg-ic">${icon('compass', { size: 16 })}</span>
        <div class="t-sm">${esc(e.location || 'Lieu à préciser')}</div></div>
      <div class="row g3"><span class="tg-ic">${icon('user', { size: 16 })}</span>
        <div class="t-sm">Organisé par ${esc(owner.full_name)}</div></div>
      ${e.description ? `<p class="t-sm">${esc(e.description)}</p>` : ''}
      ${(e.going || []).length ? `<div><div class="t-xs t-dim" style="margin-bottom:6px">${e.going.length} participant${e.going.length > 1 ? 's' : ''}</div>
        <div class="av-stack">${e.going.slice(0, 8).map(id => avatarChip(person(id), 'av xs')).join('')}</div></div>` : ''}
    </div>`,
    footer: foot
  });

  if (isMine) {
    foot.append(el('button', { class: 'btn btn-ghost danger', onclick: async () => {
      if (!await confirmDialog({ title: "Supprimer l'événement ?", confirmLabel: 'Supprimer', danger: true })) return;
      try { await api.deleteEvent(e.id); m.close(); toast('Événement supprimé', 'ok'); renderEvents(); }
      catch { toast('Suppression échouée', 'err'); }
    }}, 'Supprimer'));
  }
  foot.append(el('button', { class: 'btn btn-primary', onclick: () => m.close() }, 'Fermer'));
}

function openEventComposer() {
  const title = el('input', { class: 'input', placeholder: "Titre de l'événement", maxlength: '80' });
  const place = el('input', { class: 'input', placeholder: 'Lieu (amphi, salle, adresse…)' });
  const when  = el('input', { class: 'input', type: 'datetime-local' });
  const desc  = el('textarea', { class: 'textarea', rows: '3', placeholder: 'Détails…', maxlength: '400' });
  const foot  = el('div', { class: 'row g2' });

  const m = modal({
    title: 'Créer un événement',
    body: el('div', { class: 'col g3' },
      el('div', { class: 'field' }, el('label', { class: 'label' }, 'Titre'), title),
      el('div', { class: 'field' }, el('label', { class: 'label' }, 'Lieu'), place),
      el('div', { class: 'field' }, el('label', { class: 'label' }, 'Date et heure'), when),
      el('div', { class: 'field' }, el('label', { class: 'label' }, 'Description'), desc)),
    footer: foot
  });

  foot.append(
    el('button', { class: 'btn btn-ghost', onclick: () => m.close() }, 'Annuler'),
    el('button', { class: 'btn btn-primary', onclick: async e => {
      const btn = e.currentTarget;
      if (!title.value.trim() || !when.value) { toast('Titre et date obligatoires', 'err'); return; }
      btn.disabled = true;
      btn.textContent = 'Création…';
      try {
        const created = await api.createEvent({
          title: title.value.trim(),
          location: place.value.trim() || null,
          starts_at: new Date(when.value).toISOString(),
          description: desc.value.trim()
        });
        act('event_create', created?.id);
        m.close();
        toast('Événement créé', 'ok');
        renderEvents();
      } catch {
        btn.disabled = false;
        btn.textContent = 'Créer';
        toast("Création échouée — rien n'a été enregistré", 'err');
      }
    }}, 'Créer')
  );
  setTimeout(() => title.focus(), 80);
}

/* ============================================================
   Q&A
   ============================================================ */

let questions = [];

function qaHero() {
  const open = questions.filter(q => !(q.answers || []).length).length;
  return `
  <section class="qa-hero">
    <div class="hero-body">
      <div class="hero-eyebrow">${icon('help', { size: 14 })} Entraide</div>
      <h2 class="hero-title">Questions &amp; Réponses</h2>
      <p class="hero-sub">Demandez ce que vous n'osez pas demander en amphi. Anonymement si vous préférez.</p>
      <div class="hero-stats">
        <div class="hero-stat"><b>${questions.length}</b><span>questions</span></div>
        <div class="hero-stat"><b>${open}</b><span>sans réponse</span></div>
      </div>
    </div>
    <button class="hero-cta" id="heroAsk">
      <span class="hero-cta-ic">${icon('plus', { size: 22 })}</span>
      <span class="hero-cta-txt">Poser une<br>question</span>
    </button>
  </section>`;
}

function questionCard(q) {
  const author = q.anonymous ? null : person(q.user_id);
  const best = [...(q.answers || [])].sort((a, b) => b.votes - a.votes)[0];
  return `<article class="qa" data-id="${esc(q.id)}">
      <div class="row g3">
        ${q.anonymous
          ? `<span class="av sm" style="background:var(--text-3)">${icon('user', { size: 15 })}</span>`
          : avatarChip(author)}
        <div class="grow" style="min-width:0">
          <div class="row g2">
            <span class="t-sm t-bold">${q.anonymous ? 'Anonyme' : esc(author.full_name)}</span>
            <span class="t-xs t-dim">${timeAgo(q.created_at)}</span>
            ${q.faculty ? `<span class="pill" style="height:19px">${esc(q.faculty)}</span>` : ''}
          </div>
          <p class="t-md" style="margin-top:4px">${esc(q.text)}</p>
        </div>
      </div>
      ${best ? `<div class="qa-best">
          <span class="qa-badge">${icon('check', { size: 12 })} Meilleure réponse</span>
          <p class="t-sm">${esc(truncate(best.text, 120))}</p>
        </div>` : ''}
      <div class="row g3" style="margin-top:var(--s2)">
        <button class="act" data-open-q>${I.comment}<span class="c">${(q.answers || []).length}</span></button>
        <span class="t-xs t-dim">${(q.answers || []).length ? 'Voir les réponses' : 'Soyez le premier à répondre'}</span>
      </div>
    </article>`;
}

async function renderQA(query = '') {
  const host = $('#campusList');
  if (!host) return;
  host.innerHTML = qaHero() + loading(2);

  try {
    questions = await api.listQuestions();
  } catch (err) { failed(host, err, () => renderQA(query)); return; }

  const list = questions.filter(q => !query || q.text.toLowerCase().includes(query));

  host.innerHTML = qaHero() + (list.length
    ? list.map(questionCard).join('')
    : `<div class="tg-empty tall">${icon('help', { size: 26 })}
        <span>${query ? 'Aucune question pour cette recherche' : 'Aucune question — posez la vôtre'}</span></div>`);

  on($('#heroAsk'), 'click', openAsk);
}

function openQuestion(q) {
  const list = el('div', { class: 'col g3' });

  const draw = () => {
    const sorted = [...(q.answers || [])].sort((a, b) => b.votes - a.votes);
    list.innerHTML = sorted.length ? sorted.map((a, i) => {
      const u = a.anonymous ? null : person(a.user_id);
      return `<div class="qa-ans${i === 0 ? ' best' : ''}" data-a="${esc(a.id)}">
          <div class="qa-vote">
            <button class="icon-btn sm${a.myVote ? ' on' : ''}" data-up aria-label="Voter">${icon('arrowDown', { size: 15 })}</button>
            <span class="t-sm t-bold t-mono">${a.votes}</span>
          </div>
          <div class="grow" style="min-width:0">
            <div class="row g2"><span class="t-sm t-bold">${a.anonymous ? 'Anonyme' : esc(u.full_name)}</span>
            <span class="t-xs t-dim">${timeAgo(a.created_at)}</span>
            ${i === 0 ? `<span class="qa-badge">${icon('check', { size: 11 })} Meilleure</span>` : ''}</div>
            <p class="t-sm">${esc(a.text)}</p>
          </div>
        </div>`;
    }).join('') : `<div class="tg-empty">${icon('comment', { size: 22 })}<span>Aucune réponse</span></div>`;
  };
  draw();

  const input = el('input', { class: 'input', placeholder: 'Votre réponse…' });
  const btn = el('button', { class: 'btn btn-primary', onclick: () => add() }, 'Répondre');

  async function add() {
    const text = input.value.trim();
    if (!text) return;
    btn.disabled = true;
    try {
      const saved = await api.answer(q.id, text);
      act('answer', saved?.id);
      q.answers = [...(q.answers || []), saved];
      input.value = '';
      draw();
      renderQA();
    } catch { toast('Réponse non enregistrée', 'err'); }
    finally { btn.disabled = false; input.focus(); }
  }
  on(input, 'keydown', e => { if (e.key === 'Enter') add(); });

  on(list, 'click', async e => {
    if (!e.target.closest('[data-up]')) return;
    const id = e.target.closest('[data-a]').dataset.a;
    const a = (q.answers || []).find(x => String(x.id) === String(id));
    if (!a) return;
    const was = a.myVote;
    a.myVote = !was;
    a.votes += was ? -1 : 1;
    draw();
    try { await api.voteAnswer(a.id, !was); }
    catch { a.myVote = was; a.votes += was ? 1 : -1; draw(); toast('Vote non enregistré', 'err'); }
  });

  modal({
    title: q.anonymous ? 'Question anonyme' : 'Question',
    body: el('div', { class: 'col g4' },
      el('p', { class: 't-md' }, q.text),
      el('div', { class: 'hr' }),
      list,
      el('div', { class: 'row g2' }, input, btn))
  });
}

function openAsk() {
  const ta = el('textarea', { class: 'textarea', rows: '4', placeholder: 'Votre question…', maxlength: '400' });
  const anon = el('div', { class: 'switch on', role: 'switch', tabindex: '0', 'aria-checked': 'true' });
  on(anon, 'click', () => {
    anon.classList.toggle('on');
    anon.setAttribute('aria-checked', String(anon.classList.contains('on')));
  });
  const foot = el('div', { class: 'row g2' });

  const m = modal({
    title: 'Poser une question',
    body: el('div', { class: 'col g4' }, ta,
      el('div', { class: 'row between' },
        el('div', {},
          el('div', { class: 't-sm t-bold' }, 'Rester anonyme'),
          el('div', { class: 't-xs t-dim' }, 'Votre nom ne quittera jamais le serveur')),
        anon)),
    footer: foot
  });

  foot.append(
    el('button', { class: 'btn btn-ghost', onclick: () => m.close() }, 'Annuler'),
    el('button', { class: 'btn btn-primary', onclick: async e => {
      const btn = e.currentTarget;
      const text = ta.value.trim();
      if (text.length < 5) { toast('Écrivez votre question', 'err'); return; }
      btn.disabled = true;
      try {
        await api.ask({ text, anonymous: anon.classList.contains('on') });
        m.close();
        toast('Question publiée', 'ok');
        renderQA();
      } catch { btn.disabled = false; toast('Publication échouée', 'err'); }
    }}, 'Publier')
  );
  setTimeout(() => ta.focus(), 80);
}

/* ============================================================
   EXPLORE
   ============================================================ */

async function renderExplore(q = '') {
  const host = $('#campusList');
  if (!host) return;
  host.innerHTML = loading(3);

  if (q) {
    let people = [], posts = [];
    try {
      [people, posts] = await Promise.all([api.searchPeople(q), api.searchPosts(q)]);
    } catch (err) { failed(host, err, () => renderExplore(q)); return; }

    if (!people.length && !posts.length) {
      host.innerHTML = '';
      host.append(emptyState({ icon: I.search, title: 'Aucun résultat', text: `Rien pour « ${q} ».` }));
      return;
    }

    host.innerHTML = `
      ${people.length ? `<div class="hub-sec-head" style="margin:var(--s3) 0">Personnes · ${people.length}</div>` +
        people.map(u => `<div class="cc">
            ${avatarChip(u, 'av')}
            <div class="grow" style="min-width:0"><div class="t-bold truncate">${esc(u.full_name)}</div>
            <div class="t-sm t-dim">@${esc(u.username)} · ${esc(u.faculty || '')}</div></div>
            <div class="row g1">
              ${u.is_private === false || u.i_follow !== false
                ? `<button class="icon-btn sm" data-msg="${esc(u.id)}" data-tip="Message">${icon('message', { size: 15 })}</button>` : ''}
              <a class="btn btn-outline btn-sm" href="#/profile/${esc(u.username)}">Voir</a>
            </div>
          </div>`).join('') : ''}
      ${posts.length ? `<div class="hub-sec-head" style="margin:var(--s4) 0 var(--s3)">Publications · ${posts.length}</div>` +
        posts.map(p => {
          const a = p.anonymous ? { full_name: 'Anonyme', id: 'anon' } : person(p.user_id);
          return `<article class="cc">
            ${p.anonymous ? `<span class="av" style="background:var(--text-3)">${icon('user', { size: 16 })}</span>` : avatarChip(a, 'av')}
            <div class="grow" style="min-width:0">
              <div class="row g2"><span class="t-bold">${esc(a.full_name)}</span>
              <span class="t-xs t-dim">${timeAgo(p.created_at)}</span></div>
              <div class="t-sm t-dim">${esc(truncate(p.text || '', 120))}</div>
            </div></article>`;
        }).join('') : ''}`;
    return;
  }

  let trends = [], suggestions = [];
  try {
    [trends, suggestions] = await Promise.all([api.trends(), api.searchPeople('')]);
  } catch (err) { failed(host, err, () => renderExplore()); return; }

  host.innerHTML = `
    ${trends.length ? `<section class="hub-sec">
      <div class="hub-sec-head"><span>Tendances</span></div>
      ${trends.map((t, i) => `<a class="trend" href="#/explore?tag=${esc(t.tag)}">
          <span class="trend-rank">${i + 1}</span>
          <div class="grow"><div class="t-bold">#${esc(t.tag)}</div>
          <div class="t-xs t-dim">${t.posts} publication${t.posts > 1 ? 's' : ''}</div></div>
          ${icon('chevron', { size: 16 })}
        </a>`).join('')}
    </section>` : ''}
    <section class="hub-sec">
      <div class="hub-sec-head"><span>Étudiants à découvrir</span></div>
      ${suggestions.length
        ? suggestions.slice(0, 12).map(u => {
            const badge = rankBadge(u.rank);
            return `<div class="cc${badge ? ' featured' : ''}">
              ${avatarChip(u, 'av')}
              <div class="grow" style="min-width:0">
                <div class="row g2" style="flex-wrap:wrap">
                  <span class="t-bold truncate">${esc(u.full_name)}</span>
                  ${badge ? `<span class="rank-badge ${badge.tone}">${icon(badge.icon, { size: 11 })} ${esc(badge.label)}</span>` : ''}
                </div>
                <div class="t-sm t-dim">${esc(u.faculty || '')} · ${compact(u.xp || 0)} XP</div>
              </div>
              <div class="row g1">
                <button class="icon-btn sm" data-msg="${esc(u.id)}" data-tip="Message">${icon('message', { size: 15 })}</button>
                <a class="btn btn-outline btn-sm" href="#/profile/${esc(u.username)}">Voir</a>
              </div>
            </div>`;
          }).join('')
        : `<div class="tg-empty">${icon('user', { size: 22 })}<span>Personne à afficher</span></div>`}
    </section>`;
}

/* ============================================================
   SAVED
   ============================================================ */

async function renderSaved() {
  const host = $('#campusList');
  if (!host) return;
  host.innerHTML = loading(2);

  let posts = [];
  try { posts = await api.listSaved(); }
  catch (err) { failed(host, err, renderSaved); return; }

  if (!posts.length) {
    host.innerHTML = '';
    host.append(emptyState({
      icon: I.bookmark,
      title: "Rien d'enregistré",
      text: 'Les publications que vous enregistrez apparaîtront ici.',
      action: { label: 'Parcourir le fil', onClick: () => go('feed') }
    }));
    return;
  }

  host.innerHTML = posts.map(p => {
    const a = p.anonymous ? { full_name: 'Anonyme', id: 'anon' } : person(p.user_id);
    const src = p.image_url || (p.media_type === 'image' ? p.media_url : null);
    return `<article class="post" data-id="${esc(p.id)}">
      <div class="post-head">
        ${p.anonymous ? `<div class="av" style="background:var(--text-3)">${icon('user', { size: 18 })}</div>` : avatarChip(a, 'av')}
        <div class="grow" style="min-width:0">
          <div class="row g2"><span class="post-name">${esc(a.full_name)}</span>
          <span class="post-time">${timeAgo(p.created_at)}</span></div>
        </div>
      </div>
      ${p.text ? `<div class="post-text">${richText(p.text)}</div>` : ''}
      ${src ? `<div class="post-media"><img src="${esc(safeUrl(src))}" alt="" loading="lazy"></div>` : ''}
    </article>`;
  }).join('');
}

/* ============================================================
   SHELL
   ============================================================ */

const SCREENS = {
  channels: { title: 'Canaux',      placeholder: 'Rechercher un canal…',      render: renderChannels,
              action: { label: 'Créer', icon: 'plus', fn: openChannelComposer } },
  events:   { title: 'Événements',  placeholder: 'Rechercher un événement…',  render: renderEvents },
  qa:       { title: 'Questions',   placeholder: 'Rechercher une question…',  render: renderQA },
  explore:  { title: 'Explorer',    placeholder: 'Rechercher étudiants, sujets…', render: renderExplore },
  saved:    { title: 'Enregistrés', placeholder: null,                        render: renderSaved }
};

function mountScreen(name, mountFn) {
  const cfg = SCREENS[name];
  const host = mountFn();
  if (!host || !cfg) return;
  host.closest('.view')?.classList.remove('full');

  // Screens with a hero carry their create button inside it, so the
  // toolbar above stays a search field and nothing else.
  host.innerHTML = `
    ${cfg.placeholder ? `<div class="campus-bar">
      <div class="grow" style="position:relative">
        <span class="input-icon">${icon('search', { size: 15 })}</span>
        <input class="input has-icon" id="campusSearch" placeholder="${esc(cfg.placeholder)}">
      </div>
      ${cfg.action ? `<button class="btn btn-primary btn-sm" id="campusAction">
        ${icon(cfg.action.icon, { size: 15 })} ${cfg.action.label}</button>` : ''}
    </div>` : ''}
    <div id="campusList"></div>`;

  if (cfg.action) on($('#campusAction'), 'click', cfg.action.fn);

  const search = $('#campusSearch');
  if (search) on(search, 'input', debounce(() => cfg.render(search.value.trim().toLowerCase()), 250));

  // One delegated listener per screen, bound once. The previous
  // version used { once: true } inside render(), so the second render
  // silently lost every click — which is why buttons stopped working
  // after a search.
  on($('#campusList'), 'click', e => handleListClick(name, e));

  cfg.render();
}

async function handleListClick(screen, e) {
  // Message button, available from discovery and search alike.
  const msg = e.target.closest('[data-msg]');
  if (msg) { e.preventDefault(); go('messages', msg.dataset.msg); return; }

  if (screen === 'channels') {
    const card = e.target.closest('.cc');
    if (!card) return;
    const c = channels.find(x => String(x.id) === card.dataset.id);
    if (!c) return;
    if (e.target.closest('[data-join]')) {
      const was = c.joined;
      c.joined = !was;
      c.members = Math.max(0, (c.members || 0) + (was ? -1 : 1));
      card.replaceWith(el('div', { html: channelCard(c) }).firstElementChild);
      try { await api.joinChannel(c.id, !was); toast(was ? `Vous avez quitté ${c.name}` : `Bienvenue dans ${c.name}`, 'ok'); }
      catch { c.joined = was; renderChannels(); toast('Action échouée', 'err'); }
      return;
    }
    toast(`Le canal « ${c.name} » s'ouvrira avec la messagerie de groupe`);
    return;
  }

  if (screen === 'events') {
    const card = e.target.closest('.ev');
    if (!card) return;
    const ev = events.find(x => String(x.id) === card.dataset.id);
    if (!ev) return;
    if (e.target.closest('[data-going]')) {
      const was = (ev.going || []).includes(me.id);
      ev.going = was ? ev.going.filter(x => x !== me.id) : [...(ev.going || []), me.id];
      card.replaceWith(el('div', { html: eventCard(ev) }).firstElementChild);
      try {
        await api.attend(ev.id, !was);
        if (!was) act('event_join', ev.id);
        toast(was ? 'Inscription annulée' : 'Vous participez', 'ok');
      }
      catch {
        ev.going = was ? [...ev.going, me.id] : ev.going.filter(x => x !== me.id);
        renderEvents();
        toast('Action échouée', 'err');
      }
      return;
    }
    openEventDetail(ev);
    return;
  }

  if (screen === 'qa') {
    const card = e.target.closest('.qa');
    if (!card) return;
    const q = questions.find(x => String(x.id) === card.dataset.id);
    if (q) openQuestion(q);
  }
}

export function initCampus(mountFn) {
  for (const name of Object.keys(SCREENS)) {
    route(name, () => mountScreen(name, mountFn));
  }
}

export { openAsk, openEventComposer, openChannelComposer };
