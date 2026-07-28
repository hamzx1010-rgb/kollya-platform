/**
 * KOLIYA — features/feed_sm.js
 * ============================================================
 * The home feed: posts, polls, anonymous posts, comments, stories.
 *
 * Web model:
 *   click a post   → selects it, tools appear (same rule as chat)
 *   right-click    → full context menu
 *   double-click image → like, with a heart flash
 *   J / K          → move between posts, L → like the selected one
 *   likes are optimistic: the counter moves before the network answers
 * ============================================================
 */

import {
  $, $$, el, on, esc, richText, timeAgo, compact, initials, avatarColor,
  uid, safeUrl, cssEscape, onVisible, rafThrottle, debounce, env, copyText
} from '../core/utils_sm.js';
import { me, on as onEvent, emit, frequency } from '../core/store_sm.js';
import { t } from '../core/i18n_sm.js';
import { person, cachePeople } from '../core/people_sm.js';
import { act } from '../core/game_sm.js';
import { I, icon, reactionIcon } from '../core/icons_sm.js';
import {
  toast, contextMenu, confirmDialog, modal, lightbox,
  skeletonList, emptyState, optimistic, heartBurst, countUp
} from '../core/ui_sm.js';
import { route } from '../core/router_sm.js';
import { openImageEditor } from './editor_sm.js';
import { openStories, loadStories, openStoryComposer } from './stories_sm.js';

/* ------------------------------------------------------------
   STATE
   ------------------------------------------------------------ */

let posts = [];
let tab = 'foryou';
let selectedPost = null;
let composerFiles = [];

let api = null;
export function useApi(impl) { api = impl; }

/* ------------------------------------------------------------
   SAMPLE DATA  (replaced by db_sm.js)
   ------------------------------------------------------------ */

/* Stories come from the database; this is filled by loadStoryRail(). */
let storyGroups = [];

/* ------------------------------------------------------------
   DATA
   ------------------------------------------------------------ */

async function loadPosts(which) {
  if (!api?.listPosts) {
    // No database bound. Say so plainly instead of showing invented
    // posts that vanish on refresh — that was the old lie.
    throw new Error('not-connected');
  }
  const rows = await api.listPosts(which);
  cachePeople(rows.map(r => r.profiles).filter(Boolean));
  return rows;
}

/* ------------------------------------------------------------
   POST CARD
   ------------------------------------------------------------ */

function postMedia(p) {
  if (p.media_type === 'video' && p.media_url) {
    return `<div class="post-media">
        <video src="${esc(safeUrl(p.media_url))}" controls preload="metadata" playsinline></video>
      </div>`;
  }
  const src = p.image_url || (p.media_type === 'image' ? p.media_url : null);
  if (!src) return '';
  return `<div class="post-media media-zoom" data-zoom="${esc(safeUrl(src))}">
      <img src="${esc(safeUrl(src))}" alt="" loading="lazy">
    </div>`;
}

function pollMarkup(p) {
  const total = p.poll.options.reduce((n, o) => n + o.votes.length, 0);
  const mine = p.poll.options.findIndex(o => o.votes.includes(me.id));
  return `<div class="poll">
    ${p.poll.options.map((o, i) => {
      const pct = total ? Math.round(o.votes.length / total * 100) : 0;
      const voted = mine === i;
      return `<button class="poll-opt${voted ? ' voted' : ''}${mine > -1 ? ' done' : ''}" data-opt="${i}">
          <span class="poll-fill" style="width:${mine > -1 ? pct : 0}%"></span>
          <span class="poll-label">${esc(o.label)}</span>
          ${mine > -1 ? `<span class="poll-pct">${pct}%</span>` : ''}
          ${voted ? `<span class="poll-check">${icon('check', { size: 14 })}</span>` : ''}
        </button>`;
    }).join('')}
    <div class="t-xs t-dim">${total} vote${total > 1 ? 's' : ''}</div>
  </div>`;
}

