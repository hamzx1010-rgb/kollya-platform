# Koliya-1.00.apk — سبب عدم وصول الرسائل، والـ APK الذي كان فارغاً

**`apk/Koliya-1.00.apk` · versionCode 5 · versionName 1.00 · 3.8 MB · موقّع · zipaligned**

---

## 1. كنت محقّاً: نسخة 1.2 لم تحتوِ على شيء

فحصت الملف الذي أعطيتك إياه:

```
hub-strip داخل الـ APK          : 0
campus-tabs داخل الـ APK        : 0
nav-desk داخل الـ APK           : 0
data-nav="campus" داخل الـ APK  : 0
progressStripMarkup داخل الـ APK: 0
```

**صفر في كل شيء.** عدّلت `public/` وصوّرت من Chrome ولم أُعِد بناء الـ APK.
الصور كانت حقيقية لكنها لا تصف الملف الذي بيدك. لا عذر لي.

### ما فعلته حتى لا يتكرّر
`build_apk.sh` الآن **يفكّ الـ APK بعد بنائه** ويفتّش عن 16 علامة داخله.
أي علامة ناقصة = **فشل البناء** ورفض الملف، لا تحذير. مخرجات هذا البناء:

```
ok  hub progress strip css      css/layout_sm.css (3)
ok  campus tab strip css        css/layout_sm.css (5)
ok  form-factor nav rules       css/layout_sm.css (2)
ok  campus bottom tab           index_sm.html (1)
ok  strip mounted on feed       js/features/feed_sm.js (2)
ok  campus tabs js              js/features/campus_sm.js (2)
ok  background sync bridge      js/core/native_sm.js (11)
ok  dm alert clearing           js/core/api_sm.js (1)
ok  media label strings         js/core/i18n_sm.js (3)
ok  SyncService / SyncWorker / NeonClient / SyncBridge
    AlarmScheduler / ScreenReceiver / SyncPrefs   classes.dex
all content checks passed
```

فحص الإصدار والتوقيع لم يكن ليكشف الخطأ السابق — كلاهما كان سليماً.

والصور هذه المرة (`K1`–`K4`) **مأخوذة من ملفات فُكّت من الـ APK نفسه**،
لا من `public/`.

---

## 2. حدسك كان صحيحاً: المشكلة في وصول الرسائل، لا في التطبيق

`api_sm.js` سطر 359:
```js
async sendMessage(payload) {
  const [created] = await db.insert('messages', row);  // تُدرج في messages
  return shapeMessage(created);                         // وتنتهي
}
```

**لا تكتب أي صف في `notifications`.** وفحصت المُشغّلات كلها — ثلاثة، ولا
واحد منها يخصّ الإشعارات — وبحثت عن `INSERT INTO notifications` في المخطّط
كاملاً: **لا يوجد**.

### السلسلة
```
صديقك يرسل رسالة
  → INSERT INTO messages         ✅
  → INSERT INTO notifications    ❌ لا يحدث أبداً
  → pending_alerts() تقرأ notifications فقط → فارغة
  → خدمة Java تستطلع              → لا شيء
  → notify_sm.js يستطلع           → لا شيء
```
الشيء الوحيد الذي رأى الرسالة هو `messages_sm.js` لأنه يستطلع جدول
`messages` مباشرة — ويعمل فقط والصفحة مفتوحة. **لهذا كان عليك أن تكون
داخل المحادثة.**

بنيتُ في المرة السابقة آلة استطلاع كاملة تسأل سؤالاً **لا أحد يكتب جوابه**.

### الإصلاح — `db/12_dm_notify_sm.sql`
مُشغّل `AFTER INSERT ON messages` يكتب صف الإشعار. في قاعدة البيانات لا في
المتصفّح: يعمل مهما كان المُرسِل، ولا يمكن تفويته بإغلاق التطبيق، و
`SECURITY DEFINER` لأن المُرسِل لا يملك (ولا يجب أن يملك) صلاحية الكتابة في
صندوق غيره — فلا يستطيع أحد تزوير إشعار.

- **تجميع**: إشعار غير مقروء من نفس الشخص خلال دقيقتين يُحدَّث بدل صف جديد.
  قِست: 6 رسائل متتالية ← **صف واحد**، لا ستة اهتزازات.
- **الوسائط**: تُخزَّن `[image]` لا نصاً مترجماً — لأن صفاً واحداً يقرأه
  مستخدمون بثلاث لغات. الترجمة عند العرض في `notify_sm.js` و `SyncService`.
