#!/usr/bin/env python3
"""
patch_v13_web.py — this round's fixes. Idempotent; run it after any
rollback instead of re-deriving the edits by hand.

  1. store_sm.js       per-ACCOUNT local keys — the bug where liking your
                       own post appeared to happen on every account
  2. profile_sm.js     private accounts hide followers/following;
                       "Remove follower" button; French strings out
  3. api_sm.js         removeFollower()
  4. notifications_sm  the bell only ever counted at boot; French out
  5. layout_sm.css     locked-stat + people-row styling
  6. i18n              the new keys, three languages
"""
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
P = lambda *a: os.path.join(ROOT, 'public', *a)
done, skip = [], []


def edit(path, label, fn):
    with open(path, encoding='utf-8') as f:
        before = f.read()
    after = fn(before)
    if after is None:
        skip.append(label)
        return
    with open(path, 'w', encoding='utf-8') as f:
        f.write(after)
    done.append(label)


# ------------------------------------------------- 1. per-account store
def store(s):
    if 'currentScopeId' in s:
        return None
    old = """/** Namespaced sub-store, so features never collide on key names. */
export function scoped(namespace) {
  const p = namespace + ':';
  return {
    get:    (k, f) => read(p + k, f),
    set:    (k, v) => write(p + k, v),
    remove: k => remove(p + k),
    keys:   () => backend.keys().filter(k => k.startsWith(p)).map(k => k.slice(p.length)),
    clear:  () => backend.keys().filter(k => k.startsWith(p)).forEach(backend.remove)
  };
}"""
    if old not in s:
        sys.exit('store_sm: scoped() not in the expected shape')
    return s.replace(old, """/**
 * Namespaced sub-store, so features never collide on key names.
 *
 * THE ACCOUNT-BLEED BUG
 * The prefix used to be just `namespace + ':'` — no account in it. Every
 * signed-in user on the same device therefore shared ONE set of local
 * keys, so liking your own post appeared to happen on every account:
 * the liked marks, seen stories, quest progress, chat prefs and the
 * notify marker were all written to the same place and read back by
 * whoever signed in next.
 *
 * The key now carries the user id, so two accounts on one phone cannot
 * see each other's local state. Signed out, it falls back to `anon`.
 *
 * The id is read at CALL time, not when scoped() runs: every feature
 * calls scoped() at module load, long before sign-in resolves.
 * Capturing it once would pin every store to `anon` for the whole
 * session — the same "frozen at import time" trap that froze the
 * language in thirteen other places.
 */
function currentScopeId() {
  try {
    return (_state.me?.id) || read(KEYS.ME)?.id || read(KEYS.SESSION)?.userId || 'anon';
  } catch {
    return 'anon';
  }
}

export function scoped(namespace) {
  const prefix = () => `${namespace}:${currentScopeId()}:`;
  return {
    get:    (k, f) => read(prefix() + k, f),
    set:    (k, v) => write(prefix() + k, v),
    remove: k => remove(prefix() + k),
    keys:   () => {
      const p = prefix();
      return backend.keys().filter(k => k.startsWith(p)).map(k => k.slice(p.length));
    },
    clear:  () => {
      const p = prefix();
      backend.keys().filter(k => k.startsWith(p)).forEach(backend.remove);
    }
  };
}""")