function commenterFaces(p) {
  if (!p.comments?.length) return '';
  const ids = [...new Set(p.comments.map(c => c.user_id))].slice(0, 3);
  return `<button class="commenters" data-open-comments>
      <span class="av-stack">${ids.map(id => {
        const u = person(id);
        return u.avatar_url
          ? `<span class="av xs"><img src="${esc(safeUrl(u.avatar_url))}" alt=""></span>`
          : `<span class="av xs" style="background:${avatarColor(id)}">${esc(initials(u.full_name))}</span>`;
      }).join('')}</span>
      <span class="t-sm t-dim">${p.comments.length} commentaire${p.comments.length > 1 ? 's' : ''}</span>
    </button>`;
}

function postCard(p) {
  const anon = p.anonymous;
  const u = anon ? { full_name:t('feed.anonymous'), username:'anonyme', id:'anon' } : person(p.user_id);
  const liked = p.likes.includes(me.id);
  const saved = p.saves?.includes(me.id);
  const mine  = p.user_id === me.id;

  const node = el('article', { class: 'post hover-host', 'data-id': p.id, tabindex: '0' });
  node.innerHTML = `
    <div class="post-head">
      ${anon
        ? `<div class="av" style="background:var(--text-3)">${icon('user', { size: 18 })}</div>`
        : avatarMarkup(u)}
      <div class="grow" style="min-width:0">
        <div class="row g2" style="flex-wrap:wrap">
          <span class="post-name">${esc(u.full_name)}</span>
          ${anon ? '<span class="pill" style="height:20px">Anonyme</span>'
                 : `<span class="post-handle">@${esc(u.username)}</span>`}
          <span class="post-handle">·</span>
          <span class="post-time">${timeAgo(p.created_at)}</span>
          ${p.pinned ? `<span class="pill" style="height:20px">${icon('pin',{size:11})} Épinglé</span>` : ''}
        </div>
        ${!anon && u.faculty ? `<div class="t-xs t-dim2">${esc(u.faculty)}</div>` : ''}
      </div>
    </div>

    ${p.text ? `<div class="post-text clamp-init">${richText(p.text)}</div>` : ''}
    ${postMedia(p)}
    ${p.poll ? pollMarkup(p) : ''}
    ${commenterFaces(p)}

    <div class="post-actions">
      <button class="act like${liked ? ' on' : ''}" data-act="like" aria-pressed="${liked}">
        ${liked ? reactionIcon('love', 18) : I.smile.replace(I.smile, heartOutline())}
        <span class="c">${p.likes.length || ''}</span>
      </button>
      <button class="act" data-act="comment">${I.comment}<span class="c">${p.comments?.length || ''}</span></button>
      <button class="act" data-act="repost">${I.repost}<span class="c"></span></button>
      <button class="act" data-act="share">${I.share}</button>
      <button class="act${saved ? ' on' : ''}" data-act="save" style="margin-inline-start:auto">${I.bookmark}</button>
    </div>

    <div class="post-tools hover-reveal">
      <button class="icon-btn sm" data-act="menu" data-tip="Plus">${I.moreH}</button>
    </div>`;
  return node;
}

/** Real photo when the profile has one, coloured initials otherwise. */
function avatarMarkup(u, cls = 'av') {
  const src = u?.avatar_url;
  if (src) return `<div class="${cls}"><img src="${esc(safeUrl(src))}" alt="" loading="lazy"></div>`;
  return `<div class="${cls}" style="background:${avatarColor(u?.id)}">${esc(initials(u?.full_name || ''))}</div>`;
}

const heartOutline = () =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20.7 4.3 13a4.9 4.9 0 0 1 0-7 4.9 4.9 0 0 1 7 0l.7.7.7-.7a4.9 4.9 0 0 1 7 0 4.9 4.9 0 0 1 0 7z"/></svg>`;

/* ------------------------------------------------------------
   ACTIONS
   ------------------------------------------------------------ */

