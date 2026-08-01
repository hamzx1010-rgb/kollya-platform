/**
 * KOLIYA — api_sm.js
 * ============================================================
 * The bridge that was missing.
 *
 * Every feature module was written against a small `api` object and
 * a `useApi()` seam — and nothing ever called `useApi()`. So twelve
 * screens ran on hardcoded arrays and nothing survived a refresh.
 * This file implements those seams against Neon and wires them up.
 *
 * Two design rules kept throughout:
 *
 *   1. SHAPE AT THE EDGE. The modules expect `post.likes` to be an
 *      array of user ids. The database stores likes as rows. The
 *      translation happens here, once, instead of rewriting every
 *      renderer.
 *
 *   2. BATCH. A feed of 30 posts by 12 authors is 4 requests, not
 *      30 + 30 + 30. PostgREST's `in.(a,b,c)` filter does the work.
 *
 * Media: images are shrunk in the browser and stored as data: URLs
 * directly in Postgres — see media_sm.js and db/05_upgrade_sm.sql.
 * No Cloudflare R2 anywhere in this file.
 * ============================================================
 */

import { db, DbError } from './db_sm.js';
import { me } from './store_sm.js';
import { person, cachePeople, ensurePeople } from './people_sm.js';
import { toStorable } from './media_sm.js';

/* ------------------------------------------------------------
   HELPERS
   ------------------------------------------------------------ */

const myId = () => me.id;

/** PostgREST `in.(...)` — quotes each value so text ids survive. */
const inList = ids => `in.(${[...new Set(ids.map(String))]
  .map(v => `"${v.replace(/"/g, '""')}"`).join(',')})`;

// student_card is included on purpose: it is the number printed on the
// physical university card and what every student signs in with. Showing
// it proves the account belongs to a real enrolled student rather than an
// outsider. Verified in PostgreSQL that RLS lets one student read
// another's — it is not private data here.
const PROFILE_COLS =
  'id,username,full_name,faculty,avatar_url,banner_url,bio,xp,streak,role,status,is_private,last_seen,website,github,linkedin,pronouns,student_card';

/** Load any profiles we do not have cached yet, in one request. */
async function hydratePeople(ids) {
  await ensurePeople(ids, async want =>
    db.select('profiles', { id: inList(want), select: PROFILE_COLS, limit: want.length }));
}

/** Group child rows by a parent key. */
function bucket(rows, key) {
  const out = new Map();
  for (const r of rows || []) {
    const k = String(r[key]);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(r);
  }
  return out;
}

/** Swallow "table missing" so a partly-migrated database still runs. */
async function soft(promise, fallback = []) {
  try { return await promise; }
  catch (e) {
    if (e instanceof DbError && (e.status === 404 || /does not exist/i.test(e.message || ''))) {
      console.warn('[koliya] table absente, migration 05_upgrade_sm.sql non exécutée ?', e.message);
      return fallback;
    }
    throw e;
  }
}

/* ============================================================
   FEED
   ============================================================ */

/**
 * Turn database rows into the shape feed_sm.js renders.
 * likes/saves become id arrays; the poll gains its vote tallies.
 */
async function decoratePosts(rows) {
  const posts = rows || [];
  if (!posts.length) return [];

  const ids = posts.map(p => p.id);
  const authors = posts.map(p => p.user_id).filter(Boolean);

  const [likes, saves, comments, votes, reposts] = await Promise.all([
    db.select('post_likes', { post_id: inList(ids), select: 'post_id,user_id', limit: 2000 }).catch(() => []),
    db.select('post_saves', { post_id: inList(ids), select: 'post_id,user_id', limit: 2000 }).catch(() => []),
    db.select('comments',   { post_id: inList(ids), select: 'id,post_id,user_id,text,created_at',
                              order: 'created_at.asc', limit: 2000 }).catch(() => []),
    soft(db.select('poll_votes', { post_id: inList(ids), select: 'post_id,user_id,choice', limit: 2000 })),
    // Reposts are ordinary posts pointing back at the original through
    // repost_id. The column existed in 01_schema.sql from day one but
    // nothing ever counted it, so the repost button rendered a
    // permanently empty <span> — a counter that could never move.
    soft(db.select('posts', { repost_id: inList(ids), select: 'repost_id,user_id', limit: 2000 }))
  ]);

  // The quoted original may sit outside this page of results (an old
  // post reposted today), so fetch the ones we are missing.
  const quotedIds = [...new Set(posts.map(p => p.repost_id).filter(Boolean).map(String))]
    .filter(id => !posts.some(p => String(p.id) === id));
  const quoted = quotedIds.length
    ? await soft(db.select('posts', { id: inList(quotedIds), select: '*', limit: 100 })) || []
    : [];
  const quotedById = new Map(quoted.map(q => [String(q.id), q]));

  await hydratePeople([...authors, ...comments.map(c => c.user_id),
                       ...quoted.map(q => q.user_id)].filter(Boolean));

  const byLike = bucket(likes, 'post_id');
  const bySave = bucket(saves, 'post_id');
  const byCmt  = bucket(comments, 'post_id');
  const byVote = bucket(votes, 'post_id');
  const byRepost = bucket(reposts || [], 'repost_id');

  return posts.map(p => {
    const key = String(p.id);
    const shaped = {
      ...p,
      likes: (byLike.get(key) || []).map(r => r.user_id),
      saves: (bySave.get(key) || []).map(r => r.user_id),
      comments: byCmt.get(key) || [],
      reposts: (byRepost.get(key) || []).map(r => r.user_id)
    };

    // Attach the quoted original so the card has something to show.
    // Without this a repost with no added comment rendered as a
    // completely EMPTY post — no text, no image, nothing.
    if (p.repost_id) {
      const src = posts.find(x => String(x.id) === String(p.repost_id))
               || quotedById.get(String(p.repost_id));
      if (src) shaped.repost_of = { id: src.id, user_id: src.user_id, text: src.text,
                                    image_url: src.image_url, created_at: src.created_at,
                                    anonymous: !!src.anonymous };
    }

    // poll: {"options":["A","B"]} in the row + poll_votes rows
    const opts = p.poll?.options;
    if (Array.isArray(opts) && opts.length) {
      const cast = byVote.get(key) || [];
      shaped.poll = {
        options: opts.map((label, i) => ({
          label,
          votes: cast.filter(v => v.choice === i).map(v => v.user_id)
        }))
      };
    } else {
      shaped.poll = null;
    }
    return shaped;
  });
}

