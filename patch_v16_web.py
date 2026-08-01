#!/usr/bin/env python3
"""
V16 — three top-level chat sections + custom chat folders.

WHAT THE USER REPORTED
  1. "the event groups and channels have to be visible in the messages,
      they are not — when I click messages they are not visible"
  2. "there is no button to create chat folders, that's not right"
  3. "make the chat folders that are now in 3 main folders: channels
      when he actually joined channels — if he's not, there is no need
      to make it visible; same for events; and the main one is messages
      with its own folders and stuff"

WHAT WAS ACTUALLY WRONG (read, not assumed)
  messages_sm.js had ONE flat strip of seven buttons — all, requests,
  unread, pinned, study, muted, archived — and every one of them
  filtered `convs`, which loadConversations() fills from the `messages`
  table only. A channel is not in `messages`, so no filter could ever
  show one. openGroupThread() existed and worked, but the ONLY way to
  reach it was the URL #/messages/channel-7 or a click from Campus.
  The Messages screen itself had no path to a group chat at all.

  chatFolders() was a hardcoded array of five, AND chat_folders.folder
  carried CHECK (folder IN ('all','pinned','study','muted','archived')).
  So there was nowhere to put a "create folder" button and nowhere to
  store the result. Both are fixed in db/15_follow_notify_sm.sql.

THE SHAPE NOW
  Section tabs (top):   Messages · Channels · Events
    - Channels appears ONLY if my_group_chats() returns a channel
    - Events   appears ONLY if it returns an event
    - so a student who joined nothing sees exactly what they see today
  Folder strip (below): only inside Messages, and only its own folders,
    plus a + that creates a custom one.

Idempotent: every edit checks for its own marker first.
"""
import re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent
changed = []

def patch(path, old, new, tag, count=1):
    """Insert `new` in place of `old`, once.

    The marker is APPENDED to the replacement text as a comment rather
    than being assumed to appear inside it. My first version tested
    `if tag in s` while none of the replacements actually contained
    their tag, so re-running re-applied every edit — producing a second
    `let section = 'dm';` and a fatal duplicate-declaration
    SyntaxError. `node --check` does not catch it (module scope), and
    the app just failed to boot. Caught by running the script twice,
    which is the only reason it was found."""
    p = ROOT / path
    s = p.read_text()
    if tag in s:
        print(f"  = {path}: {tag} already present")
        return
    if old not in s:
        print(f"  ! {path}: anchor NOT FOUND for {tag}")
        sys.exit(1)
    # The marker goes in a REGISTRY comment at the end of the file, not
    # inline: appending it after the replacement inserted a comment
    # between two functions and broke the NEXT patch's anchor.
    s = s.replace(old, new, count)
    reg = "\n/* koliya-patch-applied: " + tag + " */\n" if path.endswith((".js", ".css")) \
          else "\n-- koliya-patch-applied: " + tag + "\n"
    p.write_text(s + reg)
    changed.append(f"{path}:{tag}")
    print(f"  + {path}: {tag}")


# ============================================================
# 1. messages_sm.js — state for the three sections
# ============================================================
patch("public/js/features/messages_sm.js",
"""let folder = 'all';        // active chat folder
let folders = {};          // peerId -> folder name""",
"""let folder = 'all';        // active chat folder
let folders = {};          // peerId -> folder name

/* THE THREE TOP-LEVEL SECTIONS.
   'dm' | 'channels' | 'events'. Not folders: a folder filters `convs`,
   which only ever holds rows from the `messages` table, so no folder
   could show a channel however it was named. */
let section = 'dm';
let groupChats = [];       // my_group_chats() — channels AND events
let customFolders = [];    // names created by this student""",
"V16_SECTION_STATE")


