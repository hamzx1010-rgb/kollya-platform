/**
 * KOLIYA — features/campus_sm.js
 * ============================================================
 * Channels, events, Q&A, explore and saved.
 *
 * These four share one shape — a searchable list of cards — so they
 * share one module rather than four near-identical files.
 *
 * Q&A keeps the anonymity guarantee from the original app: an
 * anonymous question never carries its author to the client.
 * ============================================================
 */

import {
  $, $$, el, on, esc, richText, timeAgo, compact, initials, avatarColor,
  debounce, uid, truncate, safeUrl
} from '../core/utils_sm.js';
import { me, scoped, frequency } from '../core/store_sm.js';
import { I, icon } from '../core/icons_sm.js';
import {
  toast, modal, contextMenu, confirmDialog, emptyState, skeletonList, optimistic
} from '../core/ui_sm.js';
import { route, go } from '../core/router_sm.js';

let api = null;
export function useApi(impl) { api = impl; }

const store = scoped('campus');

const PEOPLE = {
  u2:{ id:'u2', full_name:'Youssef Kader', username:'youssef', faculty:'Physique' },
  u3:{ id:'u3', full_name:'Leila Mansouri', username:'leila', faculty:'Biologie' },
  u4:{ id:'u4', full_name:'Omar Kaci', username:'omar.k', faculty:'Maths' },
  u5:{ id:'u5', full_name:'Amina Zerrouki', username:'amina.z', faculty:'Informatique' }
};
const person = id => PEOPLE[id] || { id, full_name:'Étudiant', username:'?' };

/* ============================================================
   CHANNELS
   ============================================================ */

const CHANNELS = [
  { id:'c1', name:'Informatique L3', faculty:'Informatique', members:128, unread:3,
    last:'Le TP est reporté à vendredi', at:new Date(Date.now()-25*60000).toISOString() },
  { id:'c2', name:'Annonces officielles', faculty:null, members:1240, unread:0, official:true,
    last:'Fermeture de la biblio pendant les partiels', at:new Date(Date.now()-4*3600000).toISOString() },
  { id:'c3', name:'Physique — révisions', faculty:'Physique', members:64, unread:0,
    last:'Quelqu\'un a le poly du chapitre 5 ?', at:new Date(Date.now()-9*3600000).toISOString() },
  { id:'c4', name:'Petites annonces', faculty:null, members:302, unread:12,
    last:'Vends calculatrice scientifique', at:new Date(Date.now()-30*3600000).toISOString() }
];

const joined = () => store.get('joined', ['c1', 'c2']);
const setJoined = list => store.set('joined', list);

function channelCard(c) {
  const isIn = joined().includes(c.id);
  return `<article class="cc" data-id="${c.id}">
      <div class="cc-ic" style="background:${avatarColor(c.id)}">${icon(c.official ? 'globe' : 'hash', { size: 18 })}</div>
      <div class="grow" style="min-width:0">
        <div class="row g2" style="flex-wrap:wrap">
          <span class="t-bold">${esc(c.name)}</span>
          ${c.official ? '<span class="pill on" style="height:20px">Officiel</span>' : ''}
          ${c.unread ? `<span class="count">${c.unread}</span>` : ''}
        </div>
        <div class="t-sm t-dim truncate">${esc(c.last)}</div>
        <div class="t-xs t-dim2">${compact(c.members)} membres · ${timeAgo(c.at)}</div>
      </div>
      <button class="btn ${isIn ? 'btn-outline' : 'btn-primary'} btn-sm" data-join>
        ${isIn ? 'Rejoint' : 'Rejoindre'}
      </button>
    </article>`;
}

function renderChannels(q = '') {
  const host = $('#campusList');
  if (!host) return;
  const list = CHANNELS.filter(c =>
    !q || c.name.toLowerCase().includes(q) || (c.faculty || '').toLowerCase().includes(q));

  if (!list.length) {
    host.innerHTML = '';
    host.append(emptyState({ icon: I.hash, title: 'Aucun canal', text: 'Essayez un autre mot-clé.' }));
    return;
  }
  host.innerHTML = list.map(channelCard).join('');

  on(host, 'click', e => {
    const card = e.target.closest('.cc');
    if (!card) return;
    const c = CHANNELS.find(x => x.id === card.dataset.id);
    if (e.target.closest('[data-join]')) {
      const list = joined();
      const isIn = list.includes(c.id);
      setJoined(isIn ? list.filter(x => x !== c.id) : [...list, c.id]);
      renderChannels(q);
      toast(isIn ? `Vous avez quitté ${c.name}` : `Bienvenue dans ${c.name}`, 'ok');
      return;
    }
    toast(`Le canal « ${c.name} » s'ouvrira avec la messagerie de groupe`);
  }, { once: true });
}

