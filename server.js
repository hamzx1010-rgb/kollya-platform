import express from 'express';
import session from 'express-session';
import bodyParser from 'body-parser';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Database file
const dbFile = path.join(__dirname, 'data.json');

// Initialize database
const initDatabase = () => {
  if (!fs.existsSync(dbFile)) {
    const initialData = {
      users: {
        admin: {
          id: 'admin',
          username: 'admin',
          fullName: 'المدير',
          email: 'admin@kollya.dz',
          password: 'admin123', // In production, hash this!
          isAdmin: true,
          isBanned: false,
          createdAt: new Date().toISOString(),
          avatar: 'م'
        }
      },
      posts: [],
      comments: [],
      messages: [],
      channels: [
        {
          id: 1,
          name: 'قناة الجامعة',
          description: 'قناة رسمية لأخبار الجامعة',
          members: ['admin'],
          official: true,
          icon: '🏫'
        }
      ],
      notifications: [],
      likes: [],
      saves: [],
      follows: []
    };
    fs.writeFileSync(dbFile, JSON.stringify(initialData, null, 2));
  }
};

const readDB = () => JSON.parse(fs.readFileSync(dbFile, 'utf8'));
const writeDB = (data) => fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));

// Middleware
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());
app.use(express.static(__dirname));

app.use(session({
  secret: 'kollya-secret-key-2024',
  resave: true,
  saveUninitialized: true,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 7 days
}));

// Initialize DB on startup
initDatabase();

// ============ AUTH ROUTES ============

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const db = readDB();
  
  const user = Object.values(db.users).find(u => u.username === username);
  
  if (!user || user.password !== password) {
    return res.json({ success: false, message: 'بيانات دخول غير صحيحة' });
  }
  
  if (user.isBanned) {
    return res.json({ success: false, message: 'حسابك محظور' });
  }
  
  req.session.userId = user.id;
  res.json({ 
    success: true, 
    user: {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      isAdmin: user.isAdmin,
      avatar: user.avatar
    }
  });
});

app.post('/api/register', (req, res) => {
  const { fullName, username, password, carte, bac } = req.body;
  const db = readDB();
  
  // Basic validation
  if (!fullName || !username || !password || password.length < 8) {
    return res.json({ success: false, message: 'بيانات غير صحيحة' });
  }
  
  // Check if username exists
  if (Object.values(db.users).find(u => u.username === username)) {
    return res.json({ success: false, message: 'اسم المستخدم موجود بالفعل' });
  }
  
  const userId = 'user_' + Date.now();
  const avatar = fullName.charAt(0);
  
  db.users[userId] = {
    id: userId,
    username,
    fullName,
    password, // In production, hash this!
    carte,
    bac,
    isAdmin: false,
    isBanned: false,
    createdAt: new Date().toISOString(),
    avatar,
    followers: [],
    following: []
  };
  
  writeDB(db);
  
  req.session.userId = userId;
  res.json({ 
    success: true,
    user: {
      id: userId,
      username,
      fullName,
      isAdmin: false,
      avatar
    }
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) {
    return res.json({ user: null });
  }
  
  const db = readDB();
  const user = db.users[req.session.userId];
  
  if (!user) {
    return res.json({ user: null });
  }
  
  res.json({ 
    user: {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      isAdmin: user.isAdmin,
      avatar: user.avatar
    }
  });
});

// ============ POSTS ROUTES ============

app.post('/api/posts', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ success: false });
  
  const { content, image, channel } = req.body;
  const db = readDB();
  const user = db.users[req.session.userId];
  
  if (!content || content.trim().length === 0) {
    return res.json({ success: false, message: 'المنشور فارغ' });
  }
  
  const postId = 'post_' + Date.now();
  const post = {
    id: postId,
    userId: req.session.userId,
    username: user.username,
    fullName: user.fullName,
    avatar: user.avatar,
    content: content.substring(0, 500),
    image,
    channel: channel || 'الرسائل',
    timestamp: new Date().toISOString(),
    likes: [],
    comments: [],
    saves: [],
    isApproved: true
  };
  
  db.posts.unshift(post);
  writeDB(db);
  
  res.json({ success: true, post });
});

app.get('/api/posts', (req, res) => {
  const db = readDB();
  const channel = req.query.channel || 'الرسائل';
  
  let posts = db.posts.filter(p => p.channel === channel && p.isApproved);
  
  res.json({ posts });
});

app.delete('/api/posts/:postId', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ success: false });
  
  const db = readDB();
  const post = db.posts.find(p => p.id === req.params.postId);
  
  if (!post) return res.json({ success: false, message: 'المنشور غير موجود' });
  
  const user = db.users[req.session.userId];
  if (post.userId !== req.session.userId && !user.isAdmin) {
    return res.json({ success: false, message: 'غير مصرح' });
  }
  
  db.posts = db.posts.filter(p => p.id !== req.params.postId);
  writeDB(db);
  
  res.json({ success: true });
});