# ============================================================
# 2. chatFolders() — built-ins + custom, no more hardcoded five
# ============================================================
patch("public/js/features/messages_sm.js",
"""const chatFolders = () => ([
  { id: 'all',      label: 'Tous',     icon: 'message'  },
  { id: 'requests', label: 'Requests', icon: 'inbox'    },
  { id: 'unread',   label: 'Non lus',  icon: 'inbox'    },
  { id: 'pinned',   label: t('dm.pinnedFolder'), icon: 'pin'      },
  { id: 'study',    label: 'Études',   icon: 'graduation' },
  { id: 'muted',    label: 'Muets',    icon: 'mute'     },
  { id: 'archived', label: t('dm.archivedFolder'), icon: 'bookmark' }
]);""",
"""const chatFolders = () => ([
  { id: 'all',      label: 'Tous',     icon: 'message'  },
  { id: 'requests', label: 'Requests', icon: 'inbox'    },
  { id: 'unread',   label: 'Non lus',  icon: 'inbox'    },
  { id: 'pinned',   label: t('dm.pinnedFolder'), icon: 'pin'      },
  { id: 'study',    label: 'Études',   icon: 'graduation' },
  { id: 'muted',    label: 'Muets',    icon: 'mute'     },
  { id: 'archived', label: t('dm.archivedFolder'), icon: 'bookmark' },
  // Whatever this student made. `custom: true` so the strip can offer
  // Delete on them and not on the built-ins.
  ...customFolders.map(n => ({ id: n, label: n, icon: 'bookmark', custom: true }))
]);""",
"V16_CUSTOM_FOLDERS")


# ============================================================
# 3. the section tab bar + the + button, and a group-aware folder bar
# ============================================================
patch("public/js/features/messages_sm.js",
"""function folderBar() {
  return `<div class="chat-folders" id="chatFolders">""",
"""/* The three sections. Channels and Events are rendered ONLY when the
   student is actually in one — "if he's not, there is no need to make
   it visible". my_group_chats() returns [] for somebody who has joined
   nothing, so this collapses to a single Messages tab, which is what
   the screen looked like before. */
function sectionBar() {
  const chans  = groupChats.filter(g => g.kind === 'channel');
  const events = groupChats.filter(g => g.kind === 'event');
  const secs = [{ id: 'dm', label: t('dm.section.messages'), icon: 'message',
                  n: convs.reduce((a, c) => a + (c.unread || 0), 0) }];
  if (chans.length)  secs.push({ id: 'channels', label: t('dm.section.channels'),
                                 icon: 'hash', n: chans.length });
  if (events.length) secs.push({ id: 'events', label: t('dm.section.events'),
                                 icon: 'calendar', n: events.length });

  // One section and nothing else to switch to is not a choice; drawing
  // a single tab is chrome for its own sake.
  if (secs.length === 1) return '';

  return `<div class="chat-sections" id="chatSections" role="tablist">
    ${secs.map(s => `<button class="chat-section${s.id === section ? ' on' : ''}"
        data-section="${s.id}" role="tab" aria-selected="${s.id === section}"
        aria-label="${esc(s.label)}">
      ${icon(s.icon, { size: 15 })}<span class="cs-label">${esc(s.label)}</span>
      ${s.n ? `<span class="cf-count">${s.n}</span>` : ''}
    </button>`).join('')}
  </div>`;
}

function folderBar() {
  // Folders belong to the Messages section. A channel is not filed in
  // "Pinned" or "Muted" — those act on `convs`, which holds DMs only.
  if (section !== 'dm') return '';
  return `<div class="chat-folders" id="chatFolders">""",
"V16_SECTION_BAR")


