# بنية مجلد koliya — الحالة الآن

```
🆕 = ملف جديد في هذه الجلسة
✅ = ملف موجود، أُصلح
   = لم يُلمس
```

---

```
koliya/
│
├── 📄 التوثيق
│   ├── GAME_SM.md                      🆕 شرح اللعبة كاملاً
│   ├── STRUCTURE_NOW_sm.md             🆕 هذا الملف
│   ├── PLAN_FIX_sm.md                     الخطة التي وافقت عليها
│   ├── DEPLOY_sm.md · README.md           النشر
│   ├── SETUP_VALUES_sm.md · TEST_LOGIN_sm.md
│   ├── TODO_sm.md · NEXT_STEPS_sm.md · FOLDERS_sm.md
│   ├── STRUCTURE_sm.md · FIX_LOADING_sm.md
│   └── .env.example · .gitignore · render.yaml · package.json
│
├── 🗄️ db/                              قاعدة البيانات — شغّلها بالترتيب
│   ├── 01_schema.sql          251س        ١· الجداول (19 جدولاً)
│   ├── 02_policies.sql        327س        ٢· RLS (52 سياسة)
│   ├── 03_admin.sql            87س           أدوات المشرف
│   ├── 04_testing_sm.sql       64س           موافقة تلقائية للاختبار
│   ├── 05_upgrade_sm.sql      216س     🆕 ٣· الصور داخل القاعدة
│   │                                        + استطلاعات + بصمة صوتية
│   │                                        + تصويت Q&A + «يكتب الآن»
│   └── 06_game_sm.sql         345س     🆕 ٤· اللعبة داخل Postgres
│                                            xp_events · quests
│                                            resolve_streak() · تجميدة
│
├── 🌐 public/
│   │
│   ├── index.html · index_sm.html          الصفحة
│   ├── check_sm.html                       تشخيص (يفحص 30 ملفاً)
│   ├── manifest_sm.json · sw_sm.js · offline_sm.html
│   ├── _redirects · icons/ (10 ملفات)
│   ├── preview_*.html (5)                  معاينات قديمة
│   │
│   ├── 🎨 css/
│   │   ├── base_sm.css        367س     ✅ --nav-w-collapsed: 76→64px
│   │   ├── components_sm.css  484س
│   │   └── layout_sm.css     2140س     ✅ +560 سطراً:
│   │                                        الشريط المطوي · لوحة الرسائل
│   │                                        حلقات الستوري · hero الفعاليات
│   │                                        hero الأسئلة · تعديل البروفايل
│   │                                        شارات الترتيب · التجميدة
│   │
│   └── 📜 js/
│       │
│       ├── app_sm.js          327س     ✅ يستدعي connectApi() ← السبب
│       │                                    الجذري لـ«لا شيء يُسجَّل»
│       │                                    + wireGame() + initGame()
│       │
│       ├── 🔧 core/
│       │   ├── api_sm.js      916س     🆕 الجسر إلى Neon — 8 وحدات
│       │   ├── game_sm.js     403س     🆕 محرّك اللعبة
│       │   ├── media_sm.js    181س     🆕 الصور → data: URL في القاعدة
│       │   ├── people_sm.js    60س     🆕 ذاكرة واحدة للملفات الشخصية
│       │   ├── db_sm.js       253س     ✅ حارس الحجم بدل منع base64
│       │   ├── config_sm.js    88س        مفاتيح Neon (تعمل)
│       │   ├── auth_sm.js     319س        كارت الطالب → إيميل
│       │   ├── store_sm.js    380س        localStorage حقيقي
│       │   ├── router_sm.js   304س        توجيه + اختصارات
│       │   ├── ui_sm.js       510س        toast · modal · قوائم
│       │   ├── shell_sm.js    285س        الهيكل
│       │   ├── icons_sm.js    195س        72 أيقونة SVG · بلا emoji
│       │   └── utils_sm.js    359س        esc · html · cssEscape
│       │
│       └── ⚡ features/
│           ├── feed_sm.js     783س     ✅ منشورات + تعليقات + إعجاب
│           │                                + استطلاع + repost → Neon
│           ├── messages_sm.js 1472س    ✅ رسائل + بحث + تصدير
│           │                                + تحويل + محادثة جديدة
│           ├── stories_sm.js   364س    ✅ أُعيد بناؤه: إنشاء ستوري
│           │                                + مشاهدون + حذف + رد
│           ├── profile_sm.js   694س    ✅ صورة وغلاف يُسجَّلان
│           │                                + ورقة تعديل جديدة
│           ├── campus_sm.js    719س    ✅ أُعيد بناؤه: hero الفعاليات
│           │                                + hero الأسئلة + قنوات
│           ├── notifications_sm.js 276س ✅ مقروء في القاعدة لا المتصفح
│           ├── hub_sm.js       413س    ✅ التحدّيات من المحرّك
│           ├── leaderboard_sm.js 206س  ✅ من profiles الحقيقية
│           ├── auth_ui_sm.js   298س       شاشة الدخول
│           ├── editor_sm.js    484س       محرّر الصور
│           ├── voice_sm.js     296س       تسجيل صوتي
│           └── gif_sm.js       196س       منتقي GIF
│
├── 🧪 tests/                            454/454 ناجح
│   ├── run.sh
│   ├── fake_api.mjs           323س     🆕 بيانات اختبار مشتركة
│   ├── game.test.mjs          233س     🆕 65 اختباراً للعبة
│   ├── campus.test.mjs        210س     ✅ 67
│   ├── feed.test.mjs          171س     ✅ 45
│   ├── hub-profile.test.mjs   160س     ✅ 54
│   ├── auth-ui.test.mjs       150س        54
│   ├── core.test.mjs          123س        57
│   ├── db-auth.test.mjs       113س     ✅ 39
│   ├── app.test.mjs           115س     ✅ 47
│   └── leaderboard.test.mjs   105س     ✅ 26
│
└── ☁️ server/                           لم يعد مطلوباً (لا R2)
    ├── upload-worker.js       176س
    └── wrangler.toml
```