function toggleLike(p, node, viaDoubleClick = false) {
  const was = p.likes.includes(me.id);
  const btn = node.querySelector('[data-act="like"]');
  const count = btn.querySelector('.c');

  optimistic(
    () => {
      if (was) p.likes = p.likes.filter(x => x !== me.id);
      else p.likes.push(me.id);
      btn.classList.toggle('on', !was);
      btn.setAttribute('aria-pressed', String(!was));
      btn.firstElementChild?.remove();
      btn.insertAdjacentHTML('afterbegin', !was ? reactionIcon('love', 18) : heartOutline());
      count.textContent = p.likes.length || '';
      if (!was && viaDoubleClick) heartBurst(node.querySelector('.post-media') || node);
    },
    () => {
      p.likes = was ? [...p.likes, me.id] : p.likes.filter(x => x !== me.id);
      btn.classList.toggle('on', was);
      count.textContent = p.likes.length || '';
    },
    async () => {
      await api.like(p.id, !was);
      // liking moves your quest; the author earns the point, capped
      if (!was) {
        act('like_given', p.id);
        if (p.user_id && p.user_id !== me.id) act('like_received', p.id);
      }
    },
    'Impossible d\'aimer cette publication'
  );
}

function toggleSave(p, node) {
  p.saves ||= [];
  const was = p.saves.includes(me.id);
  const btn = node.querySelector('[data-act="save"]');
  optimistic(
    () => { p.saves = was ? p.saves.filter(x => x !== me.id) : [...p.saves, me.id];
            btn.classList.toggle('on', !was);
            toast(was ? t('feed.unsaved') : t('feed.saved'), { duration: 1500 }); },
    () => { p.saves = was ? [...p.saves, me.id] : p.saves.filter(x => x !== me.id);
            btn.classList.toggle('on', was); },
    () => api.save(p.id, !was)
  );
}

async function votePoll(p, index, node) {
  if (p.poll.options.some(o => o.votes.includes(me.id))) { toast(t('feed.voted')); return; }
  const before = JSON.parse(JSON.stringify(p.poll));
  p.poll.options[index].votes.push(me.id);
  node.querySelector('.poll').outerHTML = pollMarkup(p);

  try {
    await api.vote(p.id, index);
  } catch {
    p.poll = before;
    node.querySelector('.poll').outerHTML = pollMarkup(p);
    toast('Vote non enregistré', 'err');
  }
}

function postMenu(e, p) {
  const mine = p.user_id === me.id;
  contextMenu(e, [
    { title: t('feed.post') },
    { label: 'Copier le lien', icon: I.link, kbd: 'C',
      onClick: async () => toast(await copyText(`${location.origin}/#/post/${p.id}`) ? 'Lien copié' : 'Échec', 'ok') },
    { label: p.saves?.includes(me.id) ? 'Retirer des enregistrés' : t('action.save'), icon: I.bookmark,
      onClick: () => toggleSave(p, $(`.post[data-id="${cssEscape(p.id)}"]`)) },
    { sep: true },
    !mine ? { label: 'Masquer cette publication', icon: I.eyeOff, onClick: () => hidePost(p) } : null,
    !mine ? { label: `Masquer @${person(p.user_id).username}`, icon: I.mute,
              onClick: () => toast('Compte masqué', 'ok') } : null,
    mine ? { label: p.pinned ? 'Désépingler' : 'Épingler', icon: I.pin,
             onClick: () => { p.pinned = !p.pinned; render(); } } : null,
    { sep: true },
    mine
      ? { label: t('action.delete'), icon: I.trash, danger: true, onClick: () => deletePost(p) }
      : { label: t('action.report'), icon: I.flag, danger: true, onClick: () => toast('Signalement envoyé', 'ok') }
  ]);
}

function hidePost(p) {
  posts = posts.filter(x => x.id !== p.id);
  render();
  toast(t('feed.hidden'), { action: { label: t('action.cancel'), fn: () => { posts.unshift(p); render(); } } });
}

