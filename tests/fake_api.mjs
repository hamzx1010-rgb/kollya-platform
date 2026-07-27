/**
 * An in-memory stand-in for api_sm.js.
 *
 * The feature modules used to carry their own sample arrays, which is
 * exactly the bug we just removed: the tests passed against data the
 * real app never saw. Now the fixture lives here, the modules stay
 * honest, and a test that forgets to inject an API fails loudly
 * instead of quietly rendering invented posts.
 */

const now = Date.now();
const ago = m => new Date(now - m * 60000).toISOString();

export const PEOPLE = [
  { id:'u1', username:'sara.b',  full_name:'Sara Benali',    faculty:'Informatique', xp:340, streak:7,  status:'approved' },
  { id:'u2', username:'youssef', full_name:'Youssef Kader',  faculty:'Physique',     xp:640, streak:12, status:'approved' },
  { id:'u3', username:'leila',   full_name:'Leila Mansouri', faculty:'Biologie',     xp:295, streak:3,  status:'approved', is_private:true },
  { id:'u4', username:'omar.k',  full_name:'Omar Kaci',      faculty:'Mathématiques',xp:180, streak:1,  status:'approved' },
  { id:'u5', username:'amina.z', full_name:'Amina Zerrouki', faculty:'Informatique', xp:812, streak:21, status:'approved' }
];

