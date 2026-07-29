#!/usr/bin/env python3
"""
patch_v12_web.py — re-apply the V12 web changes.

Companion to koliya-apk/patch_v12.py (which does the Java side).

WHY THIS IS A SCRIPT
These edits have now been lost to a workspace rollback three times, and
hand-redoing them burns most of a turn each time. One command instead.
Idempotent: running it twice changes nothing.

WHAT IT DOES
  1. auth_sm.js   hand the JWT to the Android service (AndroidSync.setToken)
                  -> the fix for "streak notifications arrive, messages do not"
  2. api_sm.js    fetch student_card; stop swallowing follow-notify errors
  3. profile_sm.js show the student card; translate "Niv." and "Privé"
  4. layout_sm.css style for the card badge
  5. campus_sm.js Explore leaves the campus tab strip (search only)
  6. index_sm.html Campus tab links straight to #/events
  7. notify_sm.js  the in-app banner ALSO posts a system notification
  8. i18n          profile.card / profile.cardTip in all three languages
"""
import os
import re
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


# ------------------------------------------------------------ 1. auth_sm
def auth(s):
    if 'pushTokenToNative' in s:
        return None
    old = """  cached = { token, at: Date.now() };
  if (token) {
    session.save({
      token,
      userId: session.userId || me.id,
      expiresAt: Date.now() + TOKEN_TTL
    });
  }
  return token;
}

export function clearToken() { cached = { token: null, at: 0 }; }"""
    if old not in s:
        sys.exit('auth_sm: getToken block not found')
    return s.replace(old, """  cached = { token, at: Date.now() };
  if (token) {
    session.save({
      token,
      userId: session.userId || me.id,
      expiresAt: Date.now() + TOKEN_TTL
    });
  }
  pushTokenToNative(token);
  return token;
}

/**
 * Give the APK's background poller the token we just fetched.
 *
 * WHY THIS EXISTS — the fix for "streak notifications arrive but
 * message ones never do".
 *
 * The streak reminder is woken by WorkManager and posts locally: no
 * network, no auth, so it always worked. The message poller had to
 * authenticate itself first, and step one was reading the session
 * cookie with CookieManager.getCookie() — which returns null for an
 * httpOnly + SameSite cookie on many WebView builds. The service then
 * got NOT_SIGNED_IN and went silent, with nothing visible anywhere.
 * Same scheduler, same service; only the auth path differed.
 *
 * The page already holds a valid token here, so it simply hands it
 * over. No-op in a browser: window.AndroidSync does not exist.
 */
function pushTokenToNative(token) {
  try {
    const s = typeof window !== 'undefined' && window.AndroidSync;
    if (!s?.setToken) return;
    s.setToken(token || '', String(Date.now() + TOKEN_TTL));
  } catch { /* a bridge failure must never break signing in */ }
}

export function clearToken() {
  cached = { token: null, at: 0 };
  // Signing out has to reach the service, or it keeps polling with a
  // token for an account nobody is signed into any more.
  pushTokenToNative(null);
}""")


# ------------------------------------------------------------- 2. api_sm
def api(s):
    if 'student_card' in s and 'notification de suivi' in s:
        return None
    out = s
    old_cols = ("const PROFILE_COLS =\n  'id,username,full_name,faculty,avatar_url,"
                "banner_url,bio,xp,streak,role,status,is_private,last_seen,website,"
                "github,linkedin,pronouns';")
    if old_cols in out:
        out = out.replace(old_cols, """// student_card is included on purpose: it is the number printed on the
// physical university card and what every student signs in with. Showing
// it proves the account belongs to a real enrolled student rather than an
// outsider. Verified in PostgreSQL that RLS lets one student read
// another's — it is not private data here.
const PROFILE_COLS =
  'id,username,full_name,faculty,avatar_url,banner_url,bio,xp,streak,role,status,is_private,last_seen,website,github,linkedin,pronouns,student_card';""")

    old_catch = """    await db.insert('notifications',
      { user_id: userId, actor_id: myId(), kind: next === 'requested' ? 'request' : 'follow' })
      .catch(() => {});"""
    if old_catch in out:
        out = out.replace(old_catch, """    // NOT .catch(() => {}).
    //
    // A swallowed error here is invisible: the follow succeeds, no
    // notification row is written, and nobody ever learns why the other
    // person was never told. Reported as "follow notifications still
    // show nothing". Log it loudly; the follow itself already succeeded,
    // so this must not throw.
    try {
      await db.insert('notifications', {
        user_id: userId,
        actor_id: myId(),
        kind: next === 'requested' ? 'request' : 'follow'
      });
    } catch (e) {
      console.error('[koliya] notification de suivi non écrite:', e?.message || e);
    }""")
    return out if out != s else None