# ------------------------------------------------------ 2. profile page
def profile(s):
    if 'graphHidden' in s:
        return None
    out = s

    old = """async function openPeopleList(kind, u) {
  const list = el('div', { class: 'col g3' });
  list.innerHTML = skeletonList(3, 'conv');
  modal({ title: kind === 'followers' ? t('profile.followers') : t('profile.following'), body: list });"""
    if old not in out:
        sys.exit('profile_sm: openPeopleList not in the expected shape')
    out = out.replace(old, """/** True when this account's social graph must stay hidden from me. */
function graphHidden(u) {
  return !!u.private && !u.isMe && u.followState !== 'following';
}

async function openPeopleList(kind, u) {
  // A private account hid its POSTS but not its followers: the counts
  // were clickable and the modal listed every name. That defeats the
  // point of a private account, so it is gated on the same condition
  // the post list already uses.
  if (graphHidden(u)) {
    const box = el('div', { class: 'col g3' });
    box.append(emptyState({
      icon: I.lock,
      title: t('profile.privateTitle'),
      text: t('profile.privateList')
    }));
    modal({ title: kind === 'followers' ? t('profile.followers') : t('profile.following'), body: box });
    return;
  }

  const list = el('div', { class: 'col g3' });
  list.innerHTML = skeletonList(3, 'conv');
  modal({ title: kind === 'followers' ? t('profile.followers') : t('profile.following'), body: list });""")

    old2 = """  for (const b of $$('.pf-stat[data-stat]')) {
    on(b, 'click', () => {
      const kind = b.dataset.stat;
      if (kind === 'posts') { activeTab = 'posts'; syncTabs(u); return; }
      openPeopleList(kind, u);"""
    if old2 in out:
        out = out.replace(old2, """  // On a private account the two people counts are not buttons at all.
  // Leaving them clickable and then showing a lock reads as broken.
  if (graphHidden(u)) {
    for (const b of $$('.pf-stat[data-stat="followers"], .pf-stat[data-stat="following"]')) {
      b.setAttribute('disabled', '');
      b.classList.add('is-locked');
      b.setAttribute('data-tip', t('profile.privateList'));
    }
  }

  for (const b of $$('.pf-stat[data-stat]')) {
    on(b, 'click', () => {
      const kind = b.dataset.stat;
      if (kind === 'posts') { activeTab = 'posts'; syncTabs(u); return; }
      if (graphHidden(u) && (kind === 'followers' || kind === 'following')) return;
      openPeopleList(kind, u);""")

    old3 = "      text: `Suivez ${u.full_name} pour voir ses publications.`"
    if old3 in out:
        out = out.replace(old3, "      text: t('profile.privateBody', { name: u.full_name })")

    # The stat labels are lowercase on purpose ("7 followers"), so
    # reusing them as a modal heading rendered a lowercase title.
    out = out.replace(
        "kind === 'followers' ? t('profile.followers') : t('profile.following')",
        "kind === 'followers' ? t('profile.followersTitle') : t('profile.followingTitle')")

    # Remove-follower button.
    old4 = """  list.innerHTML = rows.length
    ? rows.map(p => `
      <a class="row g3" href="#/profile/${esc(p.username)}">
        ${p.avatar_url
          ? `<span class="av sm"><img src="${esc(safeUrl(p.avatar_url))}" alt=""></span>`
          : `<span class="av sm" style="background:${avatarColor(p.id)}">${esc(initials(p.full_name))}</span>`}
        <div class="grow" style="min-width:0"><div class="t-sm t-bold truncate">${esc(p.full_name)}</div>
        <div class="t-xs t-dim"><span class="handle">@${esc(p.username)}</span> · ${esc(p.faculty || '')}</div></div>
      </a>`).join('')
    : `<div class="tg-empty">${icon('user', { size: 22 })}<span>${esc(t('profile.noPeople'))}</span></div>`;
}"""
    if old4 not in out:
        sys.exit('profile_sm: people list markup not in the expected shape')
    out = out.replace(old4, """  // "Remove" only on MY OWN followers list: it deletes THEIR follow of
  // me, which is the only way to get somebody off a private account
  // once they have been let in. Meaningless on anyone else's list, or
  // on a list of people I follow.
  const canRemove = u.isMe && kind === 'followers';

  list.innerHTML = rows.length
    ? rows.map(p => `
      <div class="row g3 people-row">
        <a class="row g3 grow" style="min-width:0" href="#/profile/${esc(p.username)}">
          ${p.avatar_url
            ? `<span class="av sm"><img src="${esc(safeUrl(p.avatar_url))}" alt=""></span>`
            : `<span class="av sm" style="background:${avatarColor(p.id)}">${esc(initials(p.full_name))}</span>`}
          <div class="grow" style="min-width:0"><div class="t-sm t-bold truncate">${esc(p.full_name)}</div>
          <div class="t-xs t-dim"><span class="handle">@${esc(p.username)}</span> · ${esc(p.faculty || '')}</div></div>
        </a>
        ${canRemove ? `<button class="btn btn-outline btn-sm" data-remove="${esc(p.id)}">
          ${esc(t('profile.removeFollower'))}</button>` : ''}
      </div>`).join('')
    : `<div class="tg-empty">${icon('user', { size: 22 })}<span>${esc(t('profile.noPeople'))}</span></div>`;

  if (!canRemove) return;

  on(list, 'click', async e => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    e.preventDefault();

    const id = btn.dataset.remove;
    const who = rows.find(r => String(r.id) === String(id));
    if (!await confirmDialog({
      title: t('profile.removeFollowerQ', { name: who?.full_name || '' }),
      message: t('profile.removeFollowerWhy'),
      confirmLabel: t('profile.removeFollower'),
      danger: true
    })) return;

    btn.disabled = true;
    const row = btn.closest('.people-row');
    try {
      await api.removeFollower(id);
      row?.remove();
      // The count on the page behind the modal is now stale.
      const n = $('#stFollowers');
      if (n) n.textContent = Math.max(0, (Number(n.textContent) || 1) - 1);
      toast(t('profile.removedFollower'), 'ok');
    } catch (err) {
      btn.disabled = false;
      toast(errorText(err), 'err');
    }
  });
}""")
    return out