export function makeState() {
  return {
    posts: [
      { id:'p1', user_id:'u5', text:"Quelqu'un a le corrigé de la série 4 en #algo ?", created_at:ago(34),
        likes:['u2','u3'], saves:[], poll:null,
        comments:[{ id:'c1', user_id:'u2', text:"Je te l'envoie ce soir", created_at:ago(20) },
                  { id:'c2', user_id:'u4', text:"Pareil, ça m'intéresse", created_at:ago(15) }] },
      { id:'p2', user_id:'u3', text:'Le labo de bio ce matin.', created_at:ago(96),
        image_url:'data:image/gif;base64,R0lGODlhAQABAAAAACw=', likes:['u2','u4','u5'], saves:[], comments:[], poll:null },
      { id:'p3', user_id:null, anonymous:true, text:'Est-ce que le rythme du semestre est intenable ?',
        created_at:ago(140), likes:['u2','u3','u4','u5'], saves:[], poll:null,
        comments:[{ id:'c3', user_id:'u3', text:"Tu n'es pas seul.", created_at:ago(100) }] },
      { id:'p4', user_id:'u4', text:'Sondage : quel jour pour la révision ?', created_at:ago(210),
        likes:[], saves:[], comments:[],
        poll:{ options:[{ label:'Mercredi 14h', votes:['u2','u5'] },
                        { label:'Jeudi 16h',    votes:['u3'] },
                        { label:'Samedi matin', votes:[] }] } },
      { id:'p5', user_id:'u2', text:'Biblio fermée à 18h. https://univ-alger.dz/biblio', created_at:ago(320),
        likes:['u5'], saves:[], comments:[], poll:null },
      // three of my own, so the profile tabs have something to render
      { id:'p6', user_id:'u1', text:'Petite victoire : le TP compile du premier coup.', created_at:ago(180),
        likes:['u2','u3'], saves:[], comments:[{ id:'c9', user_id:'u2', text:'Bravo', created_at:ago(120) }], poll:null },
      { id:'p7', user_id:'u1', text:'Quelqu\'un pour réviser #algo demain ?', created_at:ago(1560),
        image_url:'data:image/gif;base64,R0lGODlhAQABAAAAACw=', likes:['u5'], saves:[], comments:[], poll:null },
      { id:'p8', user_id:'u1', text:'Les notes du semestre sont sorties.', created_at:ago(4320),
        likes:[], saves:[], comments:[], poll:null }
    ],
    messages: {
      u2: [
        { id:'m1', sender_id:'u2', receiver_id:'u1', text:"Tu as les notes d'algo ?", created_at:ago(190), reactions:{} },
        { id:'m2', sender_id:'u1', receiver_id:'u2', text:'Oui je les ai scannées', created_at:ago(186), reactions:{} },
        { id:'m3', sender_id:'u2', receiver_id:'u1', text:'14h en salle B12', created_at:ago(12), reactions:{ u1:'love' } }
      ],
      u3: [{ id:'m4', sender_id:'u3', receiver_id:'u1', text:'TP reporté à vendredi', created_at:ago(1440), reactions:{} }],
      u4: [{ id:'m5', sender_id:'u4', receiver_id:'u1', text:'Corrigé de la série 3 ?', created_at:ago(60), reactions:{} }]
    },
    stories: [
      { user_id:'u2', items:[
        { id:'s1a', media_url:'data:image/gif;base64,R0lGODlhAQABAAAAACw=', text:'Amphi plein ce matin', created_at:ago(120) },
        { id:'s1b', media_url:'data:image/gif;base64,R0lGODlhAQABAAAAACw=', text:'Révision jusqu\'à la fermeture', created_at:ago(60) }
      ] },
      { user_id:'u3', items:[{ id:'s2', media_url:'data:image/gif;base64,R0lGODlhAQABAAAAACw=', text:'Le labo',    created_at:ago(300) }] },
      { user_id:'u5', items:[{ id:'s3', media_url:'data:image/gif;base64,R0lGODlhAQABAAAAACw=', text:'',           created_at:ago(540) }] }
    ],
    events: [
      { id:'e1', owner_id:'u4', title:'Révision Algo', location:'Salle B12',
        starts_at:new Date(now + 22 * 3600000).toISOString(), description:'Tri fusion.', going:['u2','u5'] },
      { id:'e2', owner_id:'u2', title:'Conférence quantique', location:'Amphi A',
        starts_at:new Date(now + 3 * 86400000).toISOString(), description:'USTHB.', going:['u3'] },
      { id:'e3', owner_id:'u3', title:'Sortie terrain — écologie', location:'Parking nord',
        starts_at:new Date(now + 8 * 86400000).toISOString(), description:'Chaussures de marche.', going:[] }
    ],
    questions: [
      { id:'q1', anonymous:true, user_id:null, text:'Comment gérez-vous le stress ?', created_at:ago(180),
        answers:[{ id:'a1', user_id:'u3', text:'Des pauses fixes.', votes:7, myVote:false, created_at:ago(120) },
                 { id:'a2', user_id:'u2', text:'Sport le matin.',   votes:3, myVote:false, created_at:ago(60) }] },
      { id:'q2', anonymous:false, user_id:'u4', text:'Un bon livre pour l\'analyse numérique ?', created_at:ago(1200), answers:[] }
    ],
    channels: [
      { id:'c1', name:'Informatique L3', faculty:'Informatique', members:128, joined:true, unread:3, description:'TP et TD' },
      { id:'c2', name:'Annonces officielles', official:true, members:1240, joined:true, description:'Administration' },
      { id:'c3', name:'Physique — révisions', faculty:'Physique', members:64, joined:false, description:'Poly et exos' },
      { id:'c4', name:'Petites annonces', members:302, joined:false, unread:12, description:'Vends calculatrice' }
    ],
    notifications: [
      { id:'n1', kind:'like',    actor:'u2', target:'p1', text:'votre publication', at:ago(8),  read:false },
      { id:'n2', kind:'like',    actor:'u3', target:'p1', text:'votre publication', at:ago(12), read:false },
      { id:'n3', kind:'like',    actor:'u5', target:'p1', text:'votre publication', at:ago(20), read:false },
      { id:'n4', kind:'comment', actor:'u4', target:'p1', text:"Je te l'envoie",    at:ago(26), read:false },
      { id:'n5', kind:'follow',  actor:'u5', at:ago(90),  read:true },
      { id:'n6', kind:'mention', actor:'u3', target:'p2', text:'@sara.b tu viens ?', at:ago(150), read:false },
      { id:'n7', kind:'request', actor:'u4', at:ago(220), read:false }
    ],
    profiles: Object.fromEntries(PEOPLE.map(p => [p.username, {
      ...p, bio:`Bio de ${p.full_name}`, followers:38, following:52, posts:3,
      followState:'none', private:!!p.is_private
    }])),
    writes: []          // every mutation is recorded so tests can assert
  };
}