# ============================================================
# 4. the + button at the end of the folder strip
# ============================================================
patch("public/js/features/messages_sm.js",
"""        </button>`;
    }).join('')}
  </div>`;
}

function wireFolders() {""",
"""        </button>`;
    }).join('')}
    <button class="chat-folder cf-add" id="cfAdd"
            data-tip="${esc(t('dm.newFolder'))}" aria-label="${esc(t('dm.newFolder'))}">
      ${icon('plus', { size: 14 })}
    </button>
  </div>`;
}

/* Create a folder. Named here rather than inline so the empty-state
   button can call the same thing. */
async function promptNewFolder() {
  const input = el('input', { class: 'input', maxlength: '24',
                              placeholder: t('dm.folderNamePh') });
  const box = el('div', { class: 'col g3' },
    el('div', { class: 't-sm t-dim' }, t('dm.newFolderWhy')), input);

  // modal() takes `footer`, NOT an `actions` array — I wrote `actions`
  // first and it silently rendered a dialog with no buttons at all,
  // because the option is simply ignored. Checked against
  // campus_sm.js openChannelComposer(), which is the same shape.
  const foot = el('div', { class: 'row g2' });
  const m = modal({ title: t('dm.newFolder'), body: box, footer: foot });

  const submit = async () => {
    const name = (input.value || '').trim();
    if (!name) { input.focus(); return; }
    try {
      const ok = await api.createFolder(name);
      if (!ok) { toast(t('dm.folderNameTaken'), 'err'); return; }
      customFolders = await api.listCustomFolders();
      folder = name;
      m.close();
      paintConvList();
      toast(t('dm.folderCreated', { folder: name }), 'ok');
    } catch (err) { toast(errorText(err), 'err'); }
  };

  foot.append(
    el('button', { class: 'btn btn-ghost', onclick: () => m.close() }, t('action.cancel')),
    el('button', { class: 'btn btn-primary', onclick: submit }, t('action.create'))
  );
  on(input, 'keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  setTimeout(() => input.focus(), 50);
}

function wireFolders() {""",
"V16_ADD_FOLDER_BTN")


# ============================================================
# 5. wire the + and the section tabs
# ============================================================
patch("public/js/features/messages_sm.js",
"""function wireFolders() {
  const bar = $('#chatFolders');
  if (!bar) return;
  on(bar, 'click', e => {
    const btn = e.target.closest('[data-folder]');
    if (!btn) return;
    folder = btn.dataset.folder;
    paintConvList();
  });
}""",
"""function wireFolders() {
  const secBar = $('#chatSections');
  if (secBar) {
    on(secBar, 'click', e => {
      const btn = e.target.closest('[data-section]');
      if (!btn) return;
      section = btn.dataset.section;
      paintConvList();
    });
  }

  const bar = $('#chatFolders');
  if (!bar) return;
  on(bar, 'click', e => {
    if (e.target.closest('#cfAdd')) { promptNewFolder(); return; }

    const btn = e.target.closest('[data-folder]');
    if (!btn) return;
    folder = btn.dataset.folder;
    paintConvList();
  });

  // Right-click a folder you made to delete it. Built-ins have no
  // menu — there is nothing to do to them.
  on(bar, 'contextmenu', e => {
    const btn = e.target.closest('[data-folder]');
    if (!btn) return;
    const name = btn.dataset.folder;
    if (!customFolders.includes(name)) return;
    e.preventDefault();
    contextMenu(e, [
      { title: name },
      { label: t('dm.deleteFolder'), icon: I.trash, danger: true, onClick: async () => {
          try {
            await api.deleteFolder(name);
            customFolders = customFolders.filter(x => x !== name);
            // Anything filed here is unfiled, not deleted.
            for (const k of Object.keys(folders)) if (folders[k] === name) delete folders[k];
            if (folder === name) folder = 'all';
            paintConvList();
            toast(t('dm.folderDeleted'), 'ok');
          } catch (err) { toast(errorText(err), 'err'); }
        } }
    ]);
  });
}""",
"V16_WIRE_SECTIONS")


