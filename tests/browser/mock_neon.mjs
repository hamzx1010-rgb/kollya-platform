/**
 * mock_neon.mjs — a tiny PostgREST + Better-Auth look-alike.
 *
 * Purpose: run the REAL app (unmodified public/) inside a REAL Chrome,
 * with the network answering the way Neon does. jsdom tests stub
 * `useApi()`; this stubs nothing above fetch(), so db_sm.js, auth_sm.js
 * and api_sm.js all execute for real.
 *
 * It implements only the PostgREST subset the app actually sends:
 *   select=, order=, limit=, offset=, eq./neq./gt./gte./lt./is./in.()
 *   or=(and(a.eq.1,b.eq.2),...)
 *   Prefer: return=representation, resolution=merge-duplicates
 *   HEAD + Prefer: count=exact  ->  Content-Range: 0-24/137
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, '../../public');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon'
};

const iso = m => new Date(Date.now() - m * 60000).toISOString();
const soon = h => new Date(Date.now() + h * 3600000).toISOString();
const PX = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

/* ------------------------------------------------------------------ */
/* seed                                                                */
/* ------------------------------------------------------------------ */
export function seed() {
  const P = (id, u, n, f, xp, extra = {}) => ({
    id, username: u, full_name: n, faculty: f, xp, streak: 4, level: 3,
    status: 'approved', role: id === 'u1' ? 'student' : 'student',
    bio: `Étudiant en ${f}`, avatar_url: null, banner_url: null,
    is_private: false, student_card: `CS-${id.slice(1).padStart(3, '0')}`,
    email: `${u}@carte.koliya.dz`, created_at: iso(60000), ...extra
  });
  return {
    profiles: [
      P('u1', 'sara.b', 'Sara Benali', 'Informatique', 340),
      P('u2', 'youssef', 'Youssef Kader', 'Physique', 640),
      P('u3', 'leila', 'Leila Mansouri', 'Biologie', 295, { is_private: true }),
      P('u4', 'omar.k', 'Omar Kaci', 'Mathématiques', 180),
      P('u5', 'amina.z', 'Amina Zerrouki', 'Informatique', 812),
      P('u6', 'nadir.t', 'Nadir Toumi', 'Informatique', 120),
      // A deeper bench so the leaderboard can actually show ranks 4-20
      // and a tie. Three students share 300 XP on purpose.
      P('u7',  'yacine.h', 'Yacine Haddad',   'Informatique', 720),
      P('u8',  'nour.s',   'Nour Slimani',    'Informatique', 560),
      P('u9',  'karim.b',  'Karim Belkacem',  'Informatique', 480),
      P('u10', 'imene.d',  'Imene Djebbar',   'Informatique', 455),
      P('u11', 'rania.m',  'Rania Meziane',   'Informatique', 430),
      P('u12', 'sofiane.a','Sofiane Ait Ali', 'Informatique', 410),
      P('u13', 'lina.g',   'Lina Gharbi',     'Informatique', 300),
      P('u14', 'anis.r',   'Anis Rahmani',    'Informatique', 300),
      P('u15', 'meriem.k', 'Meriem Kaddour',  'Informatique', 300),
      P('u16', 'walid.z',  'Walid Zerhouni',  'Informatique', 260),
      P('u17', 'hana.f',   'Hana Ferhat',     'Informatique', 240),
      P('u18', 'bilal.n',  'Bilal Nemri',     'Informatique', 210),
      P('u19', 'sami.o',   'Sami Ouali',      'Informatique', 190),
      P('u20', 'dalia.c',  'Dalia Cherif',    'Informatique', 175),
      P('u21', 'ryad.t',   'Ryad Tounsi',     'Informatique', 160),
      P('u22', 'sarah.l',  'Sarah Lounis',    'Informatique', 140),
      P('u23', 'amir.k',   'Amir Kessai',     'Informatique', 130),
      P('u24', 'nesrine.b','Nesrine Bouaziz', 'Informatique', 110),
      P('u25', 'tarek.m',  'Tarek Madani',    'Informatique',  95)
    ],
    posts: [
      { id: 'p1', user_id: 'u5', text: "Quelqu'un a le corrigé de la série 4 en #algo ?", created_at: iso(34), anonymous: false, image_url: null, poll: null },
      { id: 'p2', user_id: 'u3', text: 'Le labo de bio ce matin.', created_at: iso(96), anonymous: false, image_url: PX, poll: null },
      { id: 'p3', user_id: null, text: 'Est-ce que le rythme du semestre est intenable ?', created_at: iso(140), anonymous: true, image_url: null, poll: null },
      { id: 'p4', user_id: 'u4', text: 'Sondage : quel jour pour la révision ?', created_at: iso(210), anonymous: false, image_url: null,
        poll: { options: [{ label: 'Mercredi 14h' }, { label: 'Jeudi 16h' }, { label: 'Samedi matin' }] } },
      { id: 'p5', user_id: 'u2', text: 'Biblio fermée à 18h.', created_at: iso(320), anonymous: false, image_url: null, poll: null },
      { id: 'p6', user_id: 'u1', text: 'Petite victoire : le TP compile du premier coup.', created_at: iso(180), anonymous: false, image_url: null, poll: null }
    ],
    post_likes: [{ post_id: 'p1', user_id: 'u2' }, { post_id: 'p1', user_id: 'u3' }, { post_id: 'p2', user_id: 'u5' }],
    post_saves: [],
    comments: [
      { id: 'c1', post_id: 'p1', user_id: 'u2', text: "Je te l'envoie ce soir", created_at: iso(20) },
      { id: 'c2', post_id: 'p1', user_id: 'u4', text: "Pareil, ça m'intéresse", created_at: iso(15) }
    ],
    poll_votes: [{ post_id: 'p4', user_id: 'u2', choice: 0 }],
    messages: [
      { id: 'm1', sender_id: 'u2', receiver_id: 'u1', text: "Tu as les notes d'algo ?", created_at: iso(190), read_at: null, kind: 'text' },
      { id: 'm2', sender_id: 'u1', receiver_id: 'u2', text: 'Oui je les ai scannées', created_at: iso(186), read_at: iso(180), kind: 'text' },
      { id: 'm3', sender_id: 'u2', receiver_id: 'u1', text: '14h en salle B12', created_at: iso(12), read_at: null, kind: 'text' },
      { id: 'm4', sender_id: 'u3', receiver_id: 'u1', text: 'TP reporté à vendredi', created_at: iso(1440), read_at: null, kind: 'text' },
      { id: 'm5', sender_id: 'u4', receiver_id: 'u1', text: 'Corrigé de la série 3 ?', created_at: iso(60), read_at: null, kind: 'text' },
      { id: 'm6', sender_id: 'u6', receiver_id: 'u1', text: 'Salut, tu es en L3 info ?', created_at: iso(30), read_at: null, kind: 'text' }
    ],
    message_reactions: [{ message_id: 'm3', user_id: 'u1', emoji: 'love' }],
    dm_requests: [{ owner_id: 'u1', peer_id: 'u6', state: 'pending', created_at: iso(30) }],
    chat_folders: [],
    follows: [
      { follower_id: 'u1', followee_id: 'u2' }, { follower_id: 'u1', followee_id: 'u3' },
      { follower_id: 'u1', followee_id: 'u4' }, { follower_id: 'u2', followee_id: 'u1' },
      { follower_id: 'u5', followee_id: 'u1' }
    ],
    blocks: [],
    stories: [
      { id: 's1', user_id: 'u2', media_url: PX, text: 'Amphi plein', created_at: iso(120), expires_at: soon(20) },
      { id: 's2', user_id: 'u3', media_url: PX, text: 'Le labo', created_at: iso(300), expires_at: soon(18) }
    ],
    story_views: [],
    events: [
      { id: 'e1', owner_id: 'u4', title: 'Révision Algo', location: 'Salle B12', starts_at: soon(22), description: 'Tri fusion.' },
      { id: 'e2', owner_id: 'u2', title: 'Conférence quantique', location: 'Amphi A', starts_at: soon(72), description: 'USTHB.' }
    ],
    event_attendees: [{ event_id: 'e1', user_id: 'u2' }],
    qa: [
      { id: 'q1', user_id: null, anonymous: true, text: 'Comment gérez-vous le stress ?', created_at: iso(180) },
      { id: 'q2', user_id: 'u4', anonymous: false, text: "Un bon livre pour l'analyse numérique ?", created_at: iso(1200) }
    ],
    qa_answers: [{ id: 'a1', question_id: 'q1', qa_id: 'q1', user_id: 'u3', text: 'Des pauses fixes.', created_at: iso(120) }],
    qa_answer_votes: [],
    channels: [
      { id: 'ch1', name: 'Informatique L3', faculty: 'Informatique', description: 'TP et TD', official: false, created_at: iso(9000) },
      { id: 'ch2', name: 'Annonces officielles', faculty: null, description: 'Administration', official: true, created_at: iso(9000) },
      { id: 'ch3', name: 'Physique — révisions', faculty: 'Physique', description: 'Poly et exos', official: false, created_at: iso(9000) }
    ],
    channel_members: [{ channel_id: 'ch1', user_id: 'u1' }, { channel_id: 'ch2', user_id: 'u1' }],
    notifications: [
      { id: 'n1', user_id: 'u1', kind: 'like', actor_id: 'u2', target_id: 'p1', text: 'votre publication', created_at: iso(8), read_at: null },
      { id: 'n2', user_id: 'u1', kind: 'comment', actor_id: 'u4', target_id: 'p1', text: "Je te l'envoie", created_at: iso(26), read_at: null },
      { id: 'n3', user_id: 'u1', kind: 'follow', actor_id: 'u5', target_id: null, text: null, created_at: iso(90), read_at: iso(80) }
    ],
    xp_events: [],
    quests: [],
    typing: [],
    reports: []
  };
}