/* ============================================================
   EVENTS
   ============================================================ */

const EVENTS = [
  { id:'e1', owner:'u4', title:'Révision Algo — série 4', faculty:'Informatique',
    place:'Salle B12', starts:new Date(Date.now()+22*3600000).toISOString(),
    desc:'On reprend le tri fusion et les complexités. Apportez vos TD.',
    going:['u2','u5'] },
  { id:'e2', owner:'u2', title:'Conférence : physique quantique', faculty:'Physique',
    place:'Amphi A', starts:new Date(Date.now()+3*86400000).toISOString(),
    desc:'Intervenant invité de l\'USTHB.', going:['u3'] },
  { id:'e3', owner:'u3', title:'Sortie terrain — écologie', faculty:'Biologie',
    place:'Départ parking nord', starts:new Date(Date.now()+8*86400000).toISOString(),
    desc:'Prévoir chaussures de marche.', going:[] }
];

function countdown(iso) {
  const ms = new Date(iso) - Date.now();
  if (ms < 0) return 'Terminé';
  const d = Math.floor(ms / 86400000);
  if (d >= 1) return `Dans ${d} jour${d > 1 ? 's' : ''}`;
  const h = Math.floor(ms / 3600000);
  if (h >= 1) return `Dans ${h} h`;
  return `Dans ${Math.max(1, Math.floor(ms / 60000))} min`;
}

function eventCard(e) {
  const going = e.going.includes(me.id);
  const d = new Date(e.starts);
  return `<article class="ev" data-id="${e.id}">
      <div class="ev-date">
        <span class="ev-day">${d.getDate()}</span>
        <span class="ev-mon">${d.toLocaleDateString('fr', { month:'short' })}</span>
      </div>
      <div class="grow" style="min-width:0">
        <div class="row g2" style="flex-wrap:wrap">
          <span class="t-bold">${esc(e.title)}</span>
          <span class="pill" style="height:20px">${countdown(e.starts)}</span>
        </div>
        <div class="t-sm t-dim">${esc(e.place)} · ${d.toLocaleTimeString('fr', { hour:'2-digit', minute:'2-digit' })}</div>
        <p class="t-sm" style="margin-top:6px">${esc(truncate(e.desc, 110))}</p>
        <div class="row g2" style="margin-top:var(--s2)">
          ${e.going.length ? `<span class="av-stack">${e.going.slice(0,3).map(id => {
            const u = person(id);
            return `<span class="av xs" style="background:${avatarColor(id)}">${esc(initials(u.full_name))}</span>`;
          }).join('')}</span>` : ''}
          <span class="t-xs t-dim">${e.going.length} participant${e.going.length > 1 ? 's' : ''}</span>
        </div>
      </div>
      <button class="btn ${going ? 'btn-outline' : 'btn-primary'} btn-sm" data-going>
        ${going ? 'Inscrit' : 'Je participe'}
      </button>
    </article>`;
}

function renderEvents(q = '') {
  const host = $('#campusList');
  if (!host) return;
  const list = EVENTS
    .filter(e => !q || e.title.toLowerCase().includes(q) || e.place.toLowerCase().includes(q))
    .sort((a, b) => new Date(a.starts) - new Date(b.starts));

  if (!list.length) {
    host.innerHTML = '';
    host.append(emptyState({
      icon: I.calendar, title: 'Aucun événement',
      text: 'Rien de prévu pour l\'instant.',
      action: { label: 'Créer un événement', onClick: openEventComposer }
    }));
    return;
  }
  host.innerHTML = list.map(eventCard).join('');

  on(host, 'click', e => {
    const card = e.target.closest('.ev');
    if (!card) return;
    const ev = EVENTS.find(x => x.id === card.dataset.id);
    if (e.target.closest('[data-going]')) {
      const going = ev.going.includes(me.id);
      ev.going = going ? ev.going.filter(x => x !== me.id) : [...ev.going, me.id];
      renderEvents(q);
      toast(going ? 'Inscription annulée' : 'Vous participez', 'ok');
      return;
    }
    openEventDetail(ev);
  }, { once: true });
}