# ============================================================
# 6. paintConvList — render channels/events when that section is open
# ============================================================
patch("public/js/features/messages_sm.js",
"""function paintConvList() {
  const box = $('#convScroll');
  if (!box) return;

  const bar = $('#chatFolders');
  if (bar) bar.outerHTML = folderBar();
  else box.insertAdjacentHTML('beforebegin', folderBar());
  wireFolders();

  if (folder === 'requests') { showingRequests = true; paintRequests(); return; }""",
"""/** One row in the Channels or Events list. */
function groupRow(g) {
  const isOpen = group && group.kind === g.kind && String(group.id) === String(g.id);
  const node = el('button', {
    class: 'conv' + (isOpen ? ' on' : ''),
    'data-group': `${g.kind}-${g.id}`,
    onclick: () => openGroupThread(g.kind, String(g.id))
  });

  node.append(
    el('div', { class: 'av', style: { background: 'var(--brand)' },
                html: icon(g.kind === 'event' ? 'calendar' : 'hash', { size: 16 }) }),
    el('div', { class: 'conv-body' },
      el('div', { class: 'conv-top' },
        el('span', { class: 'conv-name truncate' }, g.name || ''),
        g.is_private ? el('span', { class: 'conv-mark', html: icon('lock', { size: 12 }) }) : null,
        el('span', { class: 'conv-time' }, g.last_at ? timeAgo(g.last_at) : '')
      ),
      el('div', { class: 'row g2' },
        el('span', { class: 'conv-last truncate grow' },
          g.last_text || t('dm.groupMembers', { n: g.members || 0 })),
        // Your rank in the channel, so "why can't I post here" has a
        // visible answer before you try.
        g.role && g.role !== 'member'
          ? el('span', { class: 'pill xs' }, t('channels.role.' + g.role))
          : null
      )
    )
  );
  return node;
}

/** Channels / Events. Separate from the DM list: nothing here is a peer. */
function paintGroupList() {
  const box = $('#convScroll');
  if (!box) return;
  box.innerHTML = '';

  const want = section === 'channels' ? 'channel' : 'event';
  const rows = groupChats.filter(g => g.kind === want);

  if (!rows.length) {
    // Reachable only in the instant between leaving your last channel
    // and the tab disappearing.
    box.append(emptyState({
      icon: want === 'event' ? I.calendar : I.hash,
      title: t(want === 'event' ? 'dm.noEvents' : 'dm.noChannels'),
      text: t(want === 'event' ? 'dm.noEventsWhy' : 'dm.noChannelsWhy'),
      action: { label: t('nav.campus'), onClick: () => go('campus') }
    }));
    return;
  }

  const frag = document.createDocumentFragment();
  rows.forEach(g => frag.append(groupRow(g)));
  box.append(frag);
}

function paintConvList() {
  const box = $('#convScroll');
  if (!box) return;

  // The section bar sits ABOVE the folder strip and is redrawn with it,
  // because switching sections changes which folders exist.
  const secBar = $('#chatSections');
  if (secBar) secBar.outerHTML = sectionBar() || '<div id="chatSections" hidden></div>';
  else box.insertAdjacentHTML('beforebegin', sectionBar());

  const bar = $('#chatFolders');
  if (bar) bar.outerHTML = folderBar() || '<div id="chatFolders" hidden></div>';
  else box.insertAdjacentHTML('beforebegin', folderBar());
  wireFolders();

  if (section !== 'dm') { showingRequests = false; paintGroupList(); return; }

  if (folder === 'requests') { showingRequests = true; paintRequests(); return; }""",
"V16_PAINT_GROUPS")


# ============================================================
# 7. load the group chats and custom folders with the conversations
# ============================================================
patch("public/js/features/messages_sm.js",
"""    const [rows, f, reqs] = await Promise.all([
      loadConversations(),
      api?.listFolders  ? api.listFolders()  : Promise.resolve({}),
      api?.listRequests ? api.listRequests() : Promise.resolve([])
    ]);
    convs = rows;
    folders = f || {};
    requests = reqs || [];""",
"""    // .catch on each: a database that has not had
    // 15_follow_notify_sm.sql applied yet has no my_group_chats(), and
    // ONE missing RPC must not blank the entire conversation list.
    // Without this the screen showed "error loading" and no DMs at all.
    const [rows, f, reqs, groups, custom] = await Promise.all([
      loadConversations(),
      api?.listFolders  ? api.listFolders()  : Promise.resolve({}),
      api?.listRequests ? api.listRequests() : Promise.resolve([]),
      api?.myGroupChats ? api.myGroupChats().catch(() => []) : Promise.resolve([]),
      api?.listCustomFolders ? api.listCustomFolders().catch(() => []) : Promise.resolve([])
    ]);
    convs = rows;
    folders = f || {};
    requests = reqs || [];
    groupChats = groups || [];
    customFolders = custom || [];

    // The tab I am standing in just disappeared (left the last channel).
    if (section === 'channels' && !groupChats.some(g => g.kind === 'channel')) section = 'dm';
    if (section === 'events'   && !groupChats.some(g => g.kind === 'event'))   section = 'dm';""",
"V16_LOAD_GROUPS")