// ============ COMMENTS ROUTES ============

app.post('/api/comments', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ success: false });
  
  const { postId, content } = req.body;
  const db = readDB();
  const user = db.users[req.session.userId];
  const post = db.posts.find(p => p.id === postId);
  
  if (!post) return res.json({ success: false });
  
  const comment = {
    id: 'comment_' + Date.now(),
    postId,
    userId: req.session.userId,
    username: user.username,
    fullName: user.fullName,
    avatar: user.avatar,
    content,
    timestamp: new Date().toISOString(),
    likes: []
  };
  
  post.comments.push(comment);
  
  // Notification
  if (post.userId !== req.session.userId) {
    db.notifications.push({
      id: 'notif_' + Date.now(),
      userId: post.userId,
      type: 'comment',
      actor: user.fullName,
      postId,
      timestamp: new Date().toISOString(),
      read: false
    });
  }
  
  writeDB(db);
  res.json({ success: true, comment });
});

app.get('/api/comments/:postId', (req, res) => {
  const db = readDB();
  const post = db.posts.find(p => p.id === req.params.postId);
  
  if (!post) return res.json({ comments: [] });
  
  res.json({ comments: post.comments });
});

app.delete('/api/comments/:commentId', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ success: false });
  
  const db = readDB();
  const post = db.posts.find(p => 
    p.comments.find(c => c.id === req.params.commentId)
  );
  
  if (!post) return res.json({ success: false });
  
  const comment = post.comments.find(c => c.id === req.params.commentId);
  const user = db.users[req.session.userId];
  
  if (comment.userId !== req.session.userId && !user.isAdmin) {
    return res.json({ success: false });
  }
  
  post.comments = post.comments.filter(c => c.id !== req.params.commentId);
  writeDB(db);
  
  res.json({ success: true });
});

// ============ LIKES ROUTES ============

app.post('/api/likes', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ success: false });
  
  const { postId } = req.body;
  const db = readDB();
  const post = db.posts.find(p => p.id === postId);
  
  if (!post) return res.json({ success: false });
  
  const index = post.likes.indexOf(req.session.userId);
  
  if (index === -1) {
    post.likes.push(req.session.userId);
  } else {
    post.likes.splice(index, 1);
  }
  
  writeDB(db);
  res.json({ success: true, likes: post.likes });
});

// ============ SAVES ROUTES ============

app.post('/api/saves', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ success: false });
  
  const { postId } = req.body;
  const db = readDB();
  const post = db.posts.find(p => p.id === postId);
  
  if (!post) return res.json({ success: false });
  
  const index = post.saves.indexOf(req.session.userId);
  
  if (index === -1) {
    post.saves.push(req.session.userId);
  } else {
    post.saves.splice(index, 1);
  }
  
  writeDB(db);
  res.json({ success: true, saves: post.saves });
});

// ============ MESSAGES ROUTES ============

app.post('/api/messages', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ success: false });
  
  const { recipientId, content, image } = req.body;
  const db = readDB();
  const user = db.users[req.session.userId];
  
  const message = {
    id: 'msg_' + Date.now(),
    senderId: req.session.userId,
    senderName: user.fullName,
    recipientId,
    content,
    image,
    timestamp: new Date().toISOString(),
    read: false
  };
  
  db.messages.push(message);
  writeDB(db);
  
  res.json({ success: true, message });
});

app.get('/api/messages/:userId', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ messages: [] });
  
  const db = readDB();
  const messages = db.messages.filter(m => 
    (m.senderId === req.session.userId && m.recipientId === req.params.userId) ||
    (m.senderId === req.params.userId && m.recipientId === req.session.userId)
  ).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  
  // Mark as read
  db.messages = db.messages.map(m => {
    if (m.recipientId === req.session.userId && m.senderId === req.params.userId) {
      m.read = true;
    }
    return m;
  });
  writeDB(db);
  
  res.json({ messages });
});

app.get('/api/conversations', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ conversations: [] });
  
  const db = readDB();
  const userMessages = db.messages.filter(m => 
    m.senderId === req.session.userId || m.recipientId === req.session.userId
  );
  
  const conversationMap = {};
  
  userMessages.forEach(msg => {
    const otherId = msg.senderId === req.session.userId ? msg.recipientId : msg.senderId;
    if (!conversationMap[otherId]) {
      const otherUser = db.users[otherId];
      conversationMap[otherId] = {
        userId: otherId,
        name: otherUser.fullName,
        avatar: otherUser.avatar,
        lastMessage: msg.content,
        timestamp: msg.timestamp,
        unread: !msg.read && msg.recipientId === req.session.userId
      };
    } else {
      conversationMap[otherId].lastMessage = msg.content;
      conversationMap[otherId].timestamp = msg.timestamp;
      if (!msg.read && msg.recipientId === req.session.userId) {
        conversationMap[otherId].unread = true;
      }
    }
  });
  
  const conversations = Object.values(conversationMap)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  
  res.json({ conversations });
});