export const feedApi = {
  async listPosts(which = 'foryou') {
    const mine = me.get();
    const base = { order: 'created_at.desc', limit: 40, select: '*' };

    if (which === 'following') {
      const rel = await db.select('follows', {
        follower_id: `eq.${myId()}`, state: 'eq.accepted', select: 'followee_id', limit: 500
      }).catch(() => []);
      const ids = rel.map(r => r.followee_id);
      if (!ids.length) return [];
      return decoratePosts(await db.select('posts', { ...base, user_id: inList(ids) }));
    }

    if (which === 'faculty' && mine?.faculty) {
      // author faculty lives on profiles, so filter through the join
      const peers = await db.select('profiles', {
        faculty: `eq.${mine.faculty}`, select: 'id', limit: 500
      }).catch(() => []);
      const ids = peers.map(r => r.id);
      if (!ids.length) return [];
      return decoratePosts(await db.select('posts', { ...base, user_id: inList(ids) }));
    }

    return decoratePosts(await db.select('posts', base));
  },

  async createPost(post) {
    const row = {
      user_id: post.anonymous ? null : myId(),
      text: post.text || '',
      anonymous: !!post.anonymous
    };

    if (post.file)      row.image_url = await toStorable(post.file, 'post');
    else if (post.image_url && !post.image_url.startsWith('blob:')) row.image_url = post.image_url;

    if (post.poll?.options?.length) {
      row.poll = { options: post.poll.options.map(o => (typeof o === 'string' ? o : o.label)) };
    }

    // A repost points back at the original. feed_sm has always sent
    // repost_id, but this function builds an explicit whitelist and
    // never copied it across — so every "Repost" silently saved an
    // EMPTY post with no text and no link to the original, and the
    // repost counter could never move. The column has existed in
    // 01_schema.sql since day one.
    if (post.repost_id) row.repost_id = post.repost_id;

    const [created] = await db.insert('posts', row);
    const [shaped]  = await decoratePosts([created]);
    return shaped;
  },

  async deletePost(id) {
    await db.remove('posts', { id: `eq.${id}` });
  },

  async like(postId, on) {
    if (on) {
      await db.insert('post_likes', { post_id: postId, user_id: myId() }, { upsert: true });
      await notify(postId, 'like');
    } else {
      await db.remove('post_likes', { post_id: `eq.${postId}`, user_id: `eq.${myId()}` });
    }
  },

  async save(postId, on) {
    if (on) await db.insert('post_saves', { post_id: postId, user_id: myId() }, { upsert: true });
    else    await db.remove('post_saves', { post_id: `eq.${postId}`, user_id: `eq.${myId()}` });
  },

  async listSaved() {
    const rows = await db.select('post_saves', { user_id: `eq.${myId()}`, select: 'post_id', limit: 200 });
    const ids = rows.map(r => r.post_id);
    if (!ids.length) return [];
    return decoratePosts(await db.select('posts', { id: inList(ids), order: 'created_at.desc', limit: 200 }));
  },

  async vote(postId, index) {
    await soft(db.insert('poll_votes',
      { post_id: postId, user_id: myId(), choice: index }, { upsert: true }), null);
  },

  async comment(postId, text) {
    const [row] = await db.insert('comments', { post_id: postId, user_id: myId(), text });
    cachePeople([me.get()]);
    await notify(postId, 'comment', text.slice(0, 90));
    return row;
  },

  async listComments(postId) {
    const rows = await db.select('comments', {
      post_id: `eq.${postId}`, order: 'created_at.asc', limit: 300
    });
    await hydratePeople(rows.map(r => r.user_id));
    return rows;
  },

  async deleteComment(id) {
    await db.remove('comments', { id: `eq.${id}` });
  }
};

/** Tell the post's author something happened. Never blocks the UI. */
async function notify(postId, kind, text = null) {
  try {
    const post = await db.one('posts', { id: `eq.${postId}`, select: 'id,user_id' });
    if (!post?.user_id || post.user_id === myId()) return;
    await db.insert('notifications',
      { user_id: post.user_id, actor_id: myId(), kind, post_id: postId, text });
  } catch { /* a missed notification must never break the action */ }
}

/* ============================================================
   MESSAGES
   ============================================================ */

function shapeMessage(m, reactionRows = []) {
  const reactions = {};
  for (const r of reactionRows) if (String(r.message_id) === String(m.id)) reactions[r.user_id] = r.emoji;
  return { ...m, reactions };
}

