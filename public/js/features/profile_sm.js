/**
 * KOLIYA — features/profile_sm.js
 * ============================================================
 * Profile: cover, identity, stats, tabs, badges, follow state.
 *
 * The cover shrinks and blurs as you scroll and the name moves into
 * the top bar — so the header stops wasting space once you are
 * reading, without a control asking you to collapse it.
 * ============================================================
 */

import {
  $, $$, el, on, esc, richText, timeAgo, compact, initials, avatarColor,
  rafThrottle, clamp, env, copyText, cssEscape
} from '../core/utils_sm.js';
import { me, on as onEvent } from '../core/store_sm.js';
import { t, errorText } from '../core/i18n_sm.js';
import { person, cachePeople } from '../core/people_sm.js';
import { safeUrl } from '../core/utils_sm.js';
import { I, icon } from '../core/icons_sm.js';
import {
  toast, modal, contextMenu, confirmDialog, lightbox,
  skeletonList, emptyState, countUp, optimistic
} from '../core/ui_sm.js';
import { route, go } from '../core/router_sm.js';
import { BADGES, earnedBadges, levelFromXp } from './hub_sm.js';
import { openImageEditor } from './editor_sm.js';
import { myRank, rankBadge, levelFromXp as gameLevel } from '../core/game_sm.js';

let api = null;
export function useApi(impl) { api = impl; }

let viewing = null;
let activeTab = 'posts';

/* ------------------------------------------------------------
   DATA
   ------------------------------------------------------------ */

let viewPosts = [];

async function loadProfile(username) {
  if (!api?.getProfile) throw new Error('not-connected');
  return api.getProfile(username);
}

/* ------------------------------------------------------------
   HEADER
   ------------------------------------------------------------ */

function headerMarkup(u) {
  const lv = levelFromXp(u.xp || 0);
  const badges = earnedBadges({ ...u, level: lv.level, likes: 0, comments: 0, answers: 0, events: 0, saved: 0, nightPosts: 0 });

  return `
  <div class="pf-cover" id="pfCover">
    <div class="pf-cover-img" id="pfCoverImg" style="${u.banner_url
      ? `background-image:url('${esc(safeUrl(u.banner_url))}');background-size:cover;background-position:center`
      : `background:${coverFor(u)}`}"></div>
    ${u.isMe ? `<button class="icon-btn pf-cover-edit" id="pfCoverEdit" data-tip="Changer la couverture">${I.camera}</button>` : ''}
  </div>

  <div class="pf-head">
    <div class="pf-avatar-wrap">
      <div class="av-ring" style="--pct:${lv.pct}" data-tip="${t('hub.levelTip', { n: lv.level, into: lv.into, need: lv.need })}">
        <div class="av xl" id="pfAvatar" ${u.avatar_url ? '' : `style="background:${avatarColor(u.id)}"`}>${
          u.avatar_url ? `<img src="${esc(safeUrl(u.avatar_url))}" alt="">` : esc(initials(u.full_name))}</div>
      </div>
      ${u.isMe ? `<button class="icon-btn pf-avatar-edit" id="pfAvatarEdit" data-tip="${esc(t('profile.changePhoto'))}">${I.camera}</button>` : ''}
      <span class="pf-level">Niv. ${lv.level}</span>
    </div>

    <div class="pf-actions">
      ${u.isMe
        ? `<button class="btn btn-outline" id="pfEdit">${icon('edit',{size:16})} ${t('profile.edit')}</button>
           <button class="icon-btn" id="pfSettings" data-tip="${esc(t('nav.settings'))}">${I.settings}</button>`
        : `<button class="btn ${u.followState === 'following' ? 'btn-outline btn-follow' : 'btn-primary'}"
                   id="pfFollow" data-state="${u.followState || 'none'}">
             ${followLabel(u.followState)}
           </button>
           ${u.canMessage
             ? `<button class="btn btn-outline" id="pfMessage"
                        data-request="${u.willBeRequest ? '1' : ''}">
                  ${icon('message', { size: 16 })} ${esc(t('profile.msgBtn'))}
                </button>` : ''}
           <button class="icon-btn" id="pfMore" data-tip="${esc(t('action.more'))}">${I.moreH}</button>`}
    </div>
  </div>

  <div class="pf-identity">
    <div class="row g2" style="align-items:center;flex-wrap:wrap">
      <h2 style="font-size:var(--fs-xl)">${esc(u.full_name)}</h2>
      ${u.private ? `<span class="pill">${icon('lock',{size:12})} Privé</span>` : ''}
      ${u.role === 'admin' ? '<span class="pill on">Admin</span>' : ''}
      <span id="pfRank"></span>
    </div>
    <div class="t-sm t-dim"><span class="handle">@${esc(u.username)}</span> · ${esc(u.faculty || '')}</div>
    ${u.bio ? `<p class="pf-bio">${richText(u.bio)}</p>` : ''}
    ${profileLinks(u)}

    <div class="pf-stats">
      <button class="pf-stat" data-stat="posts"><b id="stPosts">0</b><span>${t('profile.posts')}</span></button>
      <button class="pf-stat" data-stat="followers"><b id="stFollowers">0</b><span>${t('profile.followers')}</span></button>
      <button class="pf-stat" data-stat="following"><b id="stFollowing">0</b><span>${t('profile.following')}</span></button>
      <div class="pf-stat"><b class="row g1" style="color:var(--streak)">${icon('fire',{size:15})} ${u.streak || 0}</b><span>${t('profile.streak')}</span></div>
    </div>

    ${badges.length ? `<div class="pf-badges">
      ${badges.slice(0, 6).map(b => `<span class="pf-badge" data-tip="${esc(b.name)} — ${esc(b.desc)}">${icon(b.icon,{size:15})}</span>`).join('')}
      ${badges.length > 6 ? `<button class="pill" id="pfAllBadges">+${badges.length - 6}</button>` : ''}
    </div>` : ''}
  </div>`;
}