---

## شكاواك ← أين أُصلحت

| شكواك | الملف | ماذا تغيّر |
|---|---|---|
| «التعليقات لا تُسجَّل» | `api_sm.js` 🆕 + `feed_sm.js` ✅ | تكتب في `comments`، وتُقرأ ثانيةً من القاعدة عند الفتح |
| «الصورة والغلاف لا يعملان» | `media_sm.js` 🆕 + `profile_sm.js` ✅ + `05_upgrade` 🆕 | تُصغَّر في المتصفح ثم تُخزَّن `data:` داخل `profiles`. كانت `blob:` تموت عند التحديث |
| «الرسائل لا تعمل» | `messages_sm.js` ✅ + `api_sm.js` 🆕 | كل رسالة تدخل `messages`. تحديث كل 5 ثوانٍ |
| «الستوري: Chargement ولا شيء» | `stories_sm.js` ✅ | كانت روابط Unsplash خارجية. الآن من القاعدة، والفاشلة **تقول** إنها فشلت |
| «حلقات الستوري مكسورة» | `layout_sm.css` ✅ | كان الابن 100% + حدود داخل حشو الأب. الآن `calc(100% - 5px)` |
| «تعديل البروفايل رخيص» | `profile_sm.js` ✅ + CSS ✅ | ورقة كاملة: غلاف وصورة حيّان · أقسام · فاكلتي · روابط · خصوصية |
| «الفعاليات مثل القديم مع مربّع الإنشاء» | `campus_sm.js` ✅ + CSS ✅ | hero متدرّج 28px + الدائرة الناعمة + زر الإنشاء **عليه** |
| «نفس الشيء للأسئلة» | `campus_sm.js` ✅ | hero أزرق بنفس البنية |
| «لوحة الرسائل تظهر عند نصف الشاشة» | `layout_sm.css` ✅ | كانت 660px محجوزة. الآن `clamp(260px,26vw,330px)` والإنفو تطفو تحت 1400px |
| «الطي يكسر الشريط والأيقونات تختفي» | CSS ✅ | كان 28px لأيقونة 22px. الآن هدف 44px مركزي، الشريط 64px |
| «ميزات تقول قريباً» | 3 ملفات ✅ | **صفر** الآن: إنشاء ستوري · إنشاء قناة · بحث · تصدير · تحويل · repost |
| «اللعبة مرئيات فقط، لا خسارة» | `game_sm.js` 🆕 + `06_game` 🆕 | `trackQuest()` كانت بلا مستدعٍ واحد. الآن 8 وحدات تُطلق `act()`، والـstreak ينهار فعلاً |

---

## الترتيب الذي تشغّله في Neon

```
1. db/01_schema.sql        ← إن لم تشغّله بعد
2. db/02_policies.sql      ← إن لم تشغّله بعد
3. db/05_upgrade_sm.sql    ← جديد
4. db/06_game_sm.sql       ← جديد
5. db/04_testing_sm.sql    ← اختياري: موافقة تلقائية أثناء التجربة
```

ثم في Neon → Data API → **Refresh schema cache**.

---

## ملاحظتان

**`server/`** لم يعد مطلوباً — طلبت الصور مباشرة في القاعدة، فلا R2.
اتركه أو احذفه، لا فرق.

**`preview_*.html`** معاينات من جلسة قديمة، سابقة للربط. يمكنك حذفها.

**لم أشغّل شيئاً على متصفح حقيقي ولا على Neon الحية.** 454 اختباراً تمر
في jsdom. الاختبار الحاسم يبقى: اكتب تعليقاً → حدّث → هل بقي؟