export const messagesApi = {
  async listConversations() {
    const rows = await db.select('messages', {
      or: `(sender_id.eq.${myId()},receiver_id.eq.${myId()})`,
      order: 'created_at.desc',
      limit: 400
    });

    const latest = new Map();
    const unread = new Map();
    for (const m of rows) {
      const peerId = m.sender_id === myId() ? m.receiver_id : m.sender_id;
      if (!latest.has(peerId)) latest.set(peerId, m);
      if (m.receiver_id === myId() && !m.seen_at) unread.set(peerId, (unread.get(peerId) || 0) + 1);
    }

    // Pending requests belong in their own tab, not in the inbox.
    // Done here rather than in SQL so one round trip still answers
    // both questions.
    // Both pending AND declined are hidden: a request you turned down
    // should vanish, not linger in the list.
    const hidden = new Set();
    try {
      const rows = await db.select('dm_requests', {
        owner_id: `eq.${myId()}`, state: 'in.(pending,declined)', select: 'peer_id', limit: 500
      });
      for (const r of rows || []) hidden.add(String(r.peer_id));
    } catch { /* migration 09 not run yet: show everything */ }
    for (const id of hidden) latest.delete(id);

    await hydratePeople([...latest.keys()]);

    return [...latest.entries()].map(([peerId, last]) => ({
      peer: person(peerId),
      last,
      unread: unread.get(peerId) || 0
    })).sort((a, b) => new Date(b.last.created_at) - new Date(a.last.created_at));
  },

  async listMessages(peerId) {
    const rows = await db.select('messages', {
      or: `(and(sender_id.eq.${myId()},receiver_id.eq.${peerId}),` +
          `and(sender_id.eq.${peerId},receiver_id.eq.${myId()}))`,
      order: 'created_at.asc',
      limit: 200
    });
    if (!rows.length) return [];

    const rx = await db.select('message_reactions', {
      message_id: inList(rows.map(r => r.id)), select: 'message_id,user_id,emoji', limit: 800
    }).catch(() => []);

    await hydratePeople([peerId]);
    return rows.map(m => shapeMessage(m, rx));
  },

  /**
   * Only the messages newer than `since`. This is what makes a 1.5s
   * cadence cheap: the answer is usually an empty array, not the
   * whole conversation.
   */
  async listNewMessages(peerId, since) {
    if (!since) return messagesApi.listMessages(peerId);
    const rows = await db.select('messages', {
      or: `(and(sender_id.eq.${myId()},receiver_id.eq.${peerId}),` +
          `and(sender_id.eq.${peerId},receiver_id.eq.${myId()}))`,
      created_at: `gt.${since}`,
      order: 'created_at.asc',
      limit: 60
    });
    if (!rows.length) return [];
    const rx = await db.select('message_reactions', {
      message_id: inList(rows.map(r => r.id)), select: 'message_id,user_id,emoji', limit: 200
    }).catch(() => []);
    return rows.map(m => shapeMessage(m, rx));
  },

  async sendMessage(payload) {
    const row = {
      sender_id: myId(),
      receiver_id: payload.receiver_id,
      text: payload.text || '',
      reply_to: payload.reply_to || null
    };

    if (payload.file) {
      const kind = (payload.file.type || '').startsWith('image/') ? 'dm' : 'file';
      row.media_url  = await toStorable(payload.file, kind);
      row.media_type = payload.media_type ||
        ((payload.file.type || '').startsWith('image/') ? 'image' :
         (payload.file.type || '').startsWith('video/') ? 'video' :
         (payload.file.type || '').startsWith('audio/') ? 'audio' : 'file');
      row.media_name = payload.file.name || payload.media_name || null;
    } else if (payload.media_url && !payload.media_url.startsWith('blob:')) {
      row.media_url  = payload.media_url;
      row.media_type = payload.media_type;
      row.media_name = payload.media_name || null;
    }

    if (payload.media_duration) row.media_duration = Math.round(payload.media_duration);
    if (payload.waveform)       row.waveform = payload.waveform;

    const [created] = await db.insert('messages', row);
    return shapeMessage(created);
  },

  async react(msgId, key) {
    if (key) await db.insert('message_reactions',
      { message_id: msgId, user_id: myId(), emoji: key }, { upsert: true });
    else await db.remove('message_reactions',
      { message_id: `eq.${msgId}`, user_id: `eq.${myId()}` });
  },

  async markRead(msgId) {
    await db.update('messages', { seen_at: new Date().toISOString() },
      { id: `eq.${msgId}`, receiver_id: `eq.${myId()}`, seen_at: 'is.null' }).catch(() => {});
  },

  /**
   * Clear the NOTIFICATION rows for a conversation.
   *
   * Separate from markRead(), which only touches messages.seen_at.
   * Since 12_dm_notify_sm.sql a DM also writes a row into
   * `notifications`, and pending_alerts() keeps returning it until
   * read_at is set — so without this the phone would re-announce a
   * conversation you are looking at, every poll, for ever.
   *
   * Fire-and-forget: opening a thread must not wait on it, and a
   * failure is a stale badge, not a broken screen.
   */
  async clearDmAlerts(peerId) {
    if (!peerId) return;
    await db.rpc('mark_dm_read', { p_peer: String(peerId) }).catch(() => {});
  },

  async editMessage(id, text) {
    await db.update('messages',
      { text, edited_at: new Date().toISOString() },
      { id: `eq.${id}`, sender_id: `eq.${myId()}` });
  },

  async deleteMessage(id) {
    await db.remove('messages', { id: `eq.${id}`, sender_id: `eq.${myId()}` });
  },

  async clearThread(peerId) {
    await db.remove('messages', {
      and: `(sender_id.eq.${myId()},receiver_id.eq.${peerId})`
    });
  },

  /** A typing row lives ~6 seconds; the other side polls for it. */
  setTyping: throttled(async peerId => {
    await soft(db.insert('typing',
      { user_id: myId(), peer_id: peerId, at: new Date().toISOString() },
      { upsert: true }), null);
  }, 3000),

  async isTyping(peerId) {
    const cutoff = new Date(Date.now() - 7000).toISOString();
    const rows = await soft(db.select('typing', {
      user_id: `eq.${peerId}`, peer_id: `eq.${myId()}`, at: `gt.${cutoff}`, limit: 1
    }));
    return !!rows.length;
  },

  async searchInThread(peerId, query) {
    const q = String(query || '').trim();
    if (!q) return [];
    return db.select('messages', {
      or: `(and(sender_id.eq.${myId()},receiver_id.eq.${peerId}),` +
          `and(sender_id.eq.${peerId},receiver_id.eq.${myId()}))`,
      text: `ilike.*${q}*`,
      order: 'created_at.desc',
      limit: 50
    });
  },

  /**
   * People I can start a conversation with.
   *
   * Uses messageable(), which orders by "who you already talk to,
   * then mutuals, then everyone" and excludes anyone the database
   * would refuse the message from anyway. Listing someone you cannot
   * write to is a trap, not a feature.
   *
   * Errors are NOT swallowed here. The previous version ended in
   * `.catch(() => [])`, so a failed query looked identical to an
   * empty campus — which is exactly why "Nouveau message" showed
   * nothing with no explanation.
   */
  async contacts(query = '') {
    const rows = await db.rpc('messageable', { p_query: String(query || '').trim() });
    cachePeople(rows || []);
    return rows || [];
  },

  /** May I message this person? Drives the Message button. */
  async canMessage(userId) {
    if (!userId || String(userId) === String(myId())) return false;
    try { return !!(await db.rpc('can_message', { p_user: String(userId) })); }
    catch { return false; }
  },

  /* ---- message requests ----
     A stranger's first messages wait in a separate tab instead of
     interrupting you, and instead of being refused outright. The
     sender is never told — see db/09_requests_sm.sql for why. */

  /** Conversations waiting for a decision. */
  async listRequests() {
    const rows = await soft(db.rpc('dm_requests_list', {}));
    return (rows || []).map(r => ({
      peer: {
        id: r.peer_id, username: r.username, full_name: r.full_name,
        avatar_url: r.avatar_url, faculty: r.faculty
      },
      preview: r.preview,
      count: r.msg_count,
      at: r.first_at,
      mutuals: r.mutuals || 0
    }));
  },

  async requestCount() {
    const n = await soft(db.rpc('dm_requests_count', {}), 0);
    return typeof n === 'number' ? n : Number(n) || 0;
  },

  async acceptRequest(peerId) {
    await db.rpc('dm_accept', { p_peer: String(peerId) });
  },

  /** Silent: no notification, nothing the sender can detect. */
  async declineRequest(peerId) {
    await db.rpc('dm_decline', { p_peer: String(peerId) });
  },

  async deleteRequest(peerId) {
    await db.rpc('dm_delete_request', { p_peer: String(peerId) });
  },

  /** Will writing to this person create a request rather than a chat? */
  async willBeRequest(userId) {
    if (!userId) return false;
    try { return !!(await db.rpc('dm_will_be_request', { p_user: String(userId) })); }
    catch { return false; }
  },

  /* ---- folders ----
     Same set your original app had, but stored server-side so they
     follow you between devices instead of dying with localStorage. */
  async listFolders() {
    const rows = await db.select('chat_folders', {
      user_id: `eq.${myId()}`, select: 'peer_id,folder', limit: 500
    }).catch(() => []);
    return Object.fromEntries((rows || []).map(r => [String(r.peer_id), r.folder]));
  },

  async setFolder(peerId, folder) {
    if (folder === 'all') {
      await db.remove('chat_folders', {
        user_id: `eq.${myId()}`, peer_id: `eq.${peerId}`
      }).catch(() => {});
      return 'all';
    }
    await db.insert('chat_folders', {
      user_id: myId(), peer_id: peerId, folder, updated_at: new Date().toISOString()
    }, { upsert: true });
    return folder;
  }
};