/* ------------------------------------------------------------------ */
/* PostgREST filter engine                                             */
/* ------------------------------------------------------------------ */
const cmp = {
  eq: (a, b) => String(a) === b, neq: (a, b) => String(a) !== b,
  gt: (a, b) => a > b, gte: (a, b) => a >= b, lt: (a, b) => a < b, lte: (a, b) => a <= b,
  is: (a, b) => (b === 'null' ? a === null || a === undefined : String(a) === b),
  like: (a, b) => new RegExp('^' + b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 'i').test(String(a ?? '')),
  ilike: (a, b) => new RegExp('^' + b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 'i').test(String(a ?? '')),
  in: (a, b) => b.replace(/^\(|\)$/g, '').split(',').map(s => s.replace(/^"|"$/g, '')).includes(String(a)),
  cs: () => true, not: () => true
};

function testOp(row, col, expr) {
  const m = /^([a-z]+)\.(.*)$/s.exec(expr);
  if (!m) return true;
  let [, op, val] = m;
  if (op === 'not') { const inner = /^([a-z]+)\.(.*)$/s.exec(val); return inner ? !testOp(row, col, val) : true; }
  const fn = cmp[op];
  return fn ? fn(row[col], val) : true;
}

/** split "a,b,and(c,d)" respecting parens */
function splitTop(s) {
  const out = []; let d = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') d++;
    if (ch === ')') d--;
    if (ch === ',' && d === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function evalLogic(row, expr) {
  const m = /^(and|or)\((.*)\)$/s.exec(expr.trim());
  if (m) {
    const parts = splitTop(m[2]).map(p => evalLogic(row, p));
    return m[1] === 'and' ? parts.every(Boolean) : parts.some(Boolean);
  }
  const i = expr.indexOf('.');
  return testOp(row, expr.slice(0, i), expr.slice(i + 1));
}

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);

function query(rows, params) {
  let out = rows.slice();
  for (const [k, v] of params) {
    if (RESERVED.has(k)) continue;
    if (k === 'or' || k === 'and') { out = out.filter(r => evalLogic(r, `${k}${v}`)); continue; }
    out = out.filter(r => testOp(r, k, v));
  }
  const order = params.get('order');
  if (order) {
    for (const clause of order.split(',').reverse()) {
      const [col, dir = 'asc'] = clause.split('.');
      out.sort((a, b) => {
        const x = a[col], y = b[col];
        if (x === y) return 0;
        if (x === null || x === undefined) return 1;
        if (y === null || y === undefined) return -1;
        return (x > y ? 1 : -1) * (dir.startsWith('desc') ? -1 : 1);
      });
    }
  }
  const total = out.length;
  const off = Number(params.get('offset') || 0);
  const lim = params.get('limit') ? Number(params.get('limit')) : undefined;
  out = out.slice(off, lim === undefined ? undefined : off + lim);
  const sel = params.get('select');
  if (sel && sel !== '*' && !sel.includes('(')) {
    const cols = sel.split(',').map(s => s.trim());
    out = out.map(r => Object.fromEntries(cols.map(c => [c, r[c] ?? null])));
  }
  return { rows: out, total };
}

/* ------------------------------------------------------------------ */
/* server                                                              */
/* ------------------------------------------------------------------ */
export function startMockNeon({ port = 0, signedIn = true, state = seed(), log = [] } = {}) {
  let session = signedIn
    ? { user: { id: 'u1', email: 'cs-001@carte.koliya.dz', name: 'Sara Benali' } }
    : null;
  let seq = 1000;
  const id = () => 'x' + (++seq);

  const cors = req => ({
    'Access-Control-Allow-Origin': req.headers.origin || '*',
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || 'authorization,content-type,prefer',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,HEAD,OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Expose-Headers': 'Content-Range'
  });

  const send = (res, code, body, headers = {}, req = null) => {
    const data = body === undefined ? '' : JSON.stringify(body);
    res.writeHead(code, {
      'Content-Type': 'application/json',
      ...(req ? cors(req) : { 'Access-Control-Allow-Origin': '*' }),
      ...headers
    });
    res.end(data);
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    const S = (code, body, headers) => send(res, code, body, headers, req);
    if (req.method === 'OPTIONS') return S(204);

    let body = '';
    for await (const c of req) body += c;
    const json = body ? (() => { try { return JSON.parse(body); } catch { return null; } })() : null;

    /* ---- auth ---- */
    if (p.startsWith('/auth/')) {
      const a = p.slice('/auth'.length);
      log.push({ kind: 'auth', path: a, method: req.method });
      if (a === '/get-session') return S(200, session ?? {});
      if (a === '/token') return S(200, session ? { token: 'mock.jwt.' + session.user.id } : {});
      if (a === '/sign-in/email') {
        if (json?.callbackURL) return S(400, { code: 'INVALID_CALLBACKURL' });
        const email = String(json?.email || '');
        const card = email.split('@')[0].toUpperCase();
        const prof = state.profiles.find(x => x.student_card.toLowerCase() === card.toLowerCase());
        if (!prof || (json?.password || '').length < 8) return S(401, { code: 'INVALID_EMAIL_OR_PASSWORD' });
        session = { user: { id: prof.id, email, name: prof.full_name } };
        return S(200, session);
      }
      if (a === '/sign-up/email') {
        const uid = id();
        session = { user: { id: uid, email: json?.email, name: json?.name } };
        return S(200, session);
      }
      if (a === '/sign-out') { session = null; return S(200, { ok: true }); }
      if (a === '/.well-known/jwks.json') return S(200, { keys: [] });
      return S(404, { message: 'no route' });
    }

    /* ---- data api ---- */
    if (p.startsWith('/rest/')) {
      const rest = p.slice('/rest'.length);
      if (!/^Bearer /.test(req.headers.authorization || ''))
        return S(401, { message: 'JWT required' });

      if (rest.startsWith('/rpc/')) {
        const fn = rest.slice(5);
        log.push({ kind: 'rpc', fn, args: json });
        const meId = session?.user?.id || 'u1';
        const a = json || {};
        const follows = (x, y) => state.follows.some(f => f.follower_id === x && f.followee_id === y);
        const reqState = peer => state.dm_requests.find(r => r.owner_id === meId && r.peer_id === peer)?.state;
        switch (fn) {
          /* -- 09_requests_sm.sql -- */
          case 'dm_connected': return S(200, follows(a.a, a.b) || follows(a.b, a.a));
          case 'dm_is_request': return S(200, reqState(a.p_peer) === 'pending');
          case 'dm_will_be_request':
            return S(200, !(follows(meId, a.p_user) || follows(a.p_user, meId)) && reqState(a.p_user) !== 'accepted');
          case 'dm_inbox_peers': {
            const peers = [...new Set(state.messages
              .filter(m => m.sender_id === meId || m.receiver_id === meId)
              .map(m => (m.sender_id === meId ? m.receiver_id : m.sender_id)))]
              .filter(p => reqState(p) !== 'pending' && reqState(p) !== 'declined');
            return S(200, peers.map(peer_id => ({ peer_id })));
          }
          case 'dm_requests_list':
            return S(200, state.dm_requests.filter(r => r.owner_id === meId && r.state === 'pending')
              .map(r => ({ peer_id: r.peer_id, created_at: r.created_at,
                last_text: state.messages.filter(m => m.sender_id === r.peer_id && m.receiver_id === meId).at(-1)?.text || '' })));
          case 'dm_requests_count':
            return S(200, state.dm_requests.filter(r => r.owner_id === meId && r.state === 'pending').length);
          case 'dm_accept': {
            const r = state.dm_requests.find(x => x.owner_id === meId && x.peer_id === a.p_peer);
            if (r) r.state = 'accepted';
            return S(200, null);
          }
          case 'dm_decline': {
            const r = state.dm_requests.find(x => x.owner_id === meId && x.peer_id === a.p_peer);
            if (r) r.state = 'declined';       // silent: sender is never told
            return S(200, null);
          }
          case 'dm_delete_request':
            state.dm_requests = state.dm_requests.filter(x => !(x.owner_id === meId && x.peer_id === a.p_peer));
            return S(200, null);
          case 'can_message': return S(200, true);
          case 'messageable': {
            const q = String(a.p_query || '').toLowerCase();
            return S(200, state.profiles.filter(p => p.id !== meId &&
              (!q || p.username.includes(q) || p.full_name.toLowerCase().includes(q))));
          }
          /* -- 07_privacy_sm.sql -- */
          case 'profile_counts': {
            const u = a.p_user;
            return S(200, [{
              followers: state.follows.filter(f => f.followee_id === u).length,
              following: state.follows.filter(f => f.follower_id === u).length,
              posts: state.posts.filter(p => p.user_id === u).length
            }]);
          }
          case 'name_change_status': return S(200, [{ can_change: true, next_allowed_at: null }]);
          case 'pending_alerts': return S(200, []);
          /* -- 06_game_sm.sql -- */
          case 'my_quests': return S(200, state.quests.filter(q => q.user_id === meId)
            .map(q => ({ quest_id: q.quest_id, progress: q.progress, done: q.done })));
          case 'track_quest': {
            const key = a.p_quest || a.p_quest_id || a.quest_id;
            let q = state.quests.find(x => x.user_id === meId && x.quest_id === key && x.day === new Date().toISOString().slice(0, 10));
            if (!q) { q = { user_id: meId, quest_id: key, progress: 0, goal: a.p_goal || 1, done: false, day: new Date().toISOString().slice(0, 10) }; state.quests.push(q); }
            q.progress += a.p_step ?? a.p_amount ?? 1;
            q.done = q.progress >= (a.p_goal || q.goal || 1);
            return S(200, [{ quest_id: q.quest_id, progress: q.progress, done: q.done }]);
          }
          case 'award_xp': {
            const prof = state.profiles.find(p => p.id === meId);
            const amount = a.p_amount ?? a.p_xp ?? 0;
            state.xp_events.push({ id: id(), user_id: meId, kind: a.p_kind, amount, created_at: new Date().toISOString() });
            if (prof) prof.xp = (prof.xp || 0) + amount;
            return S(200, [{ xp: prof?.xp ?? 0, awarded: amount }]);
          }
          case 'resolve_streak': {
            const prof = state.profiles.find(p => p.id === meId);
            return S(200, [{ streak: prof?.streak ?? 0, broke: false, froze: false }]);
          }
          case 'touch_presence': return S(200, null);
          default: return S(200, []);
        }
      }
      const table = rest.slice(1);
      if (!(table in state)) return S(404, { message: `relation "${table}" does not exist` });
      log.push({ kind: 'db', method: req.method, table, qs: url.search });

      if (req.method === 'HEAD' || req.method === 'GET') {
        const { rows, total } = query(state[table], url.searchParams);
        const hdr = { 'Content-Range': `0-${Math.max(rows.length - 1, 0)}/${total}` };
        if (req.method === 'HEAD') { res.writeHead(200, { ...hdr, ...cors(req) }); return res.end(); }
        return S(200, rows, hdr);
      }
      if (req.method === 'POST') {
        const rows = (Array.isArray(json) ? json : [json]).map(r => ({ id: id(), created_at: new Date().toISOString(), ...r }));
        const merge = /merge-duplicates/.test(req.headers.prefer || '');
        for (const r of rows) {
          if (merge) {
            const keys = Object.keys(r).filter(k => k.endsWith('_id'));
            const dup = state[table].find(x => keys.every(k => x[k] === r[k]));
            if (dup) { Object.assign(dup, r); continue; }
          }
          state[table].push(r);
        }
        return S(201, rows);
      }
      if (req.method === 'PATCH') {
        const { rows } = query(state[table], url.searchParams);
        rows.forEach(r => Object.assign(state[table].find(x => x === r) || r, json));
        const hit = state[table].filter(r => [...url.searchParams].every(([k, v]) => RESERVED.has(k) || testOp(r, k, v)));
        hit.forEach(r => Object.assign(r, json));
        return S(200, hit);
      }
      if (req.method === 'DELETE') {
        const doomed = state[table].filter(r => [...url.searchParams].every(([k, v]) => RESERVED.has(k) || testOp(r, k, v)));
        state[table] = state[table].filter(r => !doomed.includes(r));
        return S(200, doomed);
      }
    }

    /* ---- static files ---- */
    let file = p === '/' ? '/index_sm.html' : p;
    const abs = path.join(PUBLIC, file);
    if (!abs.startsWith(PUBLIC) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
      res.writeHead(404); return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream' });
    res.end(fs.readFileSync(abs));
  });

  return new Promise(resolve => {
    server.listen(port, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${server.address().port}`;
      resolve({ url, server, state, log, close: () => new Promise(r => server.close(r)) });
    });
  });
}