async function deletePost(p) {
  if (!await confirmDialog({
    title: 'Supprimer la publication ?', message: 'Cette action est définitive.',
    confirmLabel: t('action.delete'), danger: true
  })) return;
  const keep = posts;
  posts = posts.filter(x => x.id !== p.id);
  render();
  try {
    await api.deletePost(p.id);
    toast(t('feed.deleted'), 'ok');
  } catch {
    posts = keep;
    render();
    toast('Suppression échouée', 'err');
  }
}

/* ------------------------------------------------------------
   COMMENTS
   ------------------------------------------------------------ */

async function openComments(p) {
  const list = el('div', { class: 'cmt-list' });
  let busy = false;

  const draw = () => {
    list.innerHTML = p.comments?.length
      ? p.comments.map(c => {
          const u = person(c.user_id);
          const mine = c.user_id === me.id;
          return `<div class="cmt" data-cid="${esc(c.id)}">
              ${u.avatar_url
                ? `<span class="av sm"><img src="${esc(safeUrl(u.avatar_url))}" alt=""></span>`
                : `<span class="av sm" style="background:${avatarColor(c.user_id)}">${esc(initials(u.full_name))}</span>`}
              <div class="grow" style="min-width:0">
                <div class="row g2"><span class="t-bold t-sm">${esc(u.full_name)}</span>
                <span class="t-xs t-dim">${timeAgo(c.created_at)}</span></div>
                <div class="t-sm">${richText(c.text)}</div>
              </div>
              ${mine ? `<button class="icon-btn sm" data-del-cmt data-tip="Supprimer">${I.trash}</button>` : ''}
            </div>`;
        }).join('')
      : `<div class="tg-empty">${icon('comment', { size: 22 })}<span>Aucun commentaire</span></div>`;
  };

  // Show what we already have, then refresh from the database so the
  // list is never a stale snapshot from the feed request.
  draw();
  if (api?.listComments) {
    try {
      p.comments = await api.listComments(p.id);
      draw();
    } catch { /* keep what we had */ }
  }

  const input = el('input', { class: 'input', placeholder: t('feed.comment.placeholder') });
  const send = el('button', { class: 'btn btn-primary', onclick: () => add() }, t('action.publish'));
  on(input, 'keydown', e => { if (e.key === 'Enter') add(); });

  on(list, 'click', async e => {
    const btn = e.target.closest('[data-del-cmt]');
    if (!btn) return;
    const id = btn.closest('[data-cid]').dataset.cid;
    const keep = p.comments;
    p.comments = p.comments.filter(c => String(c.id) !== String(id));
    draw(); render();
    try { await api?.deleteComment?.(id); }
    catch { p.comments = keep; draw(); render(); toast('Suppression échouée', 'err'); }
  });

  async function add() {
    const text = input.value.trim();
    if (!text || busy) return;
    busy = true;
    send.disabled = true;

    // optimistic row, replaced by the real one once Postgres answers
    const temp = { id: uid('c'), user_id: me.id, text, created_at: new Date().toISOString(), _pending: true };
    p.comments = [...(p.comments || []), temp];
    input.value = '';
    draw();

    try {
      const saved = await api?.comment?.(p.id, text);
      // the id from the database is what delete and reply will use
      p.comments = p.comments.map(c => (c.id === temp.id ? { ...temp, ...saved, _pending: false } : c));
      draw();
      render();
      act('comment', saved?.id);
    } catch (err) {
      p.comments = p.comments.filter(c => c.id !== temp.id);
      draw();
      toast(err?.status === 401
        ? 'Session expirée — reconnectez-vous'
        : 'Commentaire non enregistré', 'err');
    } finally {
      busy = false;
      send.disabled = false;
      input.focus();
    }
  }

  const body = el('div', { class: 'col g4' }, list, el('div', { class: 'row g2' }, input, send));
  modal({ title: t('feed.comments'), body });
  setTimeout(() => input.focus(), 80);
}