/** Rate-limit an async function so typing does not flood the API. */
function throttled(fn, ms) {
  let last = 0;
  return (...args) => {
    const now = Date.now();
    if (now - last < ms) return Promise.resolve();
    last = now;
    return fn(...args).catch(() => {});
  };
}

/* ============================================================
   STORIES
   ============================================================ */

export const storiesApi = {
  async listStories() {
    const rows = await db.select('stories', {
      expires_at: `gt.${new Date().toISOString()}`,
      order: 'created_at.asc',
      limit: 200
    });
    if (!rows.length) return [];

    await hydratePeople(rows.map(r => r.user_id));

    const byUser = bucket(rows, 'user_id');
    // my own story first, then most recently updated
    return [...byUser.entries()]
      .map(([user_id, items]) => ({ user_id, items, user: person(user_id) }))
      .sort((a, b) => {
        if (a.user_id === myId()) return -1;
        if (b.user_id === myId()) return 1;
        const la = a.items[a.items.length - 1].created_at;
        const lb = b.items[b.items.length - 1].created_at;
        return new Date(lb) - new Date(la);
      });
  },

  async createStory({ file, text }) {
    const media_url = await toStorable(file, 'story');
    const [row] = await db.insert('stories', {
      user_id: myId(), media_url, media_type: 'image', text: text || null
    });
    return row;
  },

  async markSeen(storyId) {
    await db.insert('story_views',
      { story_id: storyId, user_id: myId() }, { upsert: true }).catch(() => {});
  },

  async viewers(storyId) {
    const rows = await db.select('story_views', {
      story_id: `eq.${storyId}`, select: 'user_id,viewed_at', limit: 200
    }).catch(() => []);
    await hydratePeople(rows.map(r => r.user_id));
    return rows.map(r => ({ ...r, user: person(r.user_id) }));
  },

  async deleteStory(id) {
    await db.remove('stories', { id: `eq.${id}`, user_id: `eq.${myId()}` });
  },

  /** Reply to a story = a normal DM, exactly as before. */
  async reply(userId, text) {
    return messagesApi.sendMessage({ receiver_id: userId, text });
  }
};

/* ============================================================
   PROFILE
   ============================================================ */

