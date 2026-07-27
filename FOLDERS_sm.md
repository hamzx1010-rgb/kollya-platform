# بنية المجلدات — للتحميل اليدوي

**72 ملفاً.** أنشئ المجلدات أولاً، ثم ضع كل ملف في مكانه.

---

## 📁 المجلدات التي تنشئها (9)

```
koliya/
koliya/db/
koliya/public/
koliya/public/css/
koliya/public/icons/
koliya/public/js/
koliya/public/js/core/
koliya/public/js/features/
koliya/server/
koliya/tests/
```

---

## 🌳 الشجرة الكاملة

```
koliya/
│
├── db/                              ← تشغّلها في Neon SQL Editor
│   ├── 01_schema.sql
│   ├── 02_policies.sql
│   ├── 03_admin.sql
│   └── 04_testing_sm.sql
│
├── public/                          ← ★ هذا ما يُنشر على Render
│   │
│   ├── css/
│   │   ├── base_sm.css
│   │   ├── components_sm.css
│   │   └── layout_sm.css
│   │
│   ├── icons/
│   │   ├── apple-touch-icon.png
│   │   ├── badge-72.png
│   │   ├── icon-192.png
│   │   ├── icon-512.png
│   │   ├── icon.svg
│   │   ├── maskable-192.png
│   │   ├── maskable-512.png
│   │   ├── shortcut-bell.png
│   │   ├── shortcut-compose.png
│   │   └── shortcut-messages.png
│   │
│   ├── js/
│   │   ├── core/
│   │   │   ├── auth_sm.js
│   │   │   ├── config_sm.js
│   │   │   ├── db_sm.js
│   │   │   ├── icons_sm.js
│   │   │   ├── router_sm.js
│   │   │   ├── shell_sm.js
│   │   │   ├── store_sm.js
│   │   │   ├── ui_sm.js
│   │   │   └── utils_sm.js
│   │   │
│   │   ├── features/
│   │   │   ├── auth_ui_sm.js
│   │   │   ├── campus_sm.js
│   │   │   ├── editor_sm.js
│   │   │   ├── feed_sm.js
│   │   │   ├── gif_sm.js
│   │   │   ├── hub_sm.js
│   │   │   ├── leaderboard_sm.js
│   │   │   ├── messages_sm.js
│   │   │   ├── notifications_sm.js
│   │   │   ├── profile_sm.js
│   │   │   ├── stories_sm.js
│   │   │   └── voice_sm.js
│   │   │
│   │   └── app_sm.js
│   │
│   ├── _redirects                   ← بلا امتداد، الاسم هكذا بالضبط
│   ├── index.html                   ← ★ ضروري وإلا 404
│   ├── index_sm.html                ← ★ التطبيق
│   ├── manifest_sm.json
│   ├── offline_sm.html
│   ├── sw_sm.js
│   ├── preview_auth_sm.html         ← اختياري (أدوات تطوير)
│   ├── preview_chat_sm.html         ← اختياري
│   ├── preview_feed_sm.html         ← اختياري
│   ├── preview_hub_sm.html          ← اختياري
│   └── preview_sm.html              ← اختياري
│
├── server/                          ← لاحقاً، عند إعداد R2
│   ├── upload-worker.js
│   └── wrangler.toml
│
├── tests/                           ← اختياري للنشر
│   ├── app.test.mjs
│   ├── auth-ui.test.mjs
│   ├── campus.test.mjs
│   ├── core.test.mjs
│   ├── db-auth.test.mjs
│   ├── feed.test.mjs
│   ├── hub-profile.test.mjs
│   ├── leaderboard.test.mjs
│   └── run.sh
│
├── .env.example
├── .gitignore                       ← ★ يبدأ بنقطة
├── package.json
├── render.yaml                      ← ★ إعدادات Render
│
└── README.md  ·  DEPLOY_sm.md  ·  TEST_LOGIN_sm.md
    TODO_sm.md  ·  STRUCTURE_sm.md  ·  SETUP_VALUES_sm.md
    NEXT_STEPS_sm.md  ·  FOLDERS_sm.md
```

---

## ⚠️ ثلاثة أخطاء ستكسر الموقع

**١. `index.html` مفقود**
ملف التطبيق اسمه `index_sm.html`، لكن Render يبحث عن `index.html`.
بدونه → **404 عند فتح الموقع**. الملف الصغير يحوّل تلقائياً.

**٢. `.gitignore` و `_redirects` لا يظهران**
الأول يبدأ بنقطة (مخفي في بعض الأنظمة)، والثاني **بلا امتداد**.
في ويندوز: أنشئه بـNotepad واحفظ باسم `"_redirects"` **مع علامتَي التنصيص**.

**٣. الحالة والشرطات السفلية**
`auth_sm.js` ≠ `Auth_SM.js`. Render حساس لحالة الأحرف، وويندوز لا —
فالموقع يعمل عندك ويفشل بعد النشر.

---

## ✅ الحد الأدنى للنشر (49 ملفاً)

إن أردت الأخف، ارفع فقط:

```
public/**          (كل شيء ما عدا preview_*.html)
render.yaml
.gitignore
```

`db/` و `tests/` و `server/` و ملفات `.md` **لا يحتاجها الموقع** —
لكن احتفظ بها في GitHub كنسخة احتياطية.

---

## 🧪 تحقّق قبل الرفع

افتح المجلد في الطرفية:

```bash
cd koliya/public
python3 -m http.server 8099
```

ثم `http://localhost:8099`

| الفحص | المتوقع |
|---|---|
| الصفحة تفتح | شاشة الدخول |
| Console (F12) | **صفر أخطاء حمراء** |
| `/#/hub` مباشرة | يفتح Hub |

**إن رأيت `404` لملف ما** في الـConsole → اسمه أو مساره خطأ. الرسالة
تخبرك بالمسار المتوقع بالضبط.

---

## إعداد Render

**New + → Static Site** (وليس Web Service)

| الحقل | القيمة |
|---|---|
| Build Command | *(اتركه فارغاً)* |
| Publish Directory | `public` |

ثم **أضف رابط الموقع في Neon → Auth → Trusted domains** —
بدونه كل طالب سيرى `Domaine non autorisé`.