/* ------------------------------------------------------------
   COMPOSER
   ------------------------------------------------------------ */

const POST_KINDS = [
  { id:'post',  label:t('feed.post'), desc:'Partagez avec votre faculté', icon:'edit',  grad:'var(--grad)' },
  { id:'photo', label:t('feed.photo'),       desc:'Une image vaut mille mots',   icon:'image', grad:'linear-gradient(135deg,#F59E0B,#EF4444)' },
  { id:'poll',  label:t('feed.poll'),     desc:'Demandez au campus',          icon:'poll',  grad:'linear-gradient(135deg,#06B6D4,#4F46E5)' },
  { id:'anon',  label:t('feed.anonymous'),     desc:'Masquez votre identité',      icon:'lock',  grad:'linear-gradient(135deg,#64748B,#334155)' }
];

export function openComposer(kind = 'post') {
  composerFiles = [];
  let anonymous = kind === 'anon';
  let pollMode = kind === 'poll';

  const ta = el('textarea', {
    class: 'textarea', rows: '4',
    placeholder: anonymous ? 'Votre message restera anonyme…' : 'Quoi de neuf sur le campus ?'
  });

  const preview = el('div', { class: 'comp-prev' });
  const pollWrap = el('div', { class: 'comp-poll' + (pollMode ? '' : ' hidden') });
  const pollInputs = [];
  const addPollRow = () => {
    if (pollInputs.length >= 4) return;
    const i = el('input', { class: 'input', placeholder: `Option ${pollInputs.length + 1}` });
    pollInputs.push(i);
    pollWrap.insertBefore(i, pollWrap.lastElementChild);
  };
  pollWrap.append(el('button', { class: 'btn btn-outline btn-sm', onclick: addPollRow }, '+ Option'));
  addPollRow(); addPollRow();

  const chips = el('div', { class: 'row g2 wrap' },
    ...POST_KINDS.map(k => el('button', {
      class: 'pill' + (k.id === kind ? ' on' : ''),
      onclick: e => {
        for (const c of chips.children) c.classList.remove('on');
        e.currentTarget.classList.add('on');
        anonymous = k.id === 'anon';
        pollMode = k.id === 'poll';
        pollWrap.classList.toggle('hidden', !pollMode);
        ta.placeholder = anonymous ? 'Votre message restera anonyme…' : 'Quoi de neuf sur le campus ?';
        if (k.id === 'photo') pick.click();
      },
      html: `${icon(k.icon, { size: 14 })} ${k.label}`
    }))
  );

  const pick = el('input', { type: 'file', accept: 'image/*', hidden: true });
  on(pick, 'change', async e => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const edited = await openImageEditor(f, 'post');
    if (!edited) return;
    composerFiles = [edited];
    preview.innerHTML = `<div class="media"><img src="${URL.createObjectURL(edited)}" alt=""></div>`;
  });

  const tools = el('div', { class: 'row g2' },
    el('button', { class: 'icon-btn', 'data-tip': 'Photo', onclick: () => pick.click(), html: I.image }),
    el('button', { class: 'icon-btn', 'data-tip': 'Sondage',
      onclick: () => { pollMode = !pollMode; pollWrap.classList.toggle('hidden', !pollMode); }, html: I.poll })
  );

  const foot = el('div', { class: 'row g2 grow between' });
  const counter = el('span', { class: 't-xs t-dim' }, '0 / 500');
  on(ta, 'input', () => {
    counter.textContent = `${ta.value.length} / 500`;
    counter.classList.toggle('over', ta.value.length > 500);
    publish.disabled = !ta.value.trim() && !composerFiles.length;
  });

  const publish = el('button', { class: 'btn btn-primary', disabled: true, onclick: submit }, 'Publier');
  foot.append(tools, el('div', { class: 'row g3' }, counter, publish));

  const m = modal({
    title: 'Créer',
    body: el('div', { class: 'col g4' }, chips, ta, preview, pollWrap, pick),
    footer: foot
  });
  setTimeout(() => ta.focus(), 80);

  async function submit() {
    const text = ta.value.trim();
    if (!text && !composerFiles.length) return;
    if (text.length > 500) { toast('500 caractères maximum', 'err'); return; }

    const draft = { anonymous, text, file: composerFiles[0] || null };
    if (pollMode) {
      const opts = pollInputs.map(i => i.value.trim()).filter(Boolean);
      if (opts.length < 2) { toast('Ajoutez au moins deux options', 'err'); return; }
      draft.poll = { options: opts };
    }

    publish.disabled = true;
    publish.textContent = draft.file ? 'Envoi de l\'image…' : 'Publication…';

    // The post is written to Neon FIRST and only then painted. An
    // optimistic card that quietly failed to save is exactly the bug
    // that made the old build feel broken.
    try {
      const saved = await api.createPost(draft);
      posts.unshift(saved);
      render();
      m.close();
      toast('Publié', 'ok');
      act('post', saved.id);
    } catch (err) {
      publish.disabled = false;
      publish.textContent = 'Publier';
      toast(err?.status === 413 || /trop lourd/i.test(err?.message || '')
        ? err.message
        : 'Publication échouée — rien n\'a été enregistré', 'err');
    }
  }
}

