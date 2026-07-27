# إعداد Neon — أين تجد كل قيمة

> **تنبيه مهم:** Neon غيّرت أسماء الخدمات مؤخراً. لم يعد هناك
> "Publishable Key" منفصل — **رابط Auth وحده يكفي**. صحّحت الملفات وفقاً لذلك.

---

## الخطوة 1 — فعّل Data API

**Neon Console** → مشروعك → **Data API** في الشريط الجانبي

عند التفعيل ستظهر ثلاثة خيارات، **ضع علامة على الأول والثالث**:

| الخيار | ماذا تفعل |
|---|---|
| ☑ **Use Managed Better Auth** | ✅ ضع علامة — هذا يفعّل تسجيل الدخول |
| ☐ Other providers | اتركه |
| ☑ **Grant public schema access** | ✅ ضع علامة — بدونه كل استعلام يفشل |

اضغط **Enable Data API**.

---

## الخطوة 2 — شغّل ملفَّي SQL

**Neon Console** → **SQL Editor**

1. الصق محتوى **`db/01_schema.sql`** كاملاً → **Run**
   يجب أن ترى `Success`. ينشئ 19 جدولاً.

2. الصق محتوى **`db/02_policies.sql`** كاملاً → **Run**
   ينشئ 52 سياسة حماية. في نهايته **جدول تحقّق** يظهر تلقائياً.

**اقرأ جدول التحقّق:** كل صف يجب أن يكون `rls_on = true` و `policies > 0`.
إن رأيت `false` أو `0` في أي صف، أخبرني قبل المتابعة.

3. عد إلى صفحة **Data API** واضغط **Refresh schema cache**
   (بدونها لن ترى الجداول الجديدة)

> الملفان **قابلان لإعادة التشغيل** — إن شغّلتهما مرتين لا يحدث خطأ.

---

## الخطوة 3 — انسخ القيمتين

### 1️⃣ Data API URL

**Neon Console** → **Data API** → أعلى الصفحة **"Data API URL"**

```
https://ep-xxxx-xxxx.data-api.neon.tech
```

### 2️⃣ Auth Base URL

**Neon Console** → **Branch** → **Auth** → **"Auth Base URL"**

```
https://ep-xxxx-xxxx.auth.neon.tech
```

عادةً نفس معرّف المشروع مع `.auth` بدل `.data-api`.

---

## أرسلهما هكذا

```
DATA_API_URL = https://...
AUTH_URL = https://...
```

هاتان القيمتان **عامّتان بطبيعتهما** — تظهران في المتصفح لأي شخص.
الحماية الحقيقية هي الـ52 سياسة التي شغّلتها للتو.

---

## ⛔ لا ترسل هذه أبداً

| القيمة | أين توضع |
|---|---|
| **Connection string** (`postgresql://user:pass@...`) | لا تُستعمل في المتصفح إطلاقاً |
| `R2_SECRET_ACCESS_KEY` | `wrangler secret put` |
| `R2_ACCESS_KEY_ID` | `wrangler secret put` |
| `R2_ACCOUNT_ID` | `wrangler secret put` |
| Neon API Key | لا تُستعمل في المتصفح |

**سبب واضح:** الـconnection string يحتوي كلمة مرور قاعدة البيانات.
من يملكها يتجاوز كل سياسات RLS ويقرأ كل رسائل الطلاب.

---

## الخطوة 4 — أنشئ نفسك أدمن

بعد أن تسجّل حسابك الأول من التطبيق، شغّل مرة واحدة في SQL Editor:

```sql
UPDATE profiles
SET role = 'admin', status = 'approved'
WHERE username = 'اسم_المستخدم_الخاص_بك';
```

سياسات RLS تمنع أي طالب من ترقية نفسه — لذلك **أول أدمن يجب أن يُنشأ هنا**.

بقية الإدارة اليومية في `db/03_admin.sql`:

```sql
-- من ينتظر الموافقة؟
SELECT username, full_name, faculty FROM profiles WHERE status='pending';

-- قبول
UPDATE profiles SET status='approved' WHERE username='sara.b';
```

---

## R2 لاحقاً (اختياري الآن)

الصور تعمل بالبيانات التجريبية حتى تجهّز R2. حين تريد:

1. **R2** → Create bucket → `koliya-media`
2. Settings → **Public access** → فعّله → انسخ `https://pub-xxx.r2.dev`
3. **Manage R2 API Tokens** → Object Read & Write → احفظ المفاتيح **عندك**
4. ⚠️ **CORS** — الخطوة التي ينساها الجميع:

```json
[{
  "AllowedOrigins": ["http://localhost:8080", "https://votre-site.pages.dev"],
  "AllowedMethods": ["PUT", "GET", "HEAD"],
  "AllowedHeaders": ["Content-Type"],
  "ExposeHeaders": ["ETag"],
  "MaxAgeSeconds": 3600
}]
```

5. في جهازك:

```bash
cd server
wrangler secret put R2_ACCOUNT_ID
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
wrangler secret put R2_BUCKET              # koliya-media
wrangler secret put R2_PUBLIC_URL
wrangler secret put NEON_AUTH_JWKS_URL     # <AUTH_URL>/api/auth/jwks
wrangler secret put ALLOWED_ORIGIN
wrangler deploy
```

ثم أرسل لي `R2_PUBLIC_URL` و `UPLOAD_URL` فقط.

---

## ماذا بعد إرسال القيمتين

1. أضعهما في `config_sm.js`
2. أكتب `db_sm.js` و `auth_sm.js` — الاتصال الفعلي
3. أستبدل البيانات التجريبية عبر `useApi()` في كل وحدة
4. أشغّل `./tests/run.sh` (263 اختبار) للتأكد

عندها يعمل **تسجيل الدخول والمنشورات والرسائل والتعليقات** بقاعدة بيانات
حقيقية. الصور تنتظر R2.