export const profileApi = {
  async getProfile(username) {
    const mine = me.get();
    const isSelf = !username || username === mine?.username;

    const row = isSelf
      ? await db.one('profiles', { id: `eq.${myId()}`, select: PROFILE_COLS })
      : await db.one('profiles', { username: `eq.${username}`, select: PROFILE_COLS });

    if (!row) return null;
    cachePeople(row);

    // profile_counts() is SECURITY DEFINER, so the numbers are right
    // even on a private account whose follow rows RLS hides from me.
    // Instagram shows "142 abonnés" on a locked profile and hides the
    // list; this is that, done honestly.
    const [counts, rel, mayMessage, asRequest] = await Promise.all([
      db.rpc('profile_counts', { p_user: row.id }).catch(() => null),
      isSelf ? Promise.resolve(null)
             : db.one('follows', { follower_id: `eq.${myId()}`, followee_id: `eq.${row.id}`,
                                   select: 'state' }).catch(() => null),
      isSelf ? Promise.resolve(false) : messagesApi.canMessage(row.id),
      isSelf ? Promise.resolve(false) : messagesApi.willBeRequest(row.id)
    ]);
    const c = Array.isArray(counts) ? counts[0] : counts;

    return {
      ...row,
      isMe: row.id === myId(),
      private: !!row.is_private,
      followers: c?.followers ?? 0,
      following: c?.following ?? 0,
      posts: c?.posts ?? 0,
      canMessage: !!mayMessage,
      willBeRequest: !!asRequest,
      followState: rel ? (rel.state === 'accepted' ? 'following' : 'requested') : 'none'
    };
  },

  async listPosts(userId) {
    return decoratePosts(await db.select('posts', {
      user_id: `eq.${userId}`, order: 'created_at.desc', limit: 60
    }));
  },

  async listLiked(userId) {
    const rows = await db.select('post_likes', {
      user_id: `eq.${userId}`, select: 'post_id', limit: 200
    }).catch(() => []);
    const ids = rows.map(r => r.post_id);
    if (!ids.length) return [];
    return decoratePosts(await db.select('posts', { id: inList(ids), order: 'created_at.desc' }));
  },

  async follow(userId, next) {
    if (next === 'none') {
      await db.remove('follows', { follower_id: `eq.${myId()}`, followee_id: `eq.${userId}` });
      return;
    }
    await db.insert('follows', {
      follower_id: myId(),
      followee_id: userId,
      state: next === 'requested' ? 'pending' : 'accepted'
    }, { upsert: true });

    // NOT .catch(() => {}).
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
    }
  },

  /**
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

  async followers(userId) {
    const rows = await db.select('follows', {
      followee_id: `eq.${userId}`, state: 'eq.accepted', select: 'follower_id', limit: 200
    });
    await hydratePeople(rows.map(r => r.follower_id));
    return rows.map(r => person(r.follower_id));
  },

  async following(userId) {
    const rows = await db.select('follows', {
      follower_id: `eq.${userId}`, state: 'eq.accepted', select: 'followee_id', limit: 200
    });
    await hydratePeople(rows.map(r => r.followee_id));
    return rows.map(r => person(r.followee_id));
  },

  /**
   * Save the profile. `avatarFile` / `bannerFile` are shrunk in the
   * browser and written into the row as data: URLs — which is why
   * the picture is still there after a refresh, on any device.
   */
  async updateProfile(patch, { avatarFile, bannerFile } = {}) {
    const row = {};
    for (const k of ['full_name','bio','faculty','pronouns','website','github','linkedin','is_private','username']) {
      if (patch[k] !== undefined) row[k] = patch[k];
    }
    if (avatarFile) row.avatar_url = await toStorable(avatarFile, 'avatar');
    if (bannerFile) row.banner_url = await toStorable(bannerFile, 'banner');
    if (patch.avatar_url === null) row.avatar_url = null;
    if (patch.banner_url === null) row.banner_url = null;

    if (!Object.keys(row).length) return me.get();

    const [updated] = await db.update('profiles', row, { id: `eq.${myId()}` });

    // PostgREST answers 200 with an EMPTY array when RLS silently
    // filtered the row out. That looked like success and the change
    // vanished on refresh — the "profile editing is not saving" bug.
    // Say so instead.
    if (!updated) {
      // PostgREST answers 200 with an EMPTY array when RLS filtered the
      // row out. Reproduced in a real Postgres: the cause is almost
      // always status='pending' — every account signed up as pending
      // and no approval screen existed, so the whole app was read-only.
      // db/10_open_signup_sm.sql fixes it.
      console.error('[koliya] profiles UPDATE matched 0 rows. Most likely your ' +
                    'profile row is status="pending": run db/10_open_signup_sm.sql ' +
                    'in the Neon SQL editor, then Data API → Refresh schema cache.');
      throw new DbError('__RLS_DENIED__', 403);
    }

    me.set({ ...me.get(), ...updated });
    cachePeople(updated);
    return updated;
  },

  /** How many times the name changed inside the 15-day window. */
  async nameChangeStatus() {
    try {
      const rows = await db.rpc('name_change_status', {});
      const r = Array.isArray(rows) ? rows[0] : rows;
      return r || { changes: 0, days_left: 0, will_warn: false };
    } catch {
      return { changes: 0, days_left: 0, will_warn: false };
    }
  },

  async block(userId) {
    await db.insert('blocks', { blocker_id: myId(), blocked_id: userId }, { upsert: true });
  },

  async report(targetType, targetId, reason = '') {
    await db.insert('reports',
      { reporter_id: myId(), target_type: targetType, target_id: String(targetId), reason });
  }
};

/* ============================================================
   CAMPUS — channels, events, Q&A, explore
   ============================================================ */