function openEventDetail(e) {
  const d = new Date(e.starts);
  modal({
    title: e.title,
    body: `<div class="col g3">
      <div class="row g3"><span class="tg-ic">${icon('calendar',{size:16})}</span>
        <div><div class="t-sm">${d.toLocaleDateString('fr',{weekday:'long',day:'numeric',month:'long'})}</div>
        <div class="t-xs t-dim">${d.toLocaleTimeString('fr',{hour:'2-digit',minute:'2-digit'})} · ${countdown(e.starts)}</div></div></div>
      <div class="row g3"><span class="tg-ic">${icon('compass',{size:16})}</span>
        <div class="t-sm">${esc(e.place)}</div></div>
      <div class="row g3"><span class="tg-ic">${icon('user',{size:16})}</span>
        <div class="t-sm">Organisé par ${esc(person(e.owner).full_name)}</div></div>
      <p class="t-sm">${esc(e.desc)}</p>
    </div>`
  });
}

function openEventComposer() {
  const title = el('input', { class:'input', placeholder:'Titre de l\'événement' });
  const place = el('input', { class:'input', placeholder:'Lieu' });
  const when  = el('input', { class:'input', type:'datetime-local' });
  const desc  = el('textarea', { class:'textarea', rows:'3', placeholder:'Détails…' });
  const foot  = el('div', { class:'row g2' });

  const m = modal({
    title: 'Créer un événement',
    body: el('div', { class:'col g3' }, title, place, when, desc),
    footer: foot
  });
  foot.append(
    el('button', { class:'btn btn-ghost', onclick:() => m.close() }, 'Annuler'),
    el('button', { class:'btn btn-primary', onclick:() => {
      if (!title.value.trim() || !when.value) { toast('Titre et date obligatoires', 'err'); return; }
      EVENTS.push({ id:uid('e'), owner:me.id, title:title.value.trim(),
        place:place.value.trim() || 'À préciser', starts:new Date(when.value).toISOString(),
        desc:desc.value.trim(), going:[me.id], faculty:me.get()?.faculty });
      m.close(); renderEvents(); toast('Événement créé', 'ok');
    }}, 'Créer')
  );
}

/* ============================================================
   Q&A
   ============================================================ */

const QUESTIONS = [
  { id:'q1', anonymous:true, user_id:null, text:'Comment gérez-vous le stress avant les partiels ? Je n\'arrive plus à dormir.',
    at:new Date(Date.now()-3*3600000).toISOString(),
    answers:[
      { id:'a1', user_id:'u3', text:'Planifier des pauses vraiment fixes m\'a beaucoup aidée.', votes:7, at:new Date(Date.now()-2*3600000).toISOString() },
      { id:'a2', user_id:'u2', text:'Sport le matin, révision l\'après-midi. Sérieusement.', votes:3, at:new Date(Date.now()-1*3600000).toISOString() }
    ]},
  { id:'q2', anonymous:false, user_id:'u4', text:'Quelqu\'un connaît un bon livre pour l\'analyse numérique ?',
    at:new Date(Date.now()-20*3600000).toISOString(), answers:[] }
];

function questionCard(q) {
  const author = q.anonymous ? null : person(q.user_id);
  const best = [...q.answers].sort((a, b) => b.votes - a.votes)[0];
  return `<article class="qa" data-id="${q.id}">
      <div class="row g3">
        <span class="av sm" style="background:${q.anonymous ? 'var(--text-3)' : avatarColor(q.user_id)}">
          ${q.anonymous ? icon('user', { size: 15 }) : esc(initials(author.full_name))}
        </span>
        <div class="grow" style="min-width:0">
          <div class="row g2">
            <span class="t-sm t-bold">${q.anonymous ? 'Anonyme' : esc(author.full_name)}</span>
            <span class="t-xs t-dim">${timeAgo(q.at)}</span>
          </div>
          <p class="t-md" style="margin-top:4px">${esc(q.text)}</p>
        </div>
      </div>
      ${best ? `<div class="qa-best">
          <span class="qa-badge">${icon('check', { size: 12 })} Meilleure réponse</span>
          <p class="t-sm">${esc(truncate(best.text, 120))}</p>
        </div>` : ''}
      <div class="row g3" style="margin-top:var(--s2)">
        <button class="act" data-open-q>${I.comment}<span class="c">${q.answers.length}</span></button>
        <span class="t-xs t-dim">${q.answers.length ? 'Voir les réponses' : 'Soyez le premier à répondre'}</span>
      </div>
    </article>`;
}

