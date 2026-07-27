/**
 * KOLIYA — db_sm.js
 * ============================================================
 * Neon Data API client (PostgREST-compatible).
 *
 * Every request carries the Better Auth JWT. Row Level Security in
 * the database decides what comes back — this file never filters for
 * privacy, it only shapes queries. That distinction matters: the old
 * app filtered private messages in JavaScript, which meant every
 * student's DMs were already on every other student's machine.
 *
 * PostgREST filter syntax:
 *   { id: 'eq.42' }              id = 42
 *   { created_at: 'gt.2026-01' } created_at > …
 *   { or: '(a.eq.1,b.eq.2)' }    a = 1 OR b = 2
 * ============================================================
 */

import { CONFIG } from './config_sm.js';
import { getToken } from './auth_sm.js';
import { MEDIA_BUDGET } from './media_sm.js';

const base = () => CONFIG.DATA_API_URL.replace(/\/$/, '');

export class DbError extends Error {
  constructor(message, status, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

/* ------------------------------------------------------------
   CORE REQUEST
   ------------------------------------------------------------ */

async function request(path, { method = 'GET', body, prefer, retry = true } = {}) {
  const token = await getToken();
  if (!token) throw new DbError('Non connecté', 401);

  const headers = { Authorization: `Bearer ${token}` };
  if (body) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;

  const res = await fetch(base() + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  // an expired JWT looks like a permission error; refresh once
  if (res.status === 401 && retry) {
    await getToken({ force: true });
    return request(path, { method, body, prefer, retry: false });
  }

  const text = await res.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }

  if (!res.ok) {
    const msg = data?.message || data?.hint || `Erreur ${res.status}`;
    // RLS refusals surface as 401/403 or an empty result, not a crash
    throw new DbError(msg, res.status, data?.detail);
  }
  return data;
}

/**
 * Which column to count on. Tables with a composite primary key have
 * no `id`, so counting must name a real column.
 */
const COUNT_KEY = {
  follows:          'follower_id',
  blocks:           'blocker_id',
  post_likes:       'post_id',
  post_saves:       'post_id',
  channel_members:  'channel_id',
  message_reactions:'message_id',
  story_views:      'story_id',
  event_attendees:  'event_id',
  poll_votes:       'post_id',
  qa_answer_votes:  'answer_id',
  typing:           'user_id',
  quests:           'user_id'
};

/** Turn a filter object into a PostgREST query string. */
function qs(params = {}) {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    out.append(k, String(v));
  }
  const s = out.toString();
  return s ? '?' + s : '';
}

/* ------------------------------------------------------------
   GUARD
   Media now lives in Postgres as data: URLs (see media_sm.js), so
   base64 is expected rather than forbidden. What still has to be
   enforced is SIZE — a 12 MB row would time out the Data API long
   before Postgres complained, and the error would be unreadable.
   The same limits exist as CHECK constraints in 05_upgrade_sm.sql;
   this copy just fails faster and in French.
   ------------------------------------------------------------ */

const FIELD_BUDGET = {
  avatar_url: MEDIA_BUDGET.avatar.maxBytes,
  banner_url: MEDIA_BUDGET.banner.maxBytes,
  image_url:  MEDIA_BUDGET.post.maxBytes,
  cover_url:  MEDIA_BUDGET.banner.maxBytes,
  icon_url:   MEDIA_BUDGET.avatar.maxBytes,
  media_url:  4_000_000
};

function guard(row) {
  if (!row || typeof row !== 'object') return row;
  for (const [field, max] of Object.entries(FIELD_BUDGET)) {
    const v = row[field];
    if (typeof v !== 'string' || !v.length) continue;
    if (v.length > max) {
      throw new DbError(
        `Média trop lourd pour « ${field} » : ${Math.round(v.length / 1024)} Ko ` +
        `(maximum ${Math.round(max / 1024)} Ko). Passez par toStorable().`, 413);
    }
    if (!/^(data:image\/|data:audio\/|data:video\/|https?:\/\/|blob:)/.test(v)) {
      throw new DbError(`Valeur de média invalide pour « ${field} »`, 400);
    }
    if (v.startsWith('blob:')) {
      throw new DbError(
        `« ${field} » contient une URL blob: temporaire, qui n'existera plus ` +
        `après un rafraîchissement. Utilisez toStorable() avant d'enregistrer.`, 400);
    }
  }
  return row;
}

/* ------------------------------------------------------------
   PUBLIC API
   ------------------------------------------------------------ */

export const db = {
  /**
   * db.select('posts', { order:'created_at.desc', limit:20 })
   * db.select('profiles', { id:'eq.u1', select:'id,username' })
   */
  select(table, params = {}) {
    const { select = '*', ...rest } = params;
    return request(`/${table}${qs({ select, ...rest })}`);
  },

  /** First row or null. */
  async one(table, params = {}) {
    const rows = await db.select(table, { ...params, limit: 1 });
    return Array.isArray(rows) ? rows[0] ?? null : rows;
  },

  /**
   * Row count without transferring the rows.
   *
   * This used to hardcode `select=id`, which quietly broke every
   * junction table: follows, post_likes, post_saves and
   * event_attendees have a COMPOSITE primary key and no `id` column
   * at all. PostgREST answered 400, the caller's .catch swallowed it,
   * and the follower counter sat at 0 forever — not because following
   * failed, but because the question was malformed.
   */
  async count(table, params = {}) {
    const token = await getToken();
    const column = COUNT_KEY[table] || 'id';
    const res = await fetch(base() + `/${table}${qs({ select: column, ...params })}`, {
      method: 'HEAD',
      headers: { Authorization: `Bearer ${token}`, Prefer: 'count=exact' }
    });
    if (!res.ok) {
      console.warn(`[koliya] count(${table}) a échoué: ${res.status}`);
      return 0;
    }
    const range = res.headers.get('content-range') || '';
    return Number(range.split('/')[1]) || 0;
  },

  insert(table, rows, { upsert = false } = {}) {
    const payload = Array.isArray(rows) ? rows.map(guard) : guard(rows);
    return request(`/${table}`, {
      method: 'POST',
      body: payload,
      prefer: `return=representation${upsert ? ',resolution=merge-duplicates' : ''}`
    });
  },

  update(table, patch, filter = {}) {
    return request(`/${table}${qs(filter)}`, {
      method: 'PATCH',
      body: guard(patch),
      prefer: 'return=representation'
    });
  },

  remove(table, filter = {}) {
    if (!Object.keys(filter).length) {
      throw new DbError('Suppression sans filtre refusée', 400);
    }
    return request(`/${table}${qs(filter)}`, { method: 'DELETE', prefer: 'return=representation' });
  },

  /** Call a Postgres function exposed through the Data API. */
  rpc(fn, args = {}) {
    return request(`/rpc/${fn}`, { method: 'POST', body: args });
  },

  /** Connectivity probe used on boot. */
  async ping() {
    try {
      await db.select('profiles', { select: 'id', limit: 1 });
      return true;
    } catch (e) {
      return e.status === 401 ? false : true;   // 401 = not logged in, still reachable
    }
  }
};

/* ------------------------------------------------------------
   QUERY HELPERS
   Shapes the feature modules need, in one place.
   ------------------------------------------------------------ */

export const queries = {
  /** Conversation between me and one peer. RLS already limits this. */
  thread(myId, peerId, limit = 60) {
    return db.select('messages', {
      or: `(and(sender_id.eq.${myId},receiver_id.eq.${peerId}),and(sender_id.eq.${peerId},receiver_id.eq.${myId}))`,
      order: 'created_at.asc',
      limit
    });
  },

  /** Latest message per peer — the conversation list. */
  async conversations(myId, limit = 40) {
    const rows = await db.select('messages', {
      or: `(sender_id.eq.${myId},receiver_id.eq.${myId})`,
      order: 'created_at.desc',
      limit: 300
    });
    const seen = new Map();
    for (const m of rows || []) {
      const peer = m.sender_id === myId ? m.receiver_id : m.sender_id;
      if (!seen.has(peer)) seen.set(peer, m);
    }
    return [...seen.entries()].slice(0, limit).map(([peer, last]) => ({ peer, last }));
  },

  feed(limit = 30, before) {
    return db.select('posts', {
      select: '*,profiles(id,username,full_name,faculty,avatar_url)',
      order: 'created_at.desc',
      limit,
      ...(before ? { created_at: `lt.${before}` } : {})
    });
  },

  postsBy(userId, limit = 30) {
    return db.select('posts', { user_id: `eq.${userId}`, order: 'created_at.desc', limit });
  },

  activeStories() {
    return db.select('stories', {
      expires_at: `gt.${new Date().toISOString()}`,
      order: 'created_at.desc'
    });
  },

  notifications(myId, limit = 50) {
    return db.select('notifications', {
      user_id: `eq.${myId}`, order: 'created_at.desc', limit
    });
  },

  profileByUsername(username) {
    return db.one('profiles', { username: `eq.${username}` });
  }
};

export default db;