export const campusApi = {
  /* ---- channels ---- */
  async listChannels() {
    const rows = await db.select('channels', { order: 'created_at.desc', limit: 100 });
    if (!rows.length) return [];
    const mem = await db.select('channel_members', {
      channel_id: inList(rows.map(r => r.id)), select: 'channel_id,user_id', limit: 2000
    }).catch(() => []);
    const byCh = bucket(mem, 'channel_id');
    return rows.map(c => ({
      ...c,
      members: (byCh.get(String(c.id)) || []).length,
      joined: (byCh.get(String(c.id)) || []).some(m => m.user_id === myId())
    }));
  },

  async createChannel({ name, description, faculty, official = false }) {
    const [row] = await db.insert('channels', {
      name, description: description || '', faculty: faculty || null,
      owner_id: myId(), official: !!official
    });
    await db.insert('channel_members', { channel_id: row.id, user_id: myId() }, { upsert: true });
    return row;
  },

  /**
   * Join or leave a channel.
   *
   * Goes through the join_channel() RPC, not a direct insert: a private
   * channel must produce a REQUEST, not a membership, and that decision
   * cannot live in the browser. 14_groups_sm.sql refuses direct inserts
   * into channel_members for exactly that reason, so the old
   * db.insert() here would now fail the RLS check.
   *
   * Returns 'joined' | 'requested' | 'left' | 'error' so the UI can say
   * "Request sent" instead of pretending you are in.
   */
  async joinChannel(id, on) {
    if (!on) {
      const ok = await db.rpc('leave_channel', { p_channel: id }).catch(() => false);
      // The owner cannot leave their own channel — somebody has to run it.
      return ok === false ? 'owner' : 'left';
    }
    const res = await db.rpc('join_channel', { p_channel: id });
    return (Array.isArray(res) ? res[0] : res) || 'error';
  },

  /* ---- group chat: channels and events share one screen ---------- */

  async groupMessages(target, { since = null, limit = 60 } = {}) {
    const q = target.channelId
      ? { channel_id: `eq.${target.channelId}` }
      : { event_id: `eq.${target.eventId}` };
    if (since) q.created_at = `gt.${since}`;
    const rows = await db.select('group_messages', {
      ...q, order: 'created_at.asc', limit
    });
    await hydratePeople(rows.map(r => r.sender_id));
    return rows;
  },

  async sendGroupMessage(target, payload) {
    const row = {
      sender_id: myId(),
      text: payload.text || '',
      channel_id: target.channelId || null,
      event_id: target.eventId || null
    };
    if (payload.file) {
      row.media_url = await toStorable(payload.file, 'dm');
      row.media_type = (payload.file.type || '').startsWith('image/') ? 'image' : 'file';
    }
    const [created] = await db.insert('group_messages', row);
    return created;
  },

  /** Who may talk here, and am I in charge? Drives the whole UI state. */
  async groupInfo(target) {
    if (target.eventId) {
      const attending = await db.rpc('is_event_attendee', { p_event: target.eventId })
        .catch(() => false);
      return { role: attending ? 'member' : 'none', canPost: !!attending, kind: 'event' };
    }
    const [role, canPost] = await Promise.all([
      db.rpc('channel_role',   { p_channel: target.channelId }).catch(() => null),
      db.rpc('can_post_group', { p_channel: target.channelId, p_event: null }).catch(() => false)
    ]);
    const r = Array.isArray(role) ? role[0] : role;
    return { role: r || 'none', canPost: !!canPost, kind: 'channel' };
  },

  /** The chat's display name, straight from the row that owns it. */
  async groupName(kind, id) {
    if (kind === 'event') {
      const row = await db.one('events', { id: `eq.${id}`, select: 'title' });
      return row?.title || '';
    }
    const row = await db.one('channels', { id: `eq.${id}`, select: 'name' });
    return row?.name || '';
  },

  async channelMembers(channelId) {
    const rows = await db.select('channel_members', {
      channel_id: `eq.${channelId}`, order: 'role.asc', limit: 200
    });
    await hydratePeople(rows.map(r => r.user_id));
    return rows.map(r => ({ ...person(r.user_id), role: r.role }));
  },

  async channelRequests(channelId) {
    const rows = await db.select('channel_requests', {
      channel_id: `eq.${channelId}`, state: 'eq.pending', order: 'created_at.desc', limit: 100
    });
    await hydratePeople(rows.map(r => r.user_id));
    return rows.map(r => person(r.user_id));
  },

  async respondChannelRequest(channelId, userId, accept) {
    return db.rpc('respond_channel_request',
      { p_channel: channelId, p_user: userId, p_accept: !!accept });
  },

  async setChannelRole(channelId, userId, role) {
    return db.rpc('set_channel_role',
      { p_channel: channelId, p_user: userId, p_role: role });
  },

  /** Owner-only switches: private, and admins-only posting. */
  async updateChannelSettings(channelId, { isPrivate, postPolicy } = {}) {
    const patch = {};
    if (isPrivate !== undefined)  patch.is_private = !!isPrivate;
    if (postPolicy !== undefined) patch.post_policy = postPolicy;
    if (!Object.keys(patch).length) return;
    await db.update('channels', patch, { id: `eq.${channelId}` });
  },

  async deleteChannel(id) {
    await db.remove('channels', { id: `eq.${id}`, owner_id: `eq.${myId()}` });
  },

  /* ---- events ---- */
  async listEvents() {
    const rows = await db.select('events', { order: 'starts_at.asc', limit: 100 });
    if (!rows.length) return [];
    const att = await db.select('event_attendees', {
      event_id: inList(rows.map(r => r.id)), select: 'event_id,user_id', limit: 2000
    }).catch(() => []);
    await hydratePeople(rows.map(r => r.owner_id).filter(Boolean));
    const byEv = bucket(att, 'event_id');
    return rows.map(e => ({ ...e, going: (byEv.get(String(e.id)) || []).map(a => a.user_id) }));
  },

  async createEvent({ title, description, location, starts_at, faculty, coverFile, cover_side }) {
    const row = {
      owner_id: myId(), title,
      description: description || '',
      location: location || null,
      starts_at: starts_at || null,
      faculty: faculty || me.get()?.faculty || null
    };
    if (coverFile) row.cover_url = await toStorable(coverFile, 'banner');
    // Which side the cover sits on when the event is opened. Stored in
    // the description as a marker rather than a column: it is a purely
    // cosmetic preference, and a schema change for it would have to be
    // migrated onto every existing deployment for no functional gain.
    if (cover_side === 'left') row.description = (row.description || '') + '\n[img:left]';
    const [created] = await db.insert('events', row);
    await db.insert('event_attendees', { event_id: created.id, user_id: myId() }, { upsert: true });
    return { ...created, going: [myId()] };
  },

  async attend(eventId, on) {
    if (on) await db.insert('event_attendees', { event_id: eventId, user_id: myId() }, { upsert: true });
    else    await db.remove('event_attendees', { event_id: `eq.${eventId}`, user_id: `eq.${myId()}` });
  },

  async deleteEvent(id) {
    await db.remove('events', { id: `eq.${id}`, owner_id: `eq.${myId()}` });
  },

  /* ---- Q&A ---- */
  async listQuestions() {
    const rows = await db.select('qa', { order: 'created_at.desc', limit: 100 });
    if (!rows.length) return [];

    const answers = await db.select('qa_answers', {
      qa_id: inList(rows.map(r => r.id)), order: 'created_at.asc', limit: 600
    }).catch(() => []);

    const votes = await soft(db.select('qa_answer_votes', {
      answer_id: answers.length ? inList(answers.map(a => a.id)) : 'eq.0',
      select: 'answer_id,user_id', limit: 2000
    }));

    // An anonymous question must not carry its author to the client.
    // RLS returns the column, so it is stripped here as well —
    // defence in depth, exactly as the original app promised.
    const visibleAuthors = [
      ...rows.filter(r => !r.anonymous).map(r => r.user_id),
      ...answers.filter(a => !a.anonymous).map(a => a.user_id)
    ].filter(Boolean);
    await hydratePeople(visibleAuthors);

    const byVote = bucket(votes, 'answer_id');
    const byQ = bucket(answers, 'qa_id');

    return rows.map(q => ({
      ...q,
      user_id: q.anonymous ? null : q.user_id,
      answers: (byQ.get(String(q.id)) || []).map(a => ({
        ...a,
        user_id: a.anonymous ? null : a.user_id,
        votes: (byVote.get(String(a.id)) || []).length,
        myVote: (byVote.get(String(a.id)) || []).some(v => v.user_id === myId())
      }))
    }));
  },

  async ask({ text, anonymous = true }) {
    const [row] = await db.insert('qa', {
      user_id: myId(), text, anonymous: !!anonymous,
      faculty: me.get()?.faculty || null
    });
    return { ...row, user_id: row.anonymous ? null : row.user_id, answers: [] };
  },

  async answer(qaId, text, anonymous = false) {
    const [row] = await db.insert('qa_answers',
      { qa_id: qaId, user_id: myId(), text, anonymous: !!anonymous });
    return { ...row, votes: 0, myVote: false };
  },

  async voteAnswer(answerId, on) {
    if (on) await soft(db.insert('qa_answer_votes',
      { answer_id: answerId, user_id: myId() }, { upsert: true }), null);
    else    await soft(db.remove('qa_answer_votes',
      { answer_id: `eq.${answerId}`, user_id: `eq.${myId()}` }), null);
  },

  async deleteQuestion(id) {
    await db.remove('qa', { id: `eq.${id}`, user_id: `eq.${myId()}` });
  },

  /* ---- explore ----
     THE LEADERBOARD REWARD.
     Discovery is ordered by XP, so climbing the board is what puts
     you in front of people. The followers you gain are real students
     who saw you and chose to follow — not rows invented by a script.
     The top three are tagged so the UI can mark them.               */
  async searchPeople(query) {
    const q = String(query || '').trim();
    const rows = await db.select('profiles', {
      status: 'eq.approved',
      select: PROFILE_COLS,
      order: 'xp.desc',
      limit: 40,
      ...(q ? { or: `(full_name.ilike.*${q}*,username.ilike.*${q}*,faculty.ilike.*${q}*)` } : {})
    });
    cachePeople(rows);

    const mine = me.get();
    const top = await db.select('profiles', {
      status: 'eq.approved', select: 'id',
      order: 'xp.desc', limit: 3,
      ...(mine?.faculty ? { faculty: `eq.${mine.faculty}` } : {})
    }).catch(() => []);
    const ranks = new Map(top.map((r, i) => [String(r.id), i + 1]));

    return rows
      .filter(r => r.id !== myId())
      .map(r => ({ ...r, rank: ranks.get(String(r.id)) || null }));
  },

  async searchPosts(query) {
    const q = String(query || '').trim();
    if (!q) return [];
    return decoratePosts(await db.select('posts', {
      text: `ilike.*${q}*`, order: 'created_at.desc', limit: 40
    }));
  },

  /** Hashtag counts, computed from the last 300 posts. */
  async trends() {
    const rows = await db.select('posts', { select: 'text', order: 'created_at.desc', limit: 300 })
      .catch(() => []);
    const counts = new Map();
    for (const r of rows) {
      for (const tag of String(r.text || '').match(/#[\p{L}\p{N}_]{2,30}/gu) || []) {
        const k = tag.slice(1).toLowerCase();
        counts.set(k, (counts.get(k) || 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([tag, posts]) => ({ tag, posts }))
      .sort((a, b) => b.posts - a.posts)
      .slice(0, 8);
  },

  listSaved: () => feedApi.listSaved()
};

/* ============================================================
   NOTIFICATIONS
   ============================================================ */

export const notificationsApi = {
  async listNotifications() {
    const rows = await db.select('notifications', {
      user_id: `eq.${myId()}`, order: 'created_at.desc', limit: 60
    });
    await hydratePeople(rows.map(r => r.actor_id).filter(Boolean));
    return rows.map(n => ({
      id: n.id,
      kind: n.kind,
      actor: n.actor_id,
      target: n.post_id,
      text: n.text,
      at: n.created_at,
      read: !!n.read_at
    }));
  },

  async markRead(ids) {
    const list = Array.isArray(ids) ? ids : [ids];
    if (!list.length) return;
    await db.update('notifications',
      { read_at: new Date().toISOString() },
      { id: inList(list), user_id: `eq.${myId()}` }).catch(() => {});
  },

  async markAllRead() {
    await db.update('notifications',
      { read_at: new Date().toISOString() },
      { user_id: `eq.${myId()}`, read_at: 'is.null' }).catch(() => {});
  },

  async dismiss(ids) {
    const list = Array.isArray(ids) ? ids : [ids];
    if (!list.length) return;
    await db.remove('notifications', { id: inList(list), user_id: `eq.${myId()}` });
  },

  async unreadCount() {
    return db.count('notifications', { user_id: `eq.${myId()}`, read_at: 'is.null' }).catch(() => 0);
  },

  /** Accept or refuse a follow request. */
  async respondToRequest(actorId, accept) {
    if (accept) {
      await db.update('follows', { state: 'accepted' },
        { follower_id: `eq.${actorId}`, followee_id: `eq.${myId()}` });
    } else {
      await db.remove('follows', { follower_id: `eq.${actorId}`, followee_id: `eq.${myId()}` });
    }
  }
};

/* ============================================================
   HUB & LEADERBOARD
   ============================================================ */

export const statsApi = {
  async stats() {
    const id = myId();
    const mine = me.get() || {};
    const [posts, comments, likesGiven, answers, followers, events, saved] = await Promise.all([
      db.count('posts',        { user_id: `eq.${id}` }).catch(() => 0),
      db.count('comments',     { user_id: `eq.${id}` }).catch(() => 0),
      db.count('post_likes',   { user_id: `eq.${id}` }).catch(() => 0),
      db.count('qa_answers',   { user_id: `eq.${id}` }).catch(() => 0),
      db.count('follows',      { followee_id: `eq.${id}`, state: 'eq.accepted' }).catch(() => 0),
      db.count('event_attendees', { user_id: `eq.${id}` }).catch(() => 0),
      db.count('post_saves',   { user_id: `eq.${id}` }).catch(() => 0)
    ]);
    return {
      posts, comments, likes: likesGiven, answers, followers, events, saved,
      nightPosts: 0,
      xp: mine.xp || 0,
      streak: mine.streak || 0
    };
  },

  /** XP is authoritative in the database, not in localStorage. */
  async addXp(amount) {
    const mine = me.get();
    if (!mine) return;
    const xp = (mine.xp || 0) + amount;
    const [row] = await db.update('profiles', { xp }, { id: `eq.${myId()}` }).catch(() => []);
    if (row) me.set({ ...mine, xp: row.xp });
    return row?.xp ?? xp;
  },

  async setStreak(streak) {
    const [row] = await db.update('profiles',
      { streak, streak_day: new Date().toISOString().slice(0, 10) },
      { id: `eq.${myId()}` }).catch(() => []);
    if (row) me.set({ ...me.get(), streak: row.streak });
    return row?.streak ?? streak;
  },

  async leaderboard({ scope = 'faculty', metric = 'xp' } = {}) {
    const mine = me.get();
    const params = {
      status: 'eq.approved',
      select: 'id,username,full_name,faculty,avatar_url,xp,streak',
      order: `${metric === 'streak' ? 'streak' : 'xp'}.desc`,
      limit: 50
    };
    if (scope === 'faculty' && mine?.faculty) params.faculty = `eq.${mine.faculty}`;
    const rows = await db.select('profiles', params).catch(() => []);
    cachePeople(rows);
    return rows;
  }
};

/* ============================================================
   WIRE EVERYTHING UP
   This is the call that was missing from app_sm.js.
   ============================================================ */

export async function connectApi() {
  const [feed, messages, stories, profile, campus, notifications, hub, leaderboard, inbox] =
    await Promise.all([
      import('../features/feed_sm.js'),
      import('../features/messages_sm.js'),
      import('../features/stories_sm.js'),
      import('../features/profile_sm.js'),
      import('../features/campus_sm.js'),
      import('../features/notifications_sm.js'),
      import('../features/hub_sm.js'),
      import('../features/leaderboard_sm.js'),
      // The app-wide inbox poller. Not a feature screen — it runs on
      // every route so a message arrives while you are on the feed.
      import('./inbox_sm.js')
    ]);

  feed.useApi(feedApi);
  // The group-chat calls live on campusApi (channels and events are its
  // domain) but the SCREEN is messages_sm — one thread view for people
  // and groups alike. Hand it both, rather than duplicating six methods
  // or splitting the chat across two files.
  messages.useApi({
    ...messagesApi,
    groupInfo:             campusApi.groupInfo,
    groupName:             campusApi.groupName,
    groupMessages:         campusApi.groupMessages,
    sendGroupMessage:      campusApi.sendGroupMessage,
    channelMembers:        campusApi.channelMembers,
    channelRequests:       campusApi.channelRequests,
    respondChannelRequest: campusApi.respondChannelRequest,
    setChannelRole:        campusApi.setChannelRole,
    updateChannelSettings: campusApi.updateChannelSettings
  });
  stories.useApi(storiesApi);
  profile.useApi(profileApi);
  campus.useApi(campusApi);
  notifications.useApi(notificationsApi);
  hub.useApi(statsApi);
  leaderboard.useApi(statsApi);
  inbox.useApi(messagesApi);
  inbox.initInbox();
  inbox.startInbox();

  // my own profile is always in the cache, so my name never renders
  // as "Étudiant" while the first request is in flight
  cachePeople(me.get());

  console.info('[koliya] API connectée à Neon — 9 modules');
  return true;
}

export default {
  feedApi, messagesApi, storiesApi, profileApi,
  campusApi, notificationsApi, statsApi, connectApi
};