# --------------------------------------------------------- 3. profile_sm
def profile(s):
    if 'pf-card' in s:
        return None
    out = s
    a = '      <span class="pf-level">Niv. ${lv.level}</span>'
    if a in out:
        out = out.replace(a, "      <span class=\"pf-level\">${esc(t('hub.levelShort', { n: lv.level }))}</span>")
    b = "${u.private ? `<span class=\"pill\">${icon('lock',{size:12})} Privé</span>` : ''}"
    if b in out:
        out = out.replace(b, "${u.private ? `<span class=\"pill\">${icon('lock',{size:12})} ${esc(t('profile.private'))}</span>` : ''}")
    c = ('    <div class="t-sm t-dim"><span class="handle">@${esc(u.username)}</span> '
         "· ${esc(u.faculty || '')}</div>")
    if c not in out:
        sys.exit('profile_sm: identity line not found')
    return out.replace(c, c + '''
    ${u.student_card ? `<div class="pf-card" data-tip="${esc(t('profile.cardTip'))}">
      ${icon('graduation', { size: 13 })}
      <span class="pf-card-label">${esc(t('profile.card'))}</span>
      <span class="pf-card-num">${esc(u.student_card)}</span>
    </div>` : ''}''')


# ------------------------------------------------------------- 4. layout
def layout(s):
    if 'pf-card-num' in s:
        return None
    a = ('.pf-identity { padding: var(--s4); display: flex; flex-direction: column; '
         'gap: var(--s2); }\n.pf-bio { font-size: var(--fs-md); line-height: 1.55; '
         'margin-top: var(--s1); }')
    if a not in s:
        sys.exit('layout: .pf-identity not found')
    return s.replace(a, a + '''

/* STUDENT CARD — the number printed on the physical university card.
   Shown on every profile: it is what proves the account belongs to a
   real enrolled student, which is the whole premise of a campus-only
   network. */
.pf-card {
  align-self: flex-start;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 3px var(--s3);
  border: 1px solid color-mix(in srgb, var(--brand) 28%, var(--border));
  border-radius: var(--r-full);
  background: color-mix(in srgb, var(--brand) 8%, transparent);
  font-size: var(--fs-xs);
  line-height: 1.6;
}
.pf-card svg { width: 13px; height: 13px; flex-shrink: 0; color: var(--brand-on-tint); }
.pf-card-label { color: var(--text-3); }
.pf-card-num {
  font-weight: 700;
  color: var(--brand-on-tint);
  font-variant-numeric: tabular-nums;
  /* "CS-042" beside Arabic text gets dragged to the wrong end by the
     bidi algorithm without this. */
  direction: ltr;
  unicode-bidi: isolate;
}''')


