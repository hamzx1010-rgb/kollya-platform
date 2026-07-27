# النشر على GitHub ثم Render

> ✅ حضّرت كل شيء: `render.yaml` · `_redirects` · `index.html` · `.gitignore`
> وفحصت الرفع فعلياً: **71 ملفاً، صفر أسرار، صفر `node_modules`**.

---

## ⚠️ الفخ الذي كان سيُفشل النشر

ملف التطبيق اسمه **`index_sm.html`**، لكن كل استضافة ثابتة — Render
منها — تبحث عن **`index.html`** عند فتح `/`.

بدون معالجة، موقعك كان سيعطي **404 Not Found** عند أول زيارة.

حللتها بثلاث طبقات (أي واحدة تكفي، والثلاث معاً تضمن النجاح):

| الملف | الدور |
|---|---|
| `render.yaml` | يوجّه كل مسار إلى `index_sm.html` |
| `public/_redirects` | نفس القاعدة بصيغة أخرى |
| `public/index.html` | صفحة صغيرة تحوّل، **وتحافظ على `#/messages/u2`** |

الطبقة الثالثة تعني أن الروابط العميقة تعمل حتى لو أخطأت في إعداد Render.

---

## 1️⃣ ارفع إلى GitHub

في مجلد المشروع:

```bash
cd koliya

git init
git add .
git commit -m "Koliya — réseau social étudiant"
git branch -M main
```

أنشئ مستودعاً على [github.com/new](https://github.com/new):
- الاسم: `koliya`
- **Private** ← أنصح به (فيه روابط مشروعك)
- **لا تضع علامة** على "Add README" — عندك واحد

ثم:

```bash
git remote add origin https://github.com/اسمك/koliya.git
git push -u origin main
```

> إن طلب كلمة مرور: GitHub لم يعد يقبلها. أنشئ **Personal Access Token**
> من Settings → Developer settings → Tokens (classic) → صلاحية `repo`،
> واستعمله بدل كلمة المرور.

---

## 2️⃣ انشر على Render

[dashboard.render.com](https://dashboard.render.com) → **New +** → **Static Site**

> ⚠️ **Static Site** وليس Web Service. تطبيقك يتصل بـNeon من المتصفح
> مباشرة — لا يوجد خادم Node يعمل. اختيار Web Service سيفشل لأنه
> سيبحث عن `npm start`.

اربط المستودع، ثم:

| الحقل | القيمة |
|---|---|
| **Name** | `koliya` |
| **Branch** | `main` |
| **Root Directory** | *(اتركه فارغاً)* |
| **Build Command** | *(اتركه فارغاً)* |
| **Publish Directory** | `public` |

اضغط **Create Static Site**. أول نشر ~دقيقة.

> Render سيقرأ `render.yaml` تلقائياً ويطبّق التوجيه ورؤوس التخزين المؤقت.

---

## 3️⃣ الخطوة التي ينساها الجميع

بعد النشر ستحصل على رابط مثل `https://koliya.onrender.com`.

**أضفه في Neon فوراً:**

**Neon Console → Auth → Trusted domains** →
```
https://koliya.onrender.com
```

بدونه سيرى كل طالب `Domaine non autorisé` عند محاولة الدخول،
والموقع سيبدو معطلاً تماماً.

---

## 4️⃣ تحقّق أنه يعمل

| الفحص | المتوقع |
|---|---|
| افتح الرابط الرئيسي | شاشة الدخول تظهر |
| سجّل حساباً | ينجح ويدخل |
| تحقّق في Neon SQL | الصف موجود في `profiles` |
| افتح `/#/hub` مباشرة | يفتح Hub لا 404 |
| حدّث الصفحة (F5) | تبقى مسجّلاً |
| افتح من الهاتف | يعمل |

فحص الجلسة:
```sql
SELECT student_card, username, status, created_at
FROM profiles ORDER BY created_at DESC LIMIT 5;
```

---

## التحديثات لاحقاً

```bash
git add .
git commit -m "وصف التغيير"
git push
```

Render ينشر تلقائياً خلال دقيقة.

---

## بديل أسرع — Cloudflare Pages

تطبيقك موقع ثابت، وCloudflare أسرع لشمال أفريقيا من Render المجاني
(الذي **ينام بعد 15 دقيقة خمول** ويأخذ ~30 ثانية للاستيقاظ).

[dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages**
→ **Create** → **Pages** → اربط GitHub

| الحقل | القيمة |
|---|---|
| Build command | *(فارغ)* |
| Build output directory | `public` |

مزايا: لا نوم · شبكة أسرع · **ونفس حساب R2** الذي ستستعمله للصور.

**إن اخترته:** أضف `https://koliya.pages.dev` في Trusted domains بدلاً من رابط Render.

---

## ⛔ قبل فتح الموقع لطلاب حقيقيين

**١. أعد الموافقة اليدوية** — في SQL Editor شغّل قسم التراجع من
`db/04_testing_sm.sql`:

```sql
ALTER TABLE profiles ALTER COLUMN status SET DEFAULT 'pending';

DROP POLICY IF EXISTS profiles_insert_self ON profiles;
CREATE POLICY profiles_insert_self ON profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.user_id() AND role = 'student' AND status = 'pending');

DELETE FROM profiles WHERE id LIKE 'seed-%';
```

بدونه **أي شخص على الإنترنت** يسجّل ويدخل فوراً — وتطبيقك للطلاب
الموثّقين ببطاقاتهم.

**٢. اجعل نفسك أدمن أولاً:**
```sql
UPDATE profiles SET role='admin', status='approved'
WHERE upper(student_card) = upper('بطاقتك');
```

**٣. احذف المعاينات** إن أردت (اختياري):
`public/preview_*.html` — أدوات تطوير لا يحتاجها الطلاب.

---

## ملاحظة عن الملفات المرفوعة

**آمنة للنشر العلني:** `config_sm.js` يحوي روابط Neon فقط، وهي **عامة
بطبيعتها**. الحماية الحقيقية هي 52 سياسة RLS في قاعدة بياناتك.

**غير مرفوعة أبداً:** `.env` · `.wrangler/` · `node_modules/` —
مستبعدة في `.gitignore` وتحققت من ذلك فعلياً.
