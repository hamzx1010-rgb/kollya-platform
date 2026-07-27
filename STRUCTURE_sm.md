# بنية المشروع — Koliya

**380 اختبار · 21 وحدة · ~12,000 سطر**

```
koliya/
│
├── 📄 TEST_LOGIN_sm.md      ← ابدأ من هنا لتجربة الدخول
├── 📄 TODO_sm.md            ما تبقّى
├── 📄 SETUP_VALUES_sm.md    من أين تأتي كل قيمة
├── 📄 NEXT_STEPS_sm.md      إعدادات Neon
├── 📄 STRUCTURE_sm.md       هذا الملف
├── 📄 README.md
│
├── 🗄️ db/                                    ← شغّلها في Neon SQL Editor
│   ├── 01_schema.sql          19 جدول
│   ├── 02_policies.sql        52 سياسة RLS  ← الحماية الحقيقية
│   ├── 03_admin.sql           الإدارة اليدوية
│   └── 04_testing_sm.sql      ⭐ موافقة تلقائية + طلاب تجريبيون
│
├── ☁️ server/
│   ├── upload-worker.js       توقيع الرفع لـR2 (EdDSA)
│   └── wrangler.toml
│
├── 🧪 tests/                                 ← bash tests/run.sh
│   ├── run.sh
│   ├── app.test.mjs           46  التطبيق كاملاً
│   ├── auth-ui.test.mjs       54  الدخول ببطاقة الطالب
│   ├── campus.test.mjs        64  ستوريز·إشعارات·قنوات·فعاليات·Q&A
│   ├── core.test.mjs          57  الأدوات·الحالة·الراوتر·الأيقونات
│   ├── db-auth.test.mjs       35  ⚡ يضرب Neon الحيّ فعلاً
│   ├── feed.test.mjs          45  المنشورات·الاستطلاعات·التعليقات
│   ├── hub-profile.test.mjs   53  XP·الشارات·البروفايل
│   └── leaderboard.test.mjs   26  ⭐ الترتيب والتعادل
│
└── 🌐 public/                                ← هذا ما يُنشر
    │
    ├── index_sm.html          هيكل التطبيق
    ├── offline_sm.html        عند انقطاع الشبكة
    ├── manifest_sm.json       PWA
    ├── sw_sm.js               service worker
    │
    ├── preview_sm.html        نظام التصميم
    ├── preview_auth_sm.html   شاشات الدخول
    ├── preview_chat_sm.html   المحادثة
    ├── preview_feed_sm.html   الفيد
    ├── preview_hub_sm.html    Hub والبروفايل
    │
    ├── icons/                 9 أيقونات PNG + SVG
    │
    ├── css/
    │   ├── base_sm.css        الرموز·الثيمات·الحركة
    │   ├── components_sm.css  الأزرار·القوائم·النوافذ
    │   └── layout_sm.css      الشاشات
    │
    └── js/
        ├── app_sm.js          ⭐ نقطة البداية
        │
        ├── core/
        │   ├── config_sm.js   ✅ روابط Neon مضبوطة
        │   ├── auth_sm.js     ⭐ الدخول ببطاقة الطالب
        │   ├── db_sm.js       ⭐ عميل Data API
        │   ├── store_sm.js    الحالة والجلسة
        │   ├── router_sm.js   التنقّل والاختصارات
        │   ├── ui_sm.js       النوافذ·القوائم·التنبيهات
        │   ├── shell_sm.js    الإطار والشريط الجانبي
        │   ├── icons_sm.js    72 أيقونة + 6 تفاعلات SVG
        │   └── utils_sm.js    esc·html·timeAgo…
        │
        └── features/
            ├── feed_sm.js          المنشورات·الاستطلاعات·المجهول
            ├── messages_sm.js      المحادثات·لوحة الإنفو
            ├── stories_sm.js       عارض الستوريز
            ├── hub_sm.js           XP·الشارات·التحديات
            ├── profile_sm.js       البروفايل
            ├── leaderboard_sm.js   ⭐ الترتيب
            ├── campus_sm.js        قنوات·فعاليات·Q&A·استكشاف
            ├── notifications_sm.js إشعارات مجمّعة
            ├── auth_ui_sm.js       ⭐ شاشات الدخول
            ├── editor_sm.js        محرر الصور
            ├── gif_sm.js           منتقي GIF
            └── voice_sm.js         الرسائل الصوتية
```

---

## كيف يبدأ التطبيق

```
index_sm.html
   └── app_sm.js
        ├── initStore()        الثيم واللغة والجلسة
        ├── hydrateIcons()     <i data-icon> → SVG
        ├── initShell()        الشريط والإطار
        ├── init*(mount)       تسجيل كل شاشة
        └── resolveSession()
             ├── لا قاعدة بيانات  → وضع المعاينة
             ├── غير مسجّل        → شاشة الدخول
             ├── pending          → شاشة الانتظار
             └── approved         → التطبيق
```

## قاعدة معمارية واحدة

```
Postgres  →  نصوص وأرقام وعلاقات وروابط
R2        →  كل صورة وفيديو وصوت وملف
```

`db_sm.js` يرمي خطأً **قبل الشبكة** لو حاول أي كود كتابة `data:` في عمود رابط.

## ما يعمل بقاعدة البيانات الآن

| ✅ حقيقي | ⏳ تجريبي |
|---|---|
| التسجيل · الدخول · الخروج | الفيد · الرسائل · الستوريز |
| صف `profiles` في Neon | Hub · البروفايل · الترتيب |
| الجلسة · التوكن · RLS | الإشعارات · القنوات |

كل وحدة فيها `useApi()` — الربط سطر واحد لكل شاشة.