/** Two labels stacked: "Following" normally, "Unfollow" on hover. */
const followLabel = s =>
  s === 'following'
    ? `<span class="lbl-following">${esc(t('profile.followingBtn'))}</span>` +
      `<span class="lbl-unfollow">${esc(t('profile.unfollowBtn'))}</span>`
  : s === 'requested' ? esc(t('profile.requestedBtn'))
  : esc(t('profile.followBtn'));

/** Website / GitHub / LinkedIn, shown only when they exist. */
function profileLinks(u) {
  const items = [
    u.website  && { icon: 'link',   label: String(u.website).replace(/^https?:\/\//, ''), href: safeUrl(u.website) },
    u.github   && { icon: 'hash',   label: u.github,   href: `https://github.com/${encodeURIComponent(u.github)}` },
    u.linkedin && { icon: 'globe',  label: u.linkedin, href: `https://linkedin.com/in/${encodeURIComponent(u.linkedin)}` }
  ].filter(Boolean);
  if (!items.length) return '';
  return `<div class="pf-links">${items.map(i =>
    `<a class="pf-link" href="${esc(i.href)}" target="_blank" rel="noopener noreferrer">
       ${icon(i.icon, { size: 14 })}<span>${esc(i.label)}</span></a>`).join('')}</div>`;
}

function coverFor(u) {
  const c = avatarColor(u.id);
  return `linear-gradient(135deg, ${c}, color-mix(in srgb, ${c} 45%, #7C5BE8))`;
}

/* ------------------------------------------------------------
   TABS
   ------------------------------------------------------------ */

const TABS = [
  { id:'posts', label:t('profile.tabPosts'), icon:'edit' },
  { id:'media', label:t('profile.tabMedia'), icon:'image' },
  { id:'likes', label:t('profile.tabLikes'), icon:'fire' }
];

async function renderTabBody(u) {
  const host = $('#pfBody');
  if (!host) return;

  if (u.private && !u.isMe && u.followState !== 'following') {
    host.innerHTML = '';
    host.append(emptyState({
      icon: I.lock,
      title: t('profile.privateTitle'),
      text: `Suivez ${u.full_name} pour voir ses publications.`
    }));
    return;
  }

  host.innerHTML = skeletonList(2);

  let posts = [];
  try {
    posts = activeTab === 'likes'
      ? await api.listLiked(u.id)
      : await api.listPosts(u.id);
  } catch (err) {
    host.innerHTML = '';
    host.append(emptyState({
      icon: I.inbox, title: t('error.loading'),
      text: errorText(err),
      action: { label: t('action.retry'), onClick: () => renderTabBody(u) }
    }));
    return;
  }
  viewPosts = posts;

  if (activeTab === 'media') {
    const media = posts.filter(p => p.image_url || p.media_type === 'image');
    host.innerHTML = media.length
      ? `<div class="pf-grid">${media.map(p => {
          const src = safeUrl(p.image_url || p.media_url);
          return `<button class="pf-tile" data-zoom="${esc(src)}"><img src="${esc(src)}" alt="" loading="lazy"></button>`;
        }).join('')}</div>`
      : '';
    if (!media.length) host.append(emptyState({ icon: I.image, title: t('empty.noMedia'), text: t('empty.sharedPhotos') }));
    return;
  }

  if (!posts.length) {
    host.innerHTML = '';
    host.append(emptyState({
      icon: activeTab === 'likes' ? I.fire : I.edit,
      title: activeTab === 'likes' ? t('profile.nothingYet') : t('profile.noPosts'),
      text: activeTab === 'likes'
        ? t('empty.likedPosts')
        : (u.isMe ? t('empty.yourFirstPost') : `${u.full_name} n'a rien publié.`)
    }));
    return;
  }

  host.innerHTML = posts.map(p => {
    const author = p.anonymous ? { full_name: t('feed.anonymous'), username: 'anonyme', id: 'anon' }
                               : (String(p.user_id) === String(u.id) ? u : person(p.user_id));
    const src = p.image_url || (p.media_type === 'image' ? p.media_url : null);
    return `
    <article class="post" data-id="${esc(p.id)}">
      <div class="post-head">
        ${author.avatar_url
          ? `<div class="av"><img src="${esc(safeUrl(author.avatar_url))}" alt=""></div>`
          : `<div class="av" style="background:${avatarColor(author.id)}">${esc(initials(author.full_name))}</div>`}
        <div class="grow" style="min-width:0">
          <div class="row g2"><span class="post-name">${esc(author.full_name)}</span>
          <span class="post-handle handle">@${esc(author.username)}</span>
          <span class="post-handle">·</span><span class="post-time">${timeAgo(p.created_at)}</span></div>
        </div>
      </div>
      ${p.text ? `<div class="post-text">${richText(p.text)}</div>` : ''}
      ${src ? `<div class="post-media media-zoom" data-zoom="${esc(safeUrl(src))}">
          <img src="${esc(safeUrl(src))}" alt="" loading="lazy"></div>` : ''}
      ${p.repost_of ? (() => {
        // Same quoted-original card as the feed, or a repost with no
        // added comment shows up here as a blank row.
        const q = p.repost_of;
        const qu = q.anonymous
          ? { full_name: t('feed.anonymous'), username: 'anonyme' }
          : person(q.user_id);
        const qimg = q.image_url ? safeUrl(q.image_url) : null;
        return `<a class="repost-quote" href="#/post/${esc(q.id)}">
            <div class="row g2">
              <span class="t-sm t-bold">${esc(qu.full_name)}</span>
              <span class="t-xs t-dim handle">@${esc(qu.username)}</span>
              <span class="t-xs t-dim">· ${timeAgo(q.created_at)}</span>
            </div>
            ${q.text ? `<div class="t-sm">${richText(q.text)}</div>` : ''}
            ${qimg ? `<img src="${esc(qimg)}" alt="" loading="lazy"
                         style="width:100%;border-radius:var(--r-sm);margin-top:var(--s2)">` : ''}
          </a>`;
      })() : ''}
      <div class="post-actions">
        <button class="act like${p.likes?.includes(me.id) ? ' on' : ''}" data-act="like"
                aria-pressed="${!!p.likes?.includes(me.id)}" aria-label="${t('action.like')}">
          <span>${icon('fire',{size:17})}</span><span class="c">${p.likes?.length || ''}</span></button>
        <button class="act" data-act="comment" aria-label="${t('action.reply')}">${I.comment}<span class="c">${p.comments?.length || ''}</span></button>
        <button class="act${p.reposts?.includes(me.id) ? ' on' : ''}" data-act="repost"
                aria-pressed="${!!p.reposts?.includes(me.id)}" aria-label="${t('action.repost')}">${I.repost}<span class="c">${p.reposts?.length || ''}</span></button>
        <button class="act" data-act="share" aria-label="${t('action.share')}">${I.share}</button>
        <button class="act${p.saves?.includes(me.id) ? ' on' : ''}" data-act="save"
                aria-label="${t('action.save')}" style="margin-inline-start:auto">${I.bookmark}</button>
      </div>
    </article>`;
  }).join('');
}

/* ------------------------------------------------------------
   SCROLL — cover shrinks, name rises into the bar
   ------------------------------------------------------------ */

function wireScroll(u) {
  const view = $('#view') || $('.view');
  const cover = $('#pfCover');
  const title = $('#topbarTitle');
  if (!view || !cover) return;

  const original = title?.textContent;

  const onScroll = rafThrottle(() => {
    const y = view.scrollTop;
    const p = clamp(y / 160, 0, 1);
    cover.style.setProperty('--shrink', String(p));
    if (title) title.textContent = p > .7 ? u.full_name : original;
  });
  on(view, 'scroll', onScroll, { passive: true });
}

/* ------------------------------------------------------------
   ACTIONS
   ------------------------------------------------------------ */

function wireActions(u) {
  const follow = $('#pfFollow');
  if (follow) {
    on(follow, 'click', () => {
      const state = follow.dataset.state;
      const next = state === 'following' ? 'none'
                 : u.private ? 'requested' : 'following';
      const beforeCount = u.followers || 0;

      optimistic(
        () => {
          follow.dataset.state = next;
          follow.className = 'btn ' + (next === 'following' ? 'btn-outline btn-follow' : next === 'requested' ? 'btn-outline' : 'btn-primary');
          follow.innerHTML = followLabel(next);
          u.followState = next;
          // move the number at once so the click feels immediate
          u.followers = beforeCount + (next === 'following' ? 1 : state === 'following' ? -1 : 0);
          setStat('#stFollowers', u.followers);
          if (next === 'requested') toast(t('profile.requestSent'), 'ok');
          renderTabBody(u);
        },
        () => {
          follow.dataset.state = state;
          follow.className = 'btn ' + (state === 'following' ? 'btn-outline btn-follow' : 'btn-primary');
          follow.innerHTML = followLabel(state);
          u.followState = state;
          u.followers = beforeCount;
          setStat('#stFollowers', beforeCount);
        },
        async () => {
          await api.follow(u.id, next);
          // Then ask the database what the number really is. The old
          // code only ever guessed +1 and never corrected itself, so
          // a failed or duplicated follow left a wrong count on
          // screen until the page was reloaded.
          await syncCounts(u);
        }
      );
    });
  }

  // Open the conversation, creating it if it does not exist yet.
  // Navigating alone was not enough: with no prior messages the
  // student landed on an empty pane instead of a new conversation.
  on($('#pfMessage'), 'click', async e => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const { openConversationWith } = await import('./messages_sm.js');
      // Say up front that this lands in their requests tab. Finding
      // out afterwards — from silence — is worse than being told.
      if (btn.dataset.request) toast(t('dm.willBeRequest'), { duration: 5000 });
      await openConversationWith(u.id, { full_name: u.full_name, username: u.username,
                                         avatar_url: u.avatar_url, faculty: u.faculty });
    } catch (err) {
      console.error('[koliya] ouverture de la conversation', err);
      go('messages', u.id);          // still get them there
    } finally { btn.disabled = false; }
  });
  on($('#pfEdit'), 'click', () => openEditProfile(u));
  on($('#pfSettings'), 'click', () => go('settings'));

  on($('#pfMore'), 'click', e => contextMenu(e, [
    { title: esc(u.full_name) },
    { label: t('menu.copyLink'), icon: I.link,
      onClick: async () => toast(await copyText(`${location.origin}/#/profile/${u.username}`) ? t('toast.linkCopied') : t('toast.failed'), 'ok') },
    { label: 'Couper les notifications', icon: I.mute, onClick: () => toast(t('toast.notifMuted'), 'ok') },
    { sep: true },
    { label: t('action.block'), icon: I.block, danger: true, onClick: async () => {
        if (!await confirmDialog({ title: `Bloquer ${u.full_name} ?`,
          message: t('confirm.blockBodyFull'),
          confirmLabel: t('action.block'), danger: true })) return;
        try { await api.block(u.id); toast(t('toast.userBlocked'), 'ok'); go('feed'); }
        catch { toast(t('toast.blockFailed'), 'err'); }
      } },
    { label: t('action.report'), icon: I.flag, danger: true, onClick: async () => {
        try { await api.report('user', u.id, t('report.fromProfile'));
              toast(t('toast.reportSentAdmin'), 'ok'); }
        catch { toast(t('toast.reportFailed'), 'err'); }
      } }
  ]));

  // Avatar & cover, changed straight from the header.
  // These write to Postgres immediately — the previous build used
  // URL.createObjectURL, which is why the picture vanished on F5.
  if (u.isMe) {
    const pick = el('input', { type: 'file', accept: 'image/*', hidden: true });
    document.body.append(pick);
    let target = 'avatar';

    on($('#pfAvatarEdit'), 'click', () => { target = 'avatar'; pick.click(); });
    on($('#pfCoverEdit'), 'click', () => { target = 'banner'; pick.click(); });

    on(pick, 'change', async e => {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (!f) return;

      const out = await openImageEditor(f, target === 'avatar' ? 'avatar' : 'post');
      if (!out) return;

      // show it at once, keep the old value so a failure can undo
      const localUrl = URL.createObjectURL(out);
      const avNode = $('#pfAvatar');
      const coverNode = $('#pfCoverImg');
      const prevAvatar = u.avatar_url;
      const prevBanner = u.banner_url;

      if (target === 'avatar' && avNode) avNode.innerHTML = `<img src="${localUrl}" alt="">`;
      if (target === 'banner' && coverNode) coverNode.style.background = `url(${localUrl}) center/cover`;

      // NOT `const t` — that would shadow the translation function t()
      const saving = toast(t('toast.savingImage'), { duration: 30000 });
      try {
        const updated = await api.updateProfile({},
          target === 'avatar' ? { avatarFile: out } : { bannerFile: out });
        saving?.close?.();
        Object.assign(u, updated);
        cachePeople(updated);
        // repaint from the stored value, so what you see is what is saved
        if (target === 'avatar' && avNode && updated.avatar_url) {
          avNode.innerHTML = `<img src="${esc(safeUrl(updated.avatar_url))}" alt="">`;
        }
        if (target === 'banner' && coverNode && updated.banner_url) {
          coverNode.style.background = `url('${esc(safeUrl(updated.banner_url))}') center/cover`;
        }
        toast(t(target === 'avatar' ? 'toast.avatarUpdated' : 'toast.bannerUpdated'), 'ok');
      } catch (err) {
        saving?.close?.();
        u.avatar_url = prevAvatar;
        u.banner_url = prevBanner;
        if (target === 'avatar' && avNode) {
          avNode.innerHTML = prevAvatar
            ? `<img src="${esc(safeUrl(prevAvatar))}" alt="">`
            : esc(initials(u.full_name));
        }
        if (target === 'banner' && coverNode) {
          coverNode.style.background = prevBanner
            ? `url('${esc(safeUrl(prevBanner))}') center/cover`
            : coverFor(u);
        }
        toast(err?.message?.includes('lourd') ? err.message : 'Image non enregistrée', 'err');
      } finally {
        URL.revokeObjectURL(localUrl);
      }
    });
  }

  for (const b of $$('.pf-stat[data-stat]')) {
    on(b, 'click', () => {
      const kind = b.dataset.stat;
      if (kind === 'posts') { activeTab = 'posts'; syncTabs(u); return; }
      openPeopleList(kind, u);
    });
  }

  on($('#pfAllBadges'), 'click', () => go('hub'));

  on($('#pfBody'), 'click', async e => {
    const z = e.target.closest('[data-zoom]');
    if (z) { lightbox([z.dataset.zoom]); return; }

    // Post actions on the profile used to be DEAD: the buttons carried
    // no data-act and there was no listener at all, so like / comment /
    // share on your own profile did nothing at all. They now delegate
    // to the same handlers the feed uses, so the two cannot drift.
    const actBtn = e.target.closest('[data-act]');
    if (!actBtn) return;
    const card = actBtn.closest('.post');
    const post = viewPosts.find(x => String(x.id) === String(card?.dataset.id));
    if (!post) return;
    const { runPostAction } = await import('./feed_sm.js');
    await runPostAction(actBtn.dataset.act, post, card, e);
  });
}