# ---------------------------------------------------------- 3. api_sm
def api(s):
    if 'removeFollower' in s:
        return None
    a = "  async followers(userId) {"
    if a not in s:
        sys.exit('api_sm: followers() not found')
    return s.replace(a, """  /**
   * Remove somebody who follows ME.
   *
   * Not the same as unfollowing: this deletes THEIR follow of me, the
   * only way off a private account once you have let someone in. RLS
   * allows it — follows_delete covers followee_id = auth.user_id().
   */
  async removeFollower(userId) {
    await db.remove('follows', {
      follower_id: `eq.${userId}`,
      followee_id: `eq.${myId()}`
    });
  },

  async followers(userId) {""")


# -------------------------------------------------- 4. notifications
def notifs(s):
    if "onEvent('notify:alerts'" in s:
        return None
    out = s

    a = "import { me, setState, state, scoped } from '../core/store_sm.js';"
    if a in out:
        out = out.replace(a, "import { me, setState, state, scoped, on as onEvent } from '../core/store_sm.js';")

    b = """  if (g.actors.length === 2) return `${esc(first)} et ${esc(person(g.actors[1]).full_name.split(' ')[0])}`;
  return `${esc(first)} et ${g.actors.length - 1} autres`;"""
    if b in out:
        out = out.replace(b, """  if (g.actors.length === 2) {
    return t('notif.twoPeople', {
      a: esc(first),
      b: esc(person(g.actors[1]).full_name.split(' ')[0])
    });
  }
  return t('notif.manyPeople', { a: esc(first), n: g.actors.length - 1 });""")

    c = "export function initNotifications(mountFn) {"
    if c not in out:
        sys.exit('notifications_sm: initNotifications not found')
    out = out.replace(c, """export function initNotifications(mountFn) {

  // THE BELL ONLY EVER COUNTED AT BOOT.
  //
  // refreshNotificationBadge() was called once from app_sm.js and never
  // again, so a like or a follow arriving later changed nothing on
  // screen — the bell kept whatever number it had at startup. Reported
  // as "the notification page isn't showing the numbers when someone
  // likes or follows".
  //
  // core/notify_sm.js already polls pending_alerts() every 20s and
  // emits this. Both calls are cheap and guarded.
  onEvent('notify:alerts', () => {
    refreshNotificationBadge().catch(() => {});
    // Repaint the list too, but only when it is actually on screen.
    if ($('#notifList')) load().then(rows => { items = rows; render(); });
  });""")
    return out


# --------------------------------------------------------- 5. layout
def layout(s):
    if '.pf-stat.is-locked' in s:
        return None
    a = '.pf-stats { display: flex; gap: var(--s5); margin-top: var(--s2); flex-wrap: wrap; }'
    if a not in s:
        sys.exit('layout: .pf-stats not found')
    return s.replace(a, a + """

/* A private account's follower counts are not clickable, and must not
   pretend to be: no pointer, no hover lift. The number still shows —
   Instagram shows "142 followers" on a locked profile and hides the
   list, which is the honest version. */
.pf-stat.is-locked { cursor: default; opacity: .75; }
.pf-stat.is-locked:hover { background: none; transform: none; }

/* One row of the followers/following modal, with room for Remove. */
.people-row { align-items: center; gap: var(--s3); }
.people-row > a { text-decoration: none; color: inherit; }
.people-row [data-remove] { flex-shrink: 0; }""")