/* ------------------------------------------------------------
   STORIES
   ------------------------------------------------------------ */

function storiesBar() {
  const mine = me.get();
  const mineGroup = storyGroups.find(g => g.user_id === mine?.id);
  const others = storyGroups.filter(g => g.user_id !== mine?.id);

  const ringFor = (u, seen) => u?.avatar_url
    ? `<span class="story-ring${seen ? ' seen' : ''}"><span class="av lg"><img src="${esc(safeUrl(u.avatar_url))}" alt=""></span></span>`
    : `<span class="story-ring${seen ? ' seen' : ''}"><span class="av lg" style="background:${avatarColor(u?.id)}">${esc(initials(u?.full_name || ''))}</span></span>`;

  return `<div class="stories">
    <button class="story" data-story="new" data-tip="Ajouter à votre story">
      <span class="story-ring add">
        ${mineGroup || mine?.avatar_url
          ? `<span class="av lg">${mine?.avatar_url
              ? `<img src="${esc(safeUrl(mine.avatar_url))}" alt="">`
              : esc(initials(mine?.full_name || ''))}</span>`
          : `<span class="av lg" style="background:${avatarColor(mine?.id)}">${esc(initials(mine?.full_name || ''))}</span>`}
        <span class="story-plus">${icon('plus', { size: 13 })}</span>
      </span>
      <span class="story-name">Votre story</span>
    </button>
    ${mineGroup ? `<button class="story" data-story="${esc(mineGroup.items[0].id)}" data-user="${esc(mineGroup.user_id)}">
        ${ringFor(mineGroup.user, mineGroup.seen)}
        <span class="story-name truncate">Vous</span>
      </button>` : ''}
    ${others.map(g => {
      const u = g.user || person(g.user_id);
      return `<button class="story" data-story="${esc(g.items[0].id)}" data-user="${esc(g.user_id)}">
          ${ringFor(u, g.seen)}
          <span class="story-name truncate">${esc((u.full_name || '').split(' ')[0])}</span>
        </button>`;
    }).join('')}
  </div>`;
}

async function refreshStoryRail() {
  try { storyGroups = await loadStories(); }
  catch { storyGroups = []; }
  const bar = $('.stories');
  if (bar) bar.outerHTML = storiesBar();
  wireStoriesBar();
}

function wireStoriesBar() {
  on($('.stories'), 'click', async e => {
    const s = e.target.closest('[data-story]');
    if (!s) return;
    if (s.dataset.story === 'new') { await openStoryComposer(); refreshStoryRail(); return; }
    await openStories(s.dataset.user);
    refreshStoryRail();
  });
}