# ------------------------------------------------------------- 5. campus
def campus(s):
    if "CAMPUS_TABS = ['events'" in s:
        return None
    out = s
    a = "const CAMPUS_TABS = ['explore', 'events', 'qa', 'channels', 'saved'];"
    if a in out:
        out = out.replace(a, """// Explore is NOT in this list any more.
//
// V9 put all five discovery screens behind one strip because the phone
// had no way into Events or Q&A at all. But Explore is search — you go
// there to look something up, not to browse the campus — so the strip
// appeared above a search box it had nothing to do with. Explore is now
// plain search; Campus owns the four campus screens.
const CAMPUS_TABS = ['events', 'qa', 'channels', 'saved'];""")
    b = """const campusTabs = () => ([
  { id: 'explore',  label: t('nav.explore'),  icon: 'users' },
  { id: 'events',   label: t('nav.events'),   icon: 'calendar' },"""
    if b in out:
        out = out.replace(b, """const campusTabs = () => ([
  { id: 'events',   label: t('nav.events'),   icon: 'calendar' },""")
    c = "    ${tabStrip(name)}"
    if c in out:
        out = out.replace(c, "    ${name === 'explore' ? '' : tabStrip(name)}")
    return out if out != s else None


# --------------------------------------------------------------- 6. index
def index(s):
    a = '<a class="nav-item primary nav-phone" href="#/explore/events" data-nav="campus">'
    if a not in s:
        return None
    return s.replace(a, '<a class="nav-item primary nav-phone" href="#/events" data-nav="campus">')


# -------------------------------------------------------------- 7. notify
def notify(s):
    if 'AND put it in the system shade' in s:
        return None
    a = """    emit('notify:inapp', { kind: 'message', from });"""
    if a not in s:
        return None
    return s.replace(a, a + """

    // AND put it in the system shade.
    //
    // You asked for the little white bubble to be "connected with the
    // system notification". The banner alone dies with the toast, so a
    // student who looks away for ten seconds misses it entirely and has
    // nothing to come back to. notify() is a no-op without permission,
    // so this never double-fires where the browser has refused — the
    // banner above is still the fallback there.
    notify({
      title: who, body,
      tag: `koliya-dm-${from}`,
      icon: avatar,
      url: `#/messages/${from}`
    });""")


# ---------------------------------------------------------------- 8. i18n
def i18n(s):
    if "'profile.cardTip'" in s:
        return None
    reps = [
        ("    'profile.edit': 'Edit profile', 'profile.posts': 'posts',",
         "    'profile.edit': 'Edit profile', 'profile.posts': 'posts',\n"
         "    'profile.card': 'Student card',\n"
         "    'profile.cardTip': 'The number printed on the university card',"),
        ("    'profile.edit': 'Modifier le profil', 'profile.posts': 'publications',",
         "    'profile.edit': 'Modifier le profil', 'profile.posts': 'publications',\n"
         "    'profile.card': 'Carte étudiant',\n"
         "    'profile.cardTip': 'Le numéro imprimé sur la carte universitaire',"),
        ("    'profile.edit': 'تعديل الحساب', 'profile.posts': 'منشور',",
         "    'profile.edit': 'تعديل الحساب', 'profile.posts': 'منشور',\n"
         "    'profile.card': 'بطاقة الطالب',\n"
         "    'profile.cardTip': 'الرقم المطبوع على البطاقة الجامعية',"),
    ]
    out = s
    for a, b in reps:
        if a not in out:
            sys.exit('i18n: anchor missing -> ' + a[:40])
        out = out.replace(a, b)
    return out


edit(P('js/core/auth_sm.js'), 'auth_sm (token handover)', auth)
edit(P('js/core/api_sm.js'), 'api_sm (student_card + follow errors)', api)
edit(P('js/features/profile_sm.js'), 'profile_sm (card + i18n)', profile)
edit(P('css/layout_sm.css'), 'layout_sm (card css)', layout)
edit(P('js/features/campus_sm.js'), 'campus_sm (explore out of strip)', campus)
edit(P('index_sm.html'), 'index (campus tab -> #/events)', index)
edit(P('js/core/notify_sm.js'), 'notify_sm (banner -> shade)', notify)
edit(P('js/core/i18n_sm.js'), 'i18n (profile.card)', i18n)

print('  patched: ' + (', '.join(done) or 'nothing'))
if skip:
    print('  already current: ' + ', '.join(skip))