# ----------------------------------------------------------- 6. i18n
def i18n(s):
    if "'profile.removeFollower'" in s:
        return None
    reps = [
        ("    'profile.card': 'Student card',",
         "    'profile.card': 'Student card',\n"
         "    'profile.privateList': 'This account is private. Follow it to see who follows it.',\n"
         "    'profile.privateBody': 'Follow {name} to see their posts.',\n"
         "    'profile.removeFollower': 'Remove',\n"
         "    'profile.removeFollowerQ': 'Remove {name}?',\n"
         "    'profile.removeFollowerWhy': 'They will stop following you and lose access to your posts. They are not told.',\n"
         "    'profile.removedFollower': 'Follower removed',\n"
         "    'profile.followersTitle': 'Followers',\n"
         "    'profile.followingTitle': 'Following',\n"
         "    'notif.twoPeople': '{a} and {b}',\n"
         "    'notif.manyPeople': '{a} and {n} others',"),
        ("    'profile.card': 'Carte étudiant',",
         "    'profile.card': 'Carte étudiant',\n"
         "    'profile.privateList': 'Ce compte est privé. Abonnez-vous pour voir ses abonnés.',\n"
         "    'profile.privateBody': 'Suivez {name} pour voir ses publications.',\n"
         "    'profile.removeFollower': 'Retirer',\n"
         "    'profile.removeFollowerQ': 'Retirer {name} ?',\n"
         "    'profile.removeFollowerWhy': 'Cette personne ne vous suivra plus et perdra l\u2019accès à vos publications. Elle n\u2019est pas prévenue.',\n"
         "    'profile.removedFollower': 'Abonné retiré',\n"
         "    'profile.followersTitle': 'Abonnés',\n"
         "    'profile.followingTitle': 'Abonnements',\n"
         "    'notif.twoPeople': '{a} et {b}',\n"
         "    'notif.manyPeople': '{a} et {n} autres',"),
        ("    'profile.card': 'بطاقة الطالب',",
         "    'profile.card': 'بطاقة الطالب',\n"
         "    'profile.privateList': 'هذا الحساب خاص. تابعه لترى متابعيه.',\n"
         "    'profile.privateBody': 'تابع {name} لرؤية منشوراته.',\n"
         "    'profile.removeFollower': 'إزالة',\n"
         "    'profile.removeFollowerQ': 'إزالة {name}؟',\n"
         "    'profile.removeFollowerWhy': 'لن يعود يتابعك وسيفقد الوصول إلى منشوراتك. لن يصله إشعار بذلك.',\n"
         "    'profile.removedFollower': 'أُزيل المتابع',\n"
         "    'profile.followersTitle': 'المتابِعون',\n"
         "    'profile.followingTitle': 'يتابعهم',\n"
         "    'notif.twoPeople': '{a} و{b}',\n"
         "    'notif.manyPeople': '{a} و{n} آخرون',"),
    ]
    out = s
    for a, b in reps:
        if a not in out:
            sys.exit('i18n: anchor missing -> ' + a[:40])
        out = out.replace(a, b)
    return out


def notify_gate(s):
    """
    checkAlerts() and startWatching() both began with `if (!canNotify())
    return`, so the WHOLE alert pipeline was dead unless the student had
    granted system notification permission: no bell count, no in-app
    banner, no list refresh. Anyone who tapped "not now" once — and every
    WebView, where the permission reads 'default' forever — saw the bell
    frozen at boot. Only the shade notification needs permission, and
    notify() already no-ops without it.
    """
    if 'NOT `if (!canNotify()) return`' in s:
        return None
    out = s
    a1 = """async function checkAlerts() {
  if (!canNotify() || !me.id) return;"""
    if a1 in out:
        out = out.replace(a1, """async function checkAlerts() {
  // NOT `if (!canNotify()) return`.
  //
  // That gate meant the whole alert pipeline was dead unless the student
  // had granted SYSTEM notification permission: no bell count, no in-app
  // banner, no list refresh. The poll now always runs; only the SHADE
  // notification is permission-gated, and notify() no-ops without it.
  if (!me.id) return;""")
    a2 = """export function startWatching() {
  if (watching || !canNotify()) return;"""
    if a2 in out:
        out = out.replace(a2, """export function startWatching() {
  // Same reasoning as checkAlerts(): the poller feeds the bell count and
  // the in-app banner, neither of which needs system permission.
  if (watching) return;""")
    a3 = "  if (permission() !== 'default') { if (canNotify()) startWatching(); return; }"
    if a3 in out:
        out = out.replace(a3, "  if (permission() !== 'default') { startWatching(); return; }")
    a4 = "  if (canNotify()) startWatching();"
    if a4 in out:
        out = out.replace(a4, """  // Always: the poller feeds the bell count and the in-app banner too,
  // and those work with no system permission at all.
  startWatching();""")
    return out if out != s else None


edit(P('js/core/notify_sm.js'), 'notify_sm (poll without permission)', notify_gate)
edit(P('js/core/store_sm.js'), 'store_sm (per-account keys)', store)
edit(P('js/features/profile_sm.js'), 'profile_sm (private + remove)', profile)
edit(P('js/core/api_sm.js'), 'api_sm (removeFollower)', api)
edit(P('js/features/notifications_sm.js'), 'notifications_sm (live badge)', notifs)
edit(P('css/layout_sm.css'), 'layout_sm (locked stats)', layout)
edit(P('js/core/i18n_sm.js'), 'i18n (new keys)', i18n)

print('  patched: ' + (', '.join(done) or 'nothing'))
if skip:
    print('  already current: ' + ', '.join(skip))