- **أول رسالة من غريب** ← `dm_request` بقناة أهدأ.
- **`mark_dm_read()`**: فتح المحادثة يمسح إشعاراتها، وإلا أعادت
  `pending_alerts` نفس الصفوف إلى الأبد.
- **تعبئة رجعية**: رسائل آخر 7 أيام غير المقروءة تحصل على إشعار واحد لكل
  مُرسِل.

مدموج في **`FULL_SCHEMA_sm.sql`** (1868 سطراً) — الملف الواحد يكفي وحده.

### قِسته في PostgreSQL 17 حقيقي
```
قبل                     : 0 إشعارات
بعد رسالة واحدة         : 1 صف · kind=message · النص صحيح
بعد 6 رسائل متتالية     : ما زال 1 صف · النص msg6
رسالة صورة              : [image]
رسالة لنفسك             : 0 إشعارات
غريب                    : kind=dm_request
pending_alerts          : 1 → mark_dm_read → 0
FULL_SCHEMA وحده على DB فارغة: 0 أخطاء، والإشعار يُنشأ
```

---

## 3. خطأ آخر وجدته أثناء الاختبار (لم تطلبه)

```
INSERT INTO messages (sender_id, receiver_id, text)
VALUES ('u_sara','u_sara','note to self');
ERROR: violates check constraint "dm_requests_check"
CONTEXT: PL/pgSQL function route_new_message() line 27
```

`route_new_message()` لم يفكّر في «أرسل لنفسك» أبداً، فيحاول إنشاء طلب
مراسلة منك إليك والقيد يرفضه — **والرسالة تضيع**. «الرسائل المحفوظة» نمط
حقيقي يستعمله الناس كمفكرة. أُصلح.

وأيضاً: `notify_sm.js` كان يكتب `"${n} nouvelles notifications"` نصاً
فرنسياً صريحاً — يظهر فرنسياً في واجهة عربية. صار `t('notif.manyNew')`.

---

## 4. الأرقام
```
tests/run.sh           851/851   jsdom
tests/browser/run.sh   245/245   Chrome حقيقي
tests/sql/run.sh        34/34    PostgreSQL 17 حقيقي
build_apk.sh            16/16    فحوص محتوى داخل الـ APK المُسلَّم
```

---

## 5. ⚠️ خطوة إلزامية عليك — بدونها لن يتغيّر شيء

**الإصلاح الحقيقي في قاعدة البيانات، لا في الـ APK.** تثبيت التطبيق وحده
لن يجعل الرسائل تصل.

1. Neon SQL Editor ← الصق **`db/FULL_SCHEMA_sm.sql`** كاملاً ← Run
2. Data API ← **Refresh schema cache**
3. ثبّت `Koliya-1.00.apk`
4. Neon ← Auth ← Trusted domains ← أضف `https://appassets.androidplatform.net`
5. على شاومي: الإعدادات ← التطبيقات ← كلية ← **التشغيل التلقائي**

للتأكد أن الخطوة 1 نجحت، نفّذ في Neon:
```sql
SELECT tgname FROM pg_trigger WHERE tgname = 'trg_notify_new_message';
```
صف واحد = تمّ.

---

## 6. ما لم أقِسه
- **لم أشغّل الـ APK ولا مرة** — لا `/dev/kvm` و2 GB ذاكرة، المحاكي يرفض
  الإقلاع. التحقّق بنيوي فقط.
- أن الخدمة تصمد على MIUI بعد ساعة من الإغلاق.
- أن `CookieManager.getCookie()` يسلّم كوكي الجلسة لـ Java على WebView
  جهازك. لو فشل ستقرأ **`NOT_SIGNED_IN`** في الإعدادات ← حول التطبيق.
- الاستهلاك الحقيقي للبطارية (تقدير 3–6٪، ليس قياساً).
- هذا **استطلاع** وليس push؛ التأخير 20 ث (15 أثناء الشحن، وفوري عند
  إضاءة الشاشة).

### ملاحظة عن ملفات جافا
ضاعت مرة أخرى بين الجلستين. استخرجتها من `Koliya-1.2.apk` بـ jadx وأصلحت
4 أخطاء ترجمة خلّفها المفكّك — أحدها كان قد أعاد إنتاج علّة
`onReceiveValue` المزدوجة التي تُفشل إرفاق الملفات بصمت. الـ16 ملفاً الآن
في `koliya-apk/app/src/main/java/`.