async function openPeopleList(kind, u) {
  const list = el('div', { class: 'col g3' });
  list.innerHTML = skeletonList(3, 'conv');
  modal({ title: kind === 'followers' ? t('profile.followers') : t('profile.following'), body: list });

  let rows = [];
  try {
    rows = kind === 'followers' ? await api.followers(u.id) : await api.following(u.id);
  } catch { /* fall through to the empty state */ }

  list.innerHTML = rows.length
    ? rows.map(p => `
      <a class="row g3" href="#/profile/${esc(p.username)}">
        ${p.avatar_url
          ? `<span class="av sm"><img src="${esc(safeUrl(p.avatar_url))}" alt=""></span>`
          : `<span class="av sm" style="background:${avatarColor(p.id)}">${esc(initials(p.full_name))}</span>`}
        <div class="grow" style="min-width:0"><div class="t-sm t-bold truncate">${esc(p.full_name)}</div>
        <div class="t-xs t-dim"><span class="handle">@${esc(p.username)}</span> · ${esc(p.faculty || '')}</div></div>
      </a>`).join('')
    : `<div class="tg-empty">${icon('user', { size: 22 })}<span>${esc(t('profile.noPeople'))}</span></div>`;
}

/* ------------------------------------------------------------
   EDIT PROFILE
   A full sheet, not a two-field box. You see the banner and the
   avatar exactly as others will, and both are written into Postgres
   — which is why they survive a refresh and appear on your phone.
   ------------------------------------------------------------ */