function renderQA(query = '') {
  const host = $('#campusList');
  if (!host) return;
  const list = QUESTIONS.filter(q => !query || q.text.toLowerCase().includes(query));

  if (!list.length) {
    host.innerHTML = '';
    host.append(emptyState({
      icon: I.help, title: 'Aucune question',
      text: 'Posez la vôtre, anonymement si vous préférez.',
      action: { label: 'Poser une question', onClick: openAsk }
    }));
    return;
  }
  host.innerHTML = list.map(questionCard).join('');

  on(host, 'click', e => {
    const card = e.target.closest('.qa');
    if (!card) return;
    openQuestion(QUESTIONS.find(x => x.id === card.dataset.id));
  }, { once: true });
}

function openQuestion(q) {
  const list = el('div', { class:'col g3' });
  const draw = () => {
    const sorted = [...q.answers].sort((a, b) => b.votes - a.votes);
    list.innerHTML = sorted.length ? sorted.map((a, i) => {
      const u = person(a.user_id);
      return `<div class="qa-ans${i === 0 ? ' best' : ''}" data-a="${a.id}">
          <div class="qa-vote">
            <button class="icon-btn sm" data-up>${icon('arrowDown',{size:15})}</button>
            <span class="t-sm t-bold t-mono">${a.votes}</span>
          </div>
          <div class="grow" style="min-width:0">
            <div class="row g2"><span class="t-sm t-bold">${esc(u.full_name)}</span>
            <span class="t-xs t-dim">${timeAgo(a.at)}</span>
            ${i === 0 ? `<span class="qa-badge">${icon('check',{size:11})} Meilleure</span>` : ''}</div>
            <p class="t-sm">${esc(a.text)}</p>
          </div>
        </div>`;
    }).join('') : `<div class="tg-empty">${icon('comment',{size:22})}<span>Aucune réponse</span></div>`;
  };
  draw();

  const input = el('input', { class:'input', placeholder:'Votre réponse…' });
  const add = () => {
    const text = input.value.trim();
    if (!text) return;
    q.answers.push({ id:uid('a'), user_id:me.id, text, votes:0, at:new Date().toISOString() });
    input.value = '';
    draw(); renderQA();
  };
  on(input, 'keydown', e => { if (e.key === 'Enter') add(); });

  on(list, 'click', e => {
    if (!e.target.closest('[data-up]')) return;
    const id = e.target.closest('[data-a]').dataset.a;
    const a = q.answers.find(x => x.id === id);
    if (a) { a.votes++; draw(); }
  });

  modal({
    title: q.anonymous ? 'Question anonyme' : 'Question',
    body: el('div', { class:'col g4' },
      el('p', { class:'t-md' }, q.text),
      el('div', { class:'hr' }),
      list,
      el('div', { class:'row g2' }, input, el('button', { class:'btn btn-primary', onclick:add }, 'Répondre'))
    )
  });
}

function openAsk() {
  const ta = el('textarea', { class:'textarea', rows:'4', placeholder:'Votre question…' });
  const anon = el('div', { class:'switch on' });
  on(anon, 'click', () => anon.classList.toggle('on'));
  const foot = el('div', { class:'row g2' });

  const m = modal({
    title: 'Poser une question',
    body: el('div', { class:'col g4' }, ta,
      el('div', { class:'row between' },
        el('div', {},
          el('div', { class:'t-sm t-bold' }, 'Rester anonyme'),
          el('div', { class:'t-xs t-dim' }, 'Votre nom ne sera jamais affiché')),
        anon)),
    footer: foot
  });
  foot.append(
    el('button', { class:'btn btn-ghost', onclick:() => m.close() }, 'Annuler'),
    el('button', { class:'btn btn-primary', onclick:() => {
      const text = ta.value.trim();
      if (!text) { toast('Écrivez votre question', 'err'); return; }
      const anonymous = anon.classList.contains('on');
      QUESTIONS.unshift({ id:uid('q'), anonymous,
        user_id: anonymous ? null : me.id, text, at:new Date().toISOString(), answers:[] });
      m.close(); renderQA(); toast('Question publiée', 'ok');
    }}, 'Publier')
  );
}