// ============ NOTIFICATIONS ROUTES ============

app.get('/api/notifications', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ notifications: [] });
  
  const db = readDB();
  const notifications = db.notifications.filter(n => n.userId === req.session.userId);
  
  res.json({ notifications });
});

// ============ CHANNELS ROUTES ============

app.get('/api/channels', (req, res) => {
  const db = readDB();
  res.json({ channels: db.channels });
});

app.post('/api/channels', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ success: false });
  
  const db = readDB();
  const user = db.users[req.session.userId];
  
  if (!user.isAdmin) {
    return res.json({ success: false, message: 'غير مصرح' });
  }
  
  const { name, description, icon } = req.body;
  const channel = {
    id: db.channels.length + 1,
    name,
    description,
    members: [req.session.userId],
    official: false,
    icon: icon || '📢'
  };
  
  db.channels.push(channel);
  writeDB(db);
  
  res.json({ success: true, channel });
});

// ============ ADMIN ROUTES ============

app.get('/api/admin/stats', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ success: false });
  
  const db = readDB();
  const user = db.users[req.session.userId];
  
  if (!user.isAdmin) return res.json({ success: false });
  
  res.json({
    success: true,
    stats: {
      totalUsers: Object.keys(db.users).length,
      totalPosts: db.posts.length,
      totalComments: db.posts.reduce((sum, p) => sum + p.comments.length, 0),
      bannedUsers: Object.values(db.users).filter(u => u.isBanned).length
    }
  });
});

app.get('/api/admin/users', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ success: false });
  
  const db = readDB();
  const user = db.users[req.session.userId];
  
  if (!user.isAdmin) return res.json({ success: false });
  
  const users = Object.values(db.users).map(u => ({
    id: u.id,
    username: u.username,
    fullName: u.fullName,
    isAdmin: u.isAdmin,
    isBanned: u.isBanned,
    createdAt: u.createdAt,
    postCount: db.posts.filter(p => p.userId === u.id).length
  }));
  
  res.json({ users });
});

app.post('/api/admin/ban-user', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ success: false });
  
  const db = readDB();
  const user = db.users[req.session.userId];
  
  if (!user.isAdmin) return res.json({ success: false });
  
  const { userId } = req.body;
  const targetUser = db.users[userId];
  
  if (!targetUser) return res.json({ success: false });
  
  targetUser.isBanned = !targetUser.isBanned;
  writeDB(db);
  
  res.json({ success: true, isBanned: targetUser.isBanned });
});

app.post('/api/admin/approve-post', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ success: false });
  
  const db = readDB();
  const user = db.users[req.session.userId];
  
  if (!user.isAdmin) return res.json({ success: false });
  
  const { postId } = req.body;
  const post = db.posts.find(p => p.id === postId);
  
  if (!post) return res.json({ success: false });
  
  post.isApproved = !post.isApproved;
  writeDB(db);
  
  res.json({ success: true, isApproved: post.isApproved });
});

app.delete('/api/admin/delete-post', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ success: false });
  
  const db = readDB();
  const user = db.users[req.session.userId];
  
  if (!user.isAdmin) return res.json({ success: false });
  
  const { postId } = req.body;
  db.posts = db.posts.filter(p => p.id !== postId);
  writeDB(db);
  
  res.json({ success: true });
});

app.get('/api/admin/pending-posts', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ success: false });
  
  const db = readDB();
  const user = db.users[req.session.userId];
  
  if (!user.isAdmin) return res.json({ success: false });
  
  const pending = db.posts.filter(p => !p.isApproved);
  
  res.json({ posts: pending });
});

// ============ USER PROFILE ROUTES ============

app.get('/api/users/:userId', (req, res) => {
  const db = readDB();
  const user = db.users[req.params.userId];
  
  if (!user) return res.json({ success: false });
  
  const userPosts = db.posts.filter(p => p.userId === req.params.userId && p.isApproved);
  
  res.json({
    user: {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      avatar: user.avatar,
      createdAt: user.createdAt,
      followers: user.followers || [],
      following: user.following || [],
      postCount: userPosts.length
    },
    posts: userPosts
  });
});

app.post('/api/follow', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ success: false });
  
  const db = readDB();
  const user = db.users[req.session.userId];
  const targetUser = db.users[req.body.userId];
  
  if (!targetUser) return res.json({ success: false });
  
  if (!user.followers) user.followers = [];
  if (!user.following) user.following = [];
  if (!targetUser.followers) targetUser.followers = [];
  
  const index = user.following.indexOf(req.body.userId);
  
  if (index === -1) {
    user.following.push(req.body.userId);
    targetUser.followers.push(req.session.userId);
  } else {
    user.following.splice(index, 1);
    targetUser.followers = targetUser.followers.filter(id => id !== req.session.userId);
  }
  
  writeDB(db);
  res.json({ success: true });
});

// Serve static files
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🎓 كلية - الخادم يعمل على http://localhost:${PORT}`);
  console.log('إدارة: admin / admin123');
});