# ============================================================
# 8. convMenu used FOLDERS (undefined) — and now needs custom folders
# ============================================================
patch("public/js/features/messages_sm.js",
"""    ...FOLDERS.filter(f => f.id !== 'unread').map(f => ({""",
"""    // WAS `FOLDERS` — a bare identifier that does not exist anywhere in
    // this file (the array was renamed to the chatFolders() function).
    // Right-clicking a conversation therefore threw
    // "FOLDERS is not defined" and NO context menu opened at all, which
    // is why filing a chat by right-click never worked. Caught by
    // grepping for the identifier, not by any test.
    ...chatFolders().filter(f => f.id !== 'unread' && f.id !== 'requests').map(f => ({""",
"V16_FOLDERS_UNDEFINED")




# ============================================================
# 9. i18n — all three languages. The app has EN / FR / AR and a
#    missing key renders as the raw key, so all three or none.
# ============================================================
I18N = {
  "en": """    'dm.section.messages': 'Messages', 'dm.section.channels': 'Channels',
    'dm.section.events': 'Events',
    'dm.groupMembers': '{n} members',
    'dm.noChannels': 'No channels yet',
    'dm.noChannelsWhy': 'Join a channel in Campus and it shows up here.',
    'dm.noEvents': 'No event chats',
    'dm.noEventsWhy': 'Attend an event and its group chat appears here.',
    'dm.newFolder': 'New folder',
    'dm.newFolderWhy': 'Group conversations your own way. Right-click a chat to file it.',
    'dm.folderNamePh': 'Folder name',
    'dm.folderCreated': 'Folder “{folder}” created',
    'dm.folderNameTaken': 'That name is not available',
    'dm.deleteFolder': 'Delete folder',
    'dm.folderDeleted': 'Folder deleted — the conversations are still there',
    'notif.acceptedYou': 'accepted your follow request',
    'channels.accepted': 'let you into the channel',
""",
  "fr": """    'dm.section.messages': 'Messages', 'dm.section.channels': 'Canaux',
    'dm.section.events': 'Événements',
    'dm.groupMembers': '{n} membres',
    'dm.noChannels': 'Aucun canal',
    'dm.noChannelsWhy': 'Rejoignez un canal dans Campus, il apparaîtra ici.',
    'dm.noEvents': 'Aucune discussion d’événement',
    'dm.noEventsWhy': 'Participez à un événement, sa discussion apparaîtra ici.',
    'dm.newFolder': 'Nouveau dossier',
    'dm.newFolderWhy': 'Classez vos conversations comme vous voulez. Clic droit sur une conversation pour la ranger.',
    'dm.folderNamePh': 'Nom du dossier',
    'dm.folderCreated': 'Dossier « {folder} » créé',
    'dm.folderNameTaken': 'Ce nom n’est pas disponible',
    'dm.deleteFolder': 'Supprimer le dossier',
    'dm.folderDeleted': 'Dossier supprimé — les conversations sont intactes',
    'notif.acceptedYou': 'a accepté votre demande',
    'channels.accepted': 'vous a admis dans le canal',
""",
  "ar": """    'dm.section.messages': 'الرسائل', 'dm.section.channels': 'القنوات',
    'dm.section.events': 'الفعاليات',
    'dm.groupMembers': '{n} عضوًا',
    'dm.noChannels': 'لا توجد قنوات',
    'dm.noChannelsWhy': 'انضم إلى قناة من الحرم الجامعي لتظهر هنا.',
    'dm.noEvents': 'لا توجد محادثات فعاليات',
    'dm.noEventsWhy': 'شارك في فعالية لتظهر محادثتها هنا.',
    'dm.newFolder': 'مجلد جديد',
    'dm.newFolderWhy': 'رتّب محادثاتك كما تحب. انقر بالزر الأيمن على محادثة لتصنيفها.',
    'dm.folderNamePh': 'اسم المجلد',
    'dm.folderCreated': 'تم إنشاء المجلد «{folder}»',
    'dm.folderNameTaken': 'هذا الاسم غير متاح',
    'dm.deleteFolder': 'حذف المجلد',
    'dm.folderDeleted': 'حُذف المجلد — المحادثات لم تُمس',
    'notif.acceptedYou': 'قَبِل طلب المتابعة',
    'channels.accepted': 'قَبِلك في القناة',
""",
}