/* ============================================================
   EXPLORE
   ============================================================ */

const TRENDS = [
  { tag:'algo', posts:42 }, { tag:'partiels', posts:38 }, { tag:'biblio', posts:21 },
  { tag:'stage', posts:17 }, { tag:'bourse', posts:12 }
];

function renderExplore(q = '') {
  const host = $('#campusList');
  if (!host) return;

  if (q) {
    const people = Object.values(PEOPLE).filter(u =>
      u.full_name.toLowerCase().includes(q) || u.username.includes(q));
    host.innerHTML = people.length
      ? `<div class="hub-sec-head" style="margin:var(--s3) 0">Personnes</div>` +
        people.map(u => `<div class="cc">
            <span class="av" style="background:${avatarColor(u.id)}">${esc(initials(u.full_name))}</span>
            <div class="grow"><div class="t-bold">${esc(u.full_name)}</div>
            <div class="t-sm t-dim">@${esc(u.username)} · ${esc(u.faculty)}</div></div>
            <a class="btn btn-outline btn-sm" href="#/profile/${esc(u.username)}">Voir</a>
          </div>`).join('')
      : '';
    if (!people.length) {
      host.innerHTML = '';
      host.append(emptyState({ icon: I.search, title: 'Aucun résultat', text: `Rien pour « ${q} ».` }));
    }
    return;
  }

  host.innerHTML = `
    <section class="hub-sec">
      <div class="hub-sec-head"><span>Tendances</span></div>
      ${TRENDS.map((t, i) => `<a class="trend" href="#/explore?tag=${esc(t.tag)}">
          <span class="trend-rank">${i + 1}</span>
          <div class="grow"><div class="t-bold">#${esc(t.tag)}</div>
          <div class="t-xs t-dim">${t.posts} publications</div></div>
          ${icon('chevron', { size: 16 })}
        </a>`).join('')}
    </section>
    <section class="hub-sec">
      <div class="hub-sec-head"><span>Suggestions</span></div>
      ${Object.values(PEOPLE).map(u => `<div class="cc">
          <span class="av" style="background:${avatarColor(u.id)}">${esc(initials(u.full_name))}</span>
          <div class="grow"><div class="t-bold">${esc(u.full_name)}</div>
          <div class="t-sm t-dim">${esc(u.faculty)}</div></div>
          <a class="btn btn-outline btn-sm" href="#/profile/${esc(u.username)}">Voir</a>
        </div>`).join('')}
    </section>`;
}

/* ============================================================
   SAVED
   ============================================================ */

function renderSaved() {
  const host = $('#campusList');
  if (!host) return;
  host.innerHTML = '';
  host.append(emptyState({
    icon: I.bookmark,
    title: 'Rien d\'enregistré',
    text: 'Les publications que vous enregistrez apparaîtront ici.',
    action: { label: 'Parcourir le fil', onClick: () => go('feed') }
  }));
}

/* ============================================================
   SHELL
   ============================================================ */

const SCREENS = {
  channels: { title:'Canaux',      placeholder:'Rechercher un canal…',  render:renderChannels,
              action:{ label:'Créer', icon:'plus', fn:() => toast('Création de canal bientôt') } },
  events:   { title:'Événements',  placeholder:'Rechercher un événement…', render:renderEvents,
              action:{ label:'Créer', icon:'plus', fn:openEventComposer } },
  qa:       { title:'Questions',   placeholder:'Rechercher une question…', render:renderQA,
              action:{ label:'Poser', icon:'plus', fn:openAsk } },
  explore:  { title:'Explorer',    placeholder:'Rechercher étudiants, sujets…', render:renderExplore },
  saved:    { title:'Enregistrés', placeholder:null, render:renderSaved }
};

function mountScreen(name, mountFn) {
  const cfg = SCREENS[name];
  const host = mountFn();
  if (!host || !cfg) return;
  host.closest('.view')?.classList.remove('full');

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
  if (search) {
    on(search, 'input', debounce(() => cfg.render(search.value.trim().toLowerCase()), 200));
  }
  cfg.render();
}

export function initCampus(mountFn) {
  for (const name of Object.keys(SCREENS)) {
    route(name, () => mountScreen(name, mountFn));
  }
}

export { openAsk, openEventComposer };