const FACULTIES = [
  'Informatique', 'Mathématiques', 'Physique', 'Chimie', 'Biologie',
  'Médecine', 'Pharmacie', 'Génie civil', 'Génie mécanique', 'Électronique',
  'Architecture', 'Droit', 'Économie', 'Sciences politiques', 'Lettres',
  'Langues étrangères', 'Psychologie', 'Sociologie', 'Sciences du sport', 'Agronomie'
];

function openEditProfile(u) {
  let avatarFile = null;
  let bannerFile = null;
  let avatarPreview = u.avatar_url || null;
  let bannerPreview = u.banner_url || null;

  const root = el('div', { class: 'pe' });

  const field = (label, control, hint = '') =>
    el('div', { class: 'pe-field' },
      el('label', { class: 'pe-label' }, label),
      control,
      hint ? el('div', { class: 'pe-hint' }, hint) : null);

  /* ---- media header, live ---- */
  const banner = el('div', { class: 'pe-banner' });
  const avatar = el('div', { class: 'pe-avatar' });

  const paintMedia = () => {
    banner.style.background = bannerPreview
      ? `url('${bannerPreview}') center/cover`
      : coverFor(u);
    banner.innerHTML = `
      <button class="pe-cam pe-cam-banner" type="button" data-pick="banner">
        ${icon('camera', { size: 15 })}<span>${esc(t('profile.cover'))}</span>
      </button>
      ${bannerPreview ? `<button class="pe-clear" type="button" data-clear="banner" aria-label="Retirer">${I.close}</button>` : ''}`;

    avatar.innerHTML = `
      <div class="av xl" ${avatarPreview ? '' : `style="background:${avatarColor(u.id)}"`}>
        ${avatarPreview ? `<img src="${avatarPreview}" alt="">` : esc(initials(nameInput.value || u.full_name))}
      </div>
      <button class="pe-cam pe-cam-avatar" type="button" data-pick="avatar" aria-label="${esc(t('profile.changePhoto'))}">
        ${icon('camera', { size: 15 })}
      </button>`;
  };

  /* ---- fields ---- */
  const nameInput = el('input', { class: 'input', value: u.full_name || '', maxlength: '60' });
  const userInput = el('input', { class: 'input', value: u.username || '', maxlength: '24' });
  const bioInput  = el('textarea', { class: 'textarea', rows: '3', maxlength: '160', value: u.bio || '' });
  const bioCount  = el('span', { class: 'pe-count' }, `${(u.bio || '').length}/160`);

  const facSelect = el('select', { class: 'input' },
    el('option', { value: '' }, '— Choisir —'),
    ...FACULTIES.map(f => el('option', { value: f, selected: f === u.faculty }, f)),
    ...(u.faculty && !FACULTIES.includes(u.faculty)
      ? [el('option', { value: u.faculty, selected: true }, u.faculty)] : []));

  const pronounInput  = el('input', { class: 'input', value: u.pronouns || '', placeholder: 'il / elle / iel' });
  const siteInput     = el('input', { class: 'input', value: u.website || '',  placeholder: 'https://…', type: 'url' });
  const githubInput   = el('input', { class: 'input', value: u.github || '',   placeholder: 'nom-utilisateur' });
  const linkedinInput = el('input', { class: 'input', value: u.linkedin || '', placeholder: 'nom-utilisateur' });

  const priv = el('div', { class: 'switch' + (u.private ? ' on' : ''), role: 'switch',
                           tabindex: '0', 'aria-checked': String(!!u.private) });
  on(priv, 'click', () => {
    priv.classList.toggle('on');
    priv.setAttribute('aria-checked', String(priv.classList.contains('on')));
  });

  on(bioInput, 'input', () => { bioCount.textContent = `${bioInput.value.length}/160`; });
  on(nameInput, 'input', paintMedia);

  /* ---- file picking, with the editor in between ---- */
  const pick = el('input', { type: 'file', accept: 'image/*', hidden: true });
  root.append(pick);
  let target = 'avatar';

  on(root, 'click', async e => {
    const p = e.target.closest('[data-pick]');
    if (p) { target = p.dataset.pick; pick.click(); return; }
    const c = e.target.closest('[data-clear]');
    if (c) {
      if (c.dataset.clear === 'banner') { bannerFile = null; bannerPreview = null; }
      else { avatarFile = null; avatarPreview = null; }
      paintMedia();
    }
  });

  on(pick, 'change', async e => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const out = await openImageEditor(f, target === 'avatar' ? 'avatar' : 'post');
    if (!out) return;
    if (target === 'avatar') {
      avatarFile = out;
      if (avatarPreview?.startsWith('blob:')) URL.revokeObjectURL(avatarPreview);
      avatarPreview = URL.createObjectURL(out);
    } else {
      bannerFile = out;
      if (bannerPreview?.startsWith('blob:')) URL.revokeObjectURL(bannerPreview);
      bannerPreview = URL.createObjectURL(out);
    }
    paintMedia();
  });

  /* ---- assemble ---- */
  root.append(
    el('div', { class: 'pe-media' }, banner, avatar),
    el('div', { class: 'pe-body' },
      el('div', { class: 'pe-sec' }, t('profile.identity')),
      field(t('profile.name'), nameInput),
      field("Nom d'utilisateur", userInput, 'Lettres, chiffres, point et tiret bas. Il apparaît dans votre lien de profil.'),
      field(t('profile.faculty'), facSelect),
      field(t('profile.pronouns'), pronounInput, t('profile.pronounsHint')),

      el('div', { class: 'pe-sec' }, t('profile.about')),
      el('div', { class: 'pe-field' },
        el('div', { class: 'row between' }, el('label', { class: 'pe-label' }, t('profile.bio')), bioCount),
        bioInput),

      el('div', { class: 'pe-sec' }, t('profile.links')),
      field(t('profile.website'), siteInput),
      field('GitHub', githubInput),
      field('LinkedIn', linkedinInput),

      el('div', { class: 'pe-sec' }, t('profile.privacy')),
      el('div', { class: 'pe-toggle' },
        el('div', { class: 'grow' },
          el('div', { class: 't-sm t-bold' }, t('profile.privateAccount')),
          el('div', { class: 't-xs t-dim' }, 'Seuls vos abonnés acceptés voient vos publications et vos stories.')),
        priv)
    )
  );

  paintMedia();

  const foot = el('div', { class: 'row g2' });
  const m = modal({
    title: t('profile.edit'),
    body: root,
    footer: foot,
    wide: true,
    className: 'pe-modal',
    onClose: () => {
      if (avatarPreview?.startsWith('blob:')) URL.revokeObjectURL(avatarPreview);
      if (bannerPreview?.startsWith('blob:')) URL.revokeObjectURL(bannerPreview);
    }
  });

  const save = el('button', { class: 'btn btn-primary', onclick: submit }, t('action.save'));
  foot.append(el('button', { class: 'btn btn-ghost', onclick: () => m.close() }, t('action.cancel')), save);

  async function submit() {
    const username = userInput.value.trim().toLowerCase();
    if (nameInput.value.trim().length < 2) { toast(t('toast.nameTooShort2'), 'err'); nameInput.focus(); return; }

    // Changing your display name twice in 15 days confuses everyone
    // who knows you. Warn with the real number of days, then allow —
    // blocking outright is easy to work around by editing a profile
    // you control anyway, and it punishes honest typo fixes.
    if (nameInput.value.trim() !== (u.full_name || '')) {
      const st = await api.nameChangeStatus?.() || { will_warn: false };
      if (st.will_warn) {
        const okToGo = await confirmDialog({
          title: t('profile.nameAgain'),
          message: `Vous avez déjà changé de nom il y a moins de 15 jours. ` +
                   `Vos camarades risquent de ne plus vous reconnaître. ` +
                   `Le compteur se réinitialise dans ${st.days_left} jour${st.days_left > 1 ? 's' : ''}.`,
          confirmLabel: t('profile.changeAnyway'),
          cancelLabel: 'Garder mon nom'
        });
        if (!okToGo) { nameInput.value = u.full_name || ''; paintMedia(); return; }
      }
    }
    if (!/^[a-z0-9._]{3,24}$/.test(username)) {
      toast(t('toast.badUsername'), 'err');
      userInput.focus();
      return;
    }

    save.disabled = true;
    save.textContent = (avatarFile || bannerFile) ? t('profile.uploading') : t('profile.saving');

    try {
      const updated = await api.updateProfile({
        full_name: nameInput.value.trim(),
        username,
        bio: bioInput.value.trim(),
        faculty: facSelect.value,
        pronouns: pronounInput.value.trim() || null,
        website: siteInput.value.trim() || null,
        github: githubInput.value.trim() || null,
        linkedin: linkedinInput.value.trim() || null,
        is_private: priv.classList.contains('on'),
        ...(avatarPreview === null && u.avatar_url ? { avatar_url: null } : {}),
        ...(bannerPreview === null && u.banner_url ? { banner_url: null } : {})
      }, { avatarFile, bannerFile });

      m.close();
      toast(t('profile.updated'), 'ok');
      // re-read from what the database actually stored, not from the
      // form — if a trigger normalised something, we show the truth
      Object.assign(u, updated, { isMe: true, private: !!updated.is_private });
      cachePeople(updated);
      render(u);
    } catch (err) {
      save.disabled = false;
      save.textContent = t('action.save');
      // Report what actually happened. The old catch-all said
      // "rien n'a été modifié" for every failure — including cases
      // where the user HAD changed something — which is why the
      // button looked like it was lying.
      // One special case worth naming, then the shared formatter.
      // Everything else used to fall through to `Échec: ${raw}`,
      // which put a library's English error inside a French UI.
      const raw = err?.message || '';
      const msg = /duplicate|unique|23505/i.test(raw)
        ? t('profile.usernameTaken')
        : errorText(err);
      console.error('[koliya] profile save failed', err);
      toast(msg, { kind: 'err', duration: 7000 });
    }
  }

  setTimeout(() => nameInput.focus(), 90);
}

