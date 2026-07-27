# ما تبقّى — Koliya

**الحالة:** 354/354 اختبار · 19 وحدة · الواجهة كاملة · قاعدة البيانات متصلة لكن غير مربوطة بالوحدات بعد.

---

## 🔴 عليك أنت — 5 دقائق، ويتوقف كل شيء عليها

### 1. فعّل الدخول بالبريد
**Neon Console → Auth → Sign-in methods → Email & Password**

الخادم يردّ الآن حرفياً:
```json
{"code":"EMAIL_AND_PASSWORD_IS_NOT_ENABLED"}
```
**بدونها لا يستطيع أي طالب التسجيل.** هذا الحاجز الوحيد المتبقّي أمام تشغيل حقيقي.

وفي نفس الصفحة: أنصح **بتعطيل** `Require email verification` — لأن الطالب يسجّل ببطاقته، والعنوان الداخلي `@carte.koliya.dz` لا يستقبل بريداً. عندك بالفعل موافقة يدوية عبر `status='pending'`.

### 2. النطاقات الموثوقة
**Neon Console → Auth → Trusted domains**
```
http://localhost:8099
https://<موقعك>.pages.dev
```

### 3. شغّل ملفَّي SQL (إن لم تفعل)
`db/01_schema.sql` ← `db/02_policies.sql` ← ثم **Data API → Refresh schema cache**

⚠️ **عدّلت المخطط**: `student_card` صار `UNIQUE`. إن كنت شغّلت النسخة القديمة:
```sql
ALTER TABLE profiles ADD CONSTRAINT profiles_student_card_key UNIQUE (student_card);
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_card ON profiles(upper(student_card));
```

**اقرأ جدول التحقّق** في نهاية `02_policies.sql`: كل صف `rls_on = true` و `policies > 0`.

---

## 🟠 عليّ أنا — بعد إتمامك للخطوات أعلاه

### أ. ربط الوحدات بقاعدة البيانات ← الأهم
كل وحدة فيها `useApi()` جاهزة لكن **لا شيء يستدعيها بعد**:

| الوحدة | ماذا يُربط |
|---|---|
| `messages_sm` | المحادثات والرسائل الحقيقية |
| `feed_sm` | المنشورات · الإعجابات · التعليقات · الاستطلاعات |
| `profile_sm` | البروفايلات · المتابعة |
| `notifications_sm` | الإشعارات |
| `hub_sm` | XP · الشارات · الترتيب |
| `campus_sm` | القنوات · الفعاليات · Q&A |
| `stories_sm` | الستوريز |

سطر واحد لكل وحدة في `app_sm.js` + دوال الوصلات في `db_sm.js`.

### ب. أول حساب أدمن
بعد أن تسجّل حسابك من التطبيق:
```sql
UPDATE profiles SET role='admin', status='approved' WHERE student_card='بطاقتك';
```
RLS تمنع أي طالب من ترقية نفسه — **أول أدمن يجب أن يُنشأ يدوياً**.

### ج. المزامنة التكيّفية
`POLL` معرّفة في الإعدادات لكن غير مفعّلة: 4ث في محادثة نشطة · 20ث عند التصفح · **تتوقف** عند إخفاء التبويب.

---

## 🟡 لاحقاً — لا يمنع الإطلاق

### R2 للصور (الصور تعمل بالتجريبي حالياً)
1. R2 → bucket `koliya-media` → **Public access**
2. **CORS** ← الخطوة التي ينساها الجميع:
```json
[{"AllowedOrigins":["http://localhost:8099","https://<موقعك>.pages.dev"],
  "AllowedMethods":["PUT","GET","HEAD"],"AllowedHeaders":["Content-Type"],
  "ExposeHeaders":["ETag"],"MaxAgeSeconds":3600}]
```
3. `cd server && wrangler secret put ...` ثم `wrangler deploy`
4. أرسل لي `R2_PUBLIC_URL` و `UPLOAD_URL`

> الـworker مُصحَّح ليتحقّق بـ**EdDSA/Ed25519** — مشروعك يوقّع بها، وكان سيرفض كل توكن صحيح لو تركته على RSA.

### GIF حقيقية
مفتاح Tenor أو Giphy (مقيّد بالنطاق، آمن للمتصفح) → المربعات الملوّنة تصبح GIFs.

### شاشتان ناقصتان
`leaderboard` و `settings` ما زالتا عناصر نائبة.

### النشر
Cloudflare Pages أو Netlify — اسحب `public/`. موقع ثابت، بلا خادم.

---

## ⛔ لا ترسل هنا أبداً
`R2_SECRET_ACCESS_KEY` · `R2_ACCESS_KEY_ID` · `R2_ACCOUNT_ID` · connection string · أي Neon API key
→ كلها عبر `wrangler secret put` في جهازك.

---

## الترتيب المقترح

```
1. فعّل Email & Password + Trusted domains     ← أنت (5 دقائق)
2. سجّل أول حساب من التطبيق                    ← أنت
3. اجعل نفسك أدمن بـSQL                        ← أنت
4. أربط الوحدات السبع بقاعدة البيانات          ← أنا
5. R2 + GIF                                    ← لاحقاً
6. النشر                                       ← لاحقاً
```

**الخطوة 1 هي كل ما يفصلك عن تطبيق يعمل فعلاً.**