/* ------------------------------------------------------------
   RENDER
   ------------------------------------------------------------ */

function render() {
  const list = $('#feedList');
  if (!list) return;

  const ordered = [...posts].sort((a, b) =>
    (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) ||
    new Date(b.created_at) - new Date(a.created_at));

  if (!ordered.length) {
    list.innerHTML = '';
    list.append(emptyState({
      icon: I.inbox,
      title: 'Rien à afficher',
      text: tab === 'following'
        ? 'Suivez des étudiants pour voir leurs publications ici.'
        : t('feed.empty.text'),
      action: { label: 'Créer une publication', onClick: () => openComposer() }
    }));
    return;
  }

  list.innerHTML = '';
  const frag = document.createDocumentFragment();
  ordered.forEach(p => frag.append(postCard(p)));
  list.append(frag);

  // long text collapses on its own, with a control only when needed
  for (const t of $$('.post-text.clamp-init')) {
    t.classList.remove('clamp-init');
    if (t.scrollHeight > t.clientHeight + 8) {
      t.classList.add('clamp-5');
      const more = el('button', { class: 'post-more' }, 'Afficher plus');
      on(more, 'click', () => {
        const open = t.classList.toggle('clamp-5');
        more.textContent = open ? 'Afficher plus' : 'Afficher moins';
      });
      t.after(more);
    }
  }
}

function wireFeed() {
  const list = $('#feedList');
  if (!list) return;

  on(list, 'click', e => {
    const card = e.target.closest('.post');
    if (!card) return;
    const p = posts.find(x => x.id === card.dataset.id);
    if (!p) return;

    const actBtn = e.target.closest('[data-act]');
    if (actBtn) {
      const act = actBtn.dataset.act;
      if (act === 'like')    toggleLike(p, card);
      if (act === 'save')    toggleSave(p, card);
      if (act === 'comment') openComments(p);
      if (act === 'share')   sharePost(p);
      if (act === 'repost')  repost(p);
      if (act === 'menu')    postMenu(e, p);
      return;
    }
    if (e.target.closest('[data-open-comments]')) { openComments(p); return; }

    const opt = e.target.closest('.poll-opt');
    if (opt && !opt.classList.contains('done')) { votePoll(p, Number(opt.dataset.opt), card); return; }

    const zoom = e.target.closest('[data-zoom]');
    if (zoom) { lightbox([zoom.dataset.zoom]); return; }

    const mention = e.target.closest('.rt-mention');
    if (mention) { location.hash = `#/profile/${mention.dataset.user}`; return; }

    select(card);
  });

  on(list, 'dblclick', e => {
    const media = e.target.closest('.post-media');
    if (!media) return;
    const card = media.closest('.post');
    const p = posts.find(x => x.id === card.dataset.id);
    if (p && !p.likes.includes(me.id)) toggleLike(p, card, true);
  });

  on(list, 'contextmenu', e => {
    const card = e.target.closest('.post');
    if (!card) return;
    const p = posts.find(x => x.id === card.dataset.id);
    if (p) postMenu(e, p);
  });

  // J / K / L navigation
  onEvent('key:next', () => move(1));
  onEvent('key:prev', () => move(-1));
  onEvent('key:like', () => {
    if (!selectedPost) return;
    const p = posts.find(x => x.id === selectedPost);
    const card = $(`.post[data-id="${cssEscape(selectedPost)}"]`);
    if (p && card) toggleLike(p, card);
  });
  onEvent('key:compose', () => openComposer());
}

function select(card) {
  for (const n of $$('.post.is-active')) n.classList.remove('is-active');
  card.classList.add('is-active');
  selectedPost = card.dataset.id;
}

function move(dir) {
  const cards = $$('.post');
  if (!cards.length) return;
  const i = cards.findIndex(c => c.dataset.id === selectedPost);
  const next = cards[Math.max(0, Math.min(cards.length - 1, i + dir))] || cards[0];
  select(next);
  next.scrollIntoView({ block: 'center', behavior: env.reducedMotion ? 'auto' : 'smooth' });
}