/* ------------------------------------------------------------
   RENDER
   ------------------------------------------------------------ */

/** Write a stat without re-rendering the whole header. */
function setStat(sel, value) {
  const node = $(sel);
  if (node) node.textContent = compact(value || 0);
}

/**
 * Re-read followers / following / posts from the database.
 * Called after any action that can change them, so the numbers on
 * screen are the numbers in Postgres — not an optimistic guess that
 * nothing ever verified.
 */
export async function syncCounts(u) {
  if (!u?.id || !api?.getProfile) return;
  try {
    const fresh = await api.getProfile(u.username);
    if (!fresh) return;
    u.followers = fresh.followers;
    u.following = fresh.following;
    u.posts = fresh.posts;
    u.followState = fresh.followState;
    setStat('#stFollowers', fresh.followers);
    setStat('#stFollowing', fresh.following);
    setStat('#stPosts', fresh.posts);
  } catch { /* leave the optimistic value rather than blanking it */ }
}

/** Top-10 students carry their standing on the profile. */
async function paintRank(u) {
  if (!u.isMe) return;
  const host = $('#pfRank');
  if (!host) return;
  const rank = await myRank('faculty');
  const badge = rankBadge(rank);
  if (badge) host.innerHTML = `<span class="rank-badge ${badge.tone}">${icon(badge.icon, { size: 11 })} ${esc(badge.label)}</span>`;
}