ANCHORS = {
  "en": "    'dm.folder.all': 'All', 'dm.folder.unread': 'Unread', 'dm.folder.pinned': 'Pinned',",
  "fr": "    'dm.folder.all': 'Tous', 'dm.folder.unread': 'Non lus', 'dm.folder.pinned': 'Épinglés',",
  "ar": "    'dm.folder.all': 'الكل', 'dm.folder.unread': 'غير مقروء', 'dm.folder.pinned': 'مثبَّت',",
}

p = ROOT / "public/js/core/i18n_sm.js"
s = p.read_text()
if "'dm.section.channels'" in s:
    print("  = i18n: V16 keys already present")
else:
    for lang in ("en", "fr", "ar"):
        a = ANCHORS[lang]
        if a not in s:
            print(f"  ! i18n: anchor not found for {lang}")
            sys.exit(1)
        s = s.replace(a, I18N[lang] + a, 1)
    p.write_text(s + "\n/* koliya-patch-applied: V16_I18N */\n")
    changed.append("i18n:V16_KEYS")
    print("  + i18n: 15 keys x 3 languages")


# ============================================================
# 10. notifications_sm.js — render the new kinds
# ============================================================
patch("public/js/features/notifications_sm.js",
"""  request: { icon:'user',     tint:'warn',   verb:g => `${names(g)} ${t('notif.requests')}` },""",
"""  request: { icon:'user',     tint:'warn',   verb:g => `${names(g)} ${t('notif.requests')}` },
  // The database now writes this when somebody lets you in. Without an
  // entry here notifKind()[kind] was undefined and row() fell back to
  // `like`, so being accepted read as "X liked your post".
  follow_accepted: { icon:'check', tint:'ok', verb:g => `${names(g)} ${t('notif.acceptedYou')}` },
  channel_accepted: { icon:'hash', tint:'ok', verb:g => `${names(g)} ${t('channels.accepted')}` },""",
"V16_NOTIF_KINDS")

patch("public/js/features/notifications_sm.js",
"""  if (filter === 'follows')  list = items.filter(n => n.kind === 'follow' || n.kind === 'request');""",
"""  if (filter === 'follows')  list = items.filter(n =>
    n.kind === 'follow' || n.kind === 'request' || n.kind === 'follow_accepted');""",
"V16_NOTIF_FILTER")

patch("public/js/features/notifications_sm.js",
"""      if (node.dataset.kind === 'follow' || node.dataset.kind === 'request') {""",
"""      if (node.dataset.kind === 'follow' || node.dataset.kind === 'request'
          || node.dataset.kind === 'follow_accepted') {""",
"V16_NOTIF_OPEN")

# The Accept / Decline buttons were hardcoded French in an app that
# ships three languages.
patch("public/js/features/notifications_sm.js",
"""        <button class="btn btn-primary btn-sm" data-accept>Accepter</button>
        <button class="btn btn-ghost btn-sm" data-decline>Refuser</button>""",
"""        <button class="btn btn-primary btn-sm" data-accept>${esc(t('dm.accept'))}</button>
        <button class="btn btn-ghost btn-sm" data-decline>${esc(t('dm.decline'))}</button>""",
"V16_NOTIF_I18N_BTNS")


print()
print(f"V16: {len(changed)} edits applied" if changed else "V16: already applied")