async function sharePost(p) {
  const url = `${location.origin}/#/post/${p.id}`;
  if (navigator.share) {
    try { await navigator.share({ title: 'Koliya', text: p.text?.slice(0, 80), url }); return; } catch {}
  }
  toast(await copyText(url) ? 'Lien copié' : 'Partage impossible', 'ok');
}

/* ------------------------------------------------------------
   VIEW
   ------------------------------------------------------------ */

const TABS = [
  { id:'foryou',    label:t('feed.forYou') },
  { id:'following', label:t('feed.following') },
  { id:'faculty',   label:t('hub.myFaculty') }
];

/** Repost: a new post that points at the original. */
async function repost(p) {
  const note = el('textarea', { class: 'textarea', rows: '2', placeholder: 'Ajouter un mot (facultatif)…' });
  const foot = el('div', { class: 'row g2' });
  const orig = person(p.user_id);

  const m = modal({
    title: 'Repartager',
    body: el('div', { class: 'col g3' }, note,
      el('div', { class: 'repost-quote', html:
        `<div class="row g2"><span class="t-sm t-bold">${esc(p.anonymous ? t('feed.anonymous') : orig.full_name)}</span>
         <span class="t-xs t-dim">${timeAgo(p.created_at)}</span></div>
         <div class="t-sm t-dim">${esc(truncateText(p.text || '', 160))}</div>` })),
    footer: foot
  });

  foot.append(
    el('button', { class: 'btn btn-ghost', onclick: () => m.close() }, t('action.cancel')),
    el('button', { class: 'btn btn-primary', onclick: async e => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const saved = await api.createPost({
          text: note.value.trim(),
          repost_id: p.id,
          image_url: p.image_url || null
        });
        posts.unshift(saved);
        render();
        m.close();
        toast('Repartagé', 'ok');
      } catch {
        btn.disabled = false;
        toast('Repartage échoué', 'err');
      }
    }}, 'Repartager')
  );
}

const truncateText = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/* ------------------------------------------------------------
   VIEW ENTRY
   ------------------------------------------------------------ */

export function initFeed(mountFn) {
  route('feed', async () => {
    const host = mountFn();
    if (!host) return;
    host.closest('.view')?.classList.remove('full');

    host.innerHTML = `
      ${storiesBar()}
      <div class="sub-tabs blur-bar">
        ${TABS.map(t => `<button class="sub-tab${t.id === tab ? ' on' : ''}" data-tab="${t.id}">${t.label}</button>`).join('')}
      </div>
      <div id="feedList">${skeletonList(4)}</div>`;

    for (const btn of $$('.sub-tab')) {
      on(btn, 'click', async () => {
        tab = btn.dataset.tab;
        frequency.bump('feedtab', tab);
        for (const b of $$('.sub-tab')) b.classList.toggle('on', b === btn);
        $('#feedList').innerHTML = skeletonList(3);
        await reload();
      });
    }

    wireStoriesBar();
    wireFeed();
    await reload();
    refreshStoryRail();
  });
}

/** Load from Neon, and say honestly what happened if it fails. */
async function reload() {
  const list = $('#feedList');
  try {
    posts = await loadPosts(tab);
    render();
  } catch (err) {
    if (!list) return;
    list.innerHTML = '';
    const offline = err?.message === 'not-connected' || err?.status === 401;
    list.append(emptyState({
      icon: I.inbox,
      title: offline ? 'Non connecté à la base' : t('error.loading'),
      text: offline
        ? 'Reconnectez-vous pour voir le fil de votre campus.'
        : (err?.message || 'Réessayez dans un instant.'),
      action: { label: t('action.retry'), onClick: () => { list.innerHTML = skeletonList(3); reload(); } }
    }));
  }
}