function syncTabs(u) {
  for (const b of $$('.pf-tab')) b.classList.toggle('on', b.dataset.tab === activeTab);
  renderTabBody(u);
}

function render(u) {
  const host = $('#pfRoot');
  if (!host) return;

  host.innerHTML = `
    ${headerMarkup(u)}
    <div class="sub-tabs blur-bar pf-tabs">
      ${TABS.map(t => `<button class="sub-tab pf-tab${t.id === activeTab ? ' on' : ''}" data-tab="${t.id}">
        ${icon(t.icon, { size: 15 })} ${t.label}</button>`).join('')}
    </div>
    <div id="pfBody"></div>`;

  renderTabBody(u);
  wireActions(u);
  wireScroll(u);
  paintRank(u);

  for (const b of $$('.pf-tab')) {
    on(b, 'click', () => { activeTab = b.dataset.tab; syncTabs(u); });
  }

  requestAnimationFrame(() => {
    countUp($('#stPosts'), u.posts || 0);
    countUp($('#stFollowers'), u.followers || 0);
    countUp($('#stFollowing'), u.following || 0);
  });
}

export function initProfile(mountFn) {
  route('profile', async (username) => {
    const host = mountFn();
    if (!host) return;
    host.closest('.view')?.classList.remove('full');
    host.innerHTML = `<div id="pfRoot">${skeletonList(3)}</div>`;

    let u = null;
    try {
      u = await loadProfile(username);
    } catch (err) {
      const root = $('#pfRoot');
      root.innerHTML = '';
      root.append(emptyState({
        icon: I.user, title: t('profile.unavailable'),
        text: err?.message === 'not-connected' ? t('profile.notConnected') : errorText(err),
        action: { label: t('action.retry'), onClick: () => location.reload() }
      }));
      return;
    }
    if (!u) {
      const root = $('#pfRoot');
      root.innerHTML = '';
      root.append(emptyState({
        icon: I.user, title: t('profile.notFound'),
        text: t('profile.noStudent', { name: username || '' }),
        action: { label: t('profile.backToFeed'), onClick: () => go('feed') }
      }));
      return;
    }
    viewing = u;
    activeTab = 'posts';
    render(u);
  });
}