/** Build an api object over a state bag. `st.writes` records mutations. */
export function fakeApi(st, myId = 'u1') {
  const log = (op, payload) => { st.writes.push({ op, payload }); };
  const clone = v => JSON.parse(JSON.stringify(v));

  return {
    /* ---- feed ---- */
    async listPosts(which) {
      // the feed shows other people; your own posts live on your profile
      const others = st.posts.filter(p => p.user_id !== myId);
      if (which === 'following') return clone(others.filter(p => ['u2','u3'].includes(p.user_id)));
      if (which === 'faculty')   return clone(others.filter(p => ['u5'].includes(p.user_id)));
      return clone(others);
    },
    async createPost(draft) {
      const row = {
        id: 'p' + (st.posts.length + 1),
        user_id: draft.anonymous ? null : myId,
        anonymous: !!draft.anonymous,
        text: draft.text || '',
        created_at: new Date().toISOString(),
        likes: [], saves: [], comments: [],
        image_url: draft.file ? 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' : (draft.image_url || null),
        poll: draft.poll ? { options: draft.poll.options.map(l => ({ label: l, votes: [] })) } : null
      };
      st.posts.unshift(row);
      log('createPost', row);
      return clone(row);
    },
    async deletePost(id) { st.posts = st.posts.filter(p => p.id !== id); log('deletePost', id); },
    async like(id, on) {
      const p = st.posts.find(x => x.id === id);
      p.likes = on ? [...p.likes, myId] : p.likes.filter(u => u !== myId);
      log('like', { id, on });
    },
    async save(id, on) {
      const p = st.posts.find(x => x.id === id);
      p.saves = on ? [...(p.saves || []), myId] : (p.saves || []).filter(u => u !== myId);
      log('save', { id, on });
    },
    async vote(id, choice) {
      const p = st.posts.find(x => x.id === id);
      p.poll.options[choice].votes.push(myId);
      log('vote', { id, choice });
    },
    async comment(postId, text) {
      const row = { id: 'c' + Date.now(), post_id: postId, user_id: myId, text, created_at: new Date().toISOString() };
      const p = st.posts.find(x => x.id === postId);
      p.comments = [...(p.comments || []), row];
      log('comment', row);
      return clone(row);
    },
    async listComments(postId) { return clone(st.posts.find(x => x.id === postId)?.comments || []); },
    async deleteComment(id) {
      for (const p of st.posts) p.comments = (p.comments || []).filter(c => String(c.id) !== String(id));
      log('deleteComment', id);
    },
    async listSaved() { return clone(st.posts.filter(p => (p.saves || []).includes(myId))); },

    /* ---- messages ---- */
    async listConversations() {
      return Object.entries(st.messages).map(([peerId, thread]) => ({
        peer: PEOPLE.find(p => p.id === peerId),
        last: thread[thread.length - 1],
        unread: peerId === 'u4' ? 1 : 0
      })).sort((a, b) => new Date(b.last.created_at) - new Date(a.last.created_at));
    },
    async listMessages(peerId) { return clone(st.messages[peerId] || []); },
    async sendMessage(payload) {
      const row = {
        id: 'm' + Date.now() + Math.random().toString(36).slice(2, 6),
        sender_id: myId, receiver_id: payload.receiver_id,
        text: payload.text || '', reply_to: payload.reply_to || null,
        media_url: payload.file ? 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' : (payload.media_url || null),
        media_type: payload.media_type || null,
        media_name: payload.media_name || null,
        created_at: new Date().toISOString(), reactions: {}
      };
      (st.messages[payload.receiver_id] ||= []).push(row);
      log('sendMessage', row);
      return clone(row);
    },
    async react(id, key) {
      for (const thread of Object.values(st.messages)) {
        const m = thread.find(x => x.id === id);
        if (m) { m.reactions ||= {}; if (key) m.reactions[myId] = key; else delete m.reactions[myId]; }
      }
      log('react', { id, key });
    },
    async markRead(id) { log('markRead', id); },
    async editMessage(id, text) {
      for (const thread of Object.values(st.messages)) {
        const m = thread.find(x => x.id === id);
        if (m) m.text = text;
      }
      log('editMessage', { id, text });
    },
    async deleteMessage(id) {
      for (const k of Object.keys(st.messages)) st.messages[k] = st.messages[k].filter(m => m.id !== id);
      log('deleteMessage', id);
    },
    async clearThread(peerId) { st.messages[peerId] = []; log('clearThread', peerId); },
    async setTyping() {},
    async isTyping() { return false; },
    async searchInThread(peerId, q) {
      return clone((st.messages[peerId] || []).filter(m => (m.text || '').toLowerCase().includes(q.toLowerCase())));
    },
    async contacts(q = '') {
      return PEOPLE.filter(p => p.id !== myId &&
        (!q || p.full_name.toLowerCase().includes(q.toLowerCase()) || p.username.includes(q)));
    },

    /* ---- stories ---- */
    async listStories() {
      return st.stories.map(g => ({ ...clone(g), user: PEOPLE.find(p => p.id === g.user_id) }));
    },
    async createStory({ text }) {
      const item = { id: 's' + Date.now(), media_url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', text, created_at: new Date().toISOString() };
      const mine = st.stories.find(g => g.user_id === myId);
      if (mine) mine.items.push(item); else st.stories.unshift({ user_id: myId, items: [item] });
      log('createStory', item);
      return item;
    },
    async markSeen(id) { log('markSeen', id); },
    async viewers() { return []; },
    async deleteStory(id) {
      for (const g of st.stories) g.items = g.items.filter(i => i.id !== id);
      st.stories = st.stories.filter(g => g.items.length);
      log('deleteStory', id);
    },
    async reply(userId, text) { return this.sendMessage({ receiver_id: userId, text }); },

    /* ---- profile ---- */
    async getProfile(username) {
      const key = username || 'sara.b';
      const row = st.profiles[key];
      if (!row) return null;
      return { ...clone(row), isMe: row.id === myId };
    },
    async listPosts_(userId) { return clone(st.posts.filter(p => p.user_id === userId)); },
    async listLiked(userId) { return clone(st.posts.filter(p => p.likes.includes(userId))); },
    async follow(userId, next) { log('follow', { userId, next }); },
    async followers() { return PEOPLE.slice(1, 4); },
    async following() { return PEOPLE.slice(2, 5); },
    async updateProfile(patch, files = {}) {
      const mine = st.profiles['sara.b'];
      Object.assign(mine, patch);
      if (files.avatarFile) mine.avatar_url = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
      if (files.bannerFile) mine.banner_url = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
      log('updateProfile', { patch, files: Object.keys(files) });
      return clone(mine);
    },
    async block(id) { log('block', id); },
    async report(t, id, reason) { log('report', { t, id, reason }); },

    /* ---- campus ---- */
    async listChannels() { return clone(st.channels); },
    async createChannel(c) { const row = { id: 'c' + Date.now(), members: 1, joined: true, ...c }; st.channels.push(row); log('createChannel', row); return row; },
    async joinChannel(id, on) { const c = st.channels.find(x => String(x.id) === String(id)); if (c) c.joined = on; log('joinChannel', { id, on }); },
    async deleteChannel(id) { st.channels = st.channels.filter(c => String(c.id) !== String(id)); },
    async listEvents() { return clone(st.events); },
    async createEvent(e) { const row = { id: 'e' + Date.now(), owner_id: myId, going: [myId], ...e }; st.events.push(row); log('createEvent', row); return row; },
    async attend(id, on) {
      const e = st.events.find(x => String(x.id) === String(id));
      if (e) e.going = on ? [...e.going, myId] : e.going.filter(u => u !== myId);
      log('attend', { id, on });
    },
    async deleteEvent(id) { st.events = st.events.filter(e => String(e.id) !== String(id)); log('deleteEvent', id); },
    async listQuestions() { return clone(st.questions); },
    async ask({ text, anonymous }) {
      const row = { id: 'q' + Date.now(), text, anonymous, user_id: anonymous ? null : myId, created_at: new Date().toISOString(), answers: [] };
      st.questions.unshift(row); log('ask', row); return row;
    },
    async answer(qaId, text) {
      const row = { id: 'a' + Date.now(), qa_id: qaId, user_id: myId, text, votes: 0, myVote: false, created_at: new Date().toISOString() };
      st.questions.find(q => String(q.id) === String(qaId))?.answers.push(row);
      log('answer', row); return row;
    },
    async voteAnswer(id, on) { log('voteAnswer', { id, on }); },
    async deleteQuestion(id) { st.questions = st.questions.filter(q => String(q.id) !== String(id)); },
    async searchPeople(q = '') {
      return PEOPLE.filter(p => p.id !== myId &&
        (!q || p.full_name.toLowerCase().includes(q) || p.username.includes(q) || (p.faculty || '').toLowerCase().includes(q)));
    },
    async searchPosts(q = '') { return clone(st.posts.filter(p => (p.text || '').toLowerCase().includes(q))); },
    async trends() {
      return [{ tag:'algo', posts:42 }, { tag:'partiels', posts:38 }, { tag:'biblio', posts:21 },
              { tag:'stage', posts:17 }, { tag:'bourse', posts:12 }];
    },

    /* ---- notifications ---- */
    async listNotifications() { return clone(st.notifications); },
    async markRead_(ids) { log('markRead', ids); },
    async markAllRead() { st.notifications.forEach(n => { n.read = true; }); log('markAllRead', null); },
    async dismiss(ids) {
      const list = Array.isArray(ids) ? ids.map(String) : [String(ids)];
      st.notifications = st.notifications.filter(n => !list.includes(String(n.id)));
      log('dismiss', list);
    },
    async unreadCount() { return st.notifications.filter(n => !n.read).length; },
    async respondToRequest(actor, accept) { log('respondToRequest', { actor, accept }); },

    /* ---- hub / leaderboard ---- */
    async stats() {
      return { posts: 14, comments: 31, likes: 62, answers: 12, followers: 38,
               events: 1, saved: 9, nightPosts: 2, xp: 340, streak: 7 };
    },
    async addXp(n) { log('addXp', n); return 340 + n; },
    async setStreak(n) { log('setStreak', n); return n; },
    async leaderboard({ scope = 'faculty' } = {}) {
      const rows = scope === 'faculty' ? PEOPLE.filter(p => p.faculty === 'Informatique') : PEOPLE;
      return clone(rows);
    }
  };
}

/** profile_sm calls api.listPosts(userId); feed calls api.listPosts(tab). */
export function profileApiFor(st, myId = 'u1') {
  const a = fakeApi(st, myId);
  return { ...a, listPosts: a.listPosts_ };
}
