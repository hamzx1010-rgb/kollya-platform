# V8 — background messages + the versioning fix

**`apk/Koliya-1.2.apk` · versionCode 4 · versionName 1.2 · 3.8 MB · signed v1+v2+v3 · zipaligned**

---

## 1. «تظهر كتحديث مش كتطبيق» — سبب حقيقي، وغلطة مني

فككت `Koliya-1.1.apk` بـ apktool وقرأت الـ manifest من داخله:

```
Koliya-1.0.apk -> versionCode='1' versionName='1.0'
Koliya-1.1.apk -> versionCode='1' versionName='1.0'   ← الاسم فقط تغيّر
Koliya-1.2.apk -> versionCode='4' versionName='1.2'
```

غيّرت اسم الملف ولم أرفع `versionCode` أبداً. أندرويد يقرر «Install» أو
«Update» من `versionCode` وحده، فرأى نفس النسخة تماماً.

**الإصلاح ليس رقماً كتبته بيدي مرة واحدة**، لأن ذلك سيتكرّر. الآن:
- `app/version.properties` يحمل الرقم
- `build_apk.sh` يزيده في كل بناء، ويشتقّ **اسم الملف من نفس الرقم**
- بعد البناء يقرأ `aapt dump badging` من الملف الناتج ويطبعه

فصار مستحيلاً أن يخالف اسم الملف محتواه.

**التوقيع لم يتغيّر** (تحقّقت): بصمة SHA-256 في 1.1 و 1.2 متطابقة
`8ae9f1af…8280` — أي أنها تُثبَّت فوق الحالية وتحافظ على جلستك.

---

## 2. لماذا لم تكن الرسائل تصل والتطبيق مغلق

كل الاستطلاع كان في JavaScript:

```js
// core/notify_sm.js
pollTimer = setInterval(tick, 20000);
```

`setInterval` يعيش داخل الصفحة. لحظة خروجك، أندرويد يجمّد الـ WebView
(وعلى MIUI يقتل الـ process). لا صفحة ⇐ لا مؤقّت ⇐ لا استعلام ⇐ لا إشعار.
هذا يطابق وصفك تماماً: الإشعارات تعمل **وأنت داخل التطبيق فقط**.

### الحل: نُقل الاستطلاع إلى Java، بثلاث طبقات

| # | المكوّن | الدور | التردد |
|---|---|---|---|
| 1 | `SyncService` (foreground, `dataSync`) | الاستطلاع الحقيقي | تكيّفي، انظر أدناه |
| 2 | `SyncWorker` (WorkManager) | يعيد تشغيل الخدمة إن قُتلت، ويستطلع بنفسه | 15 د |
| 3 | `AlarmScheduler` (`setExactAndAllowWhileIdle`) | يخترق Doze | 15 د |
| + | `ScreenReceiver` | استطلاع فوري لحظة إضاءة الشاشة | — |
| + | `BootReceiver` | يعيد كل شيء بعد الإقلاع **وبعد تحديث التطبيق** | — |

طبقة واحدة لا تكفي: WorkManager حدّه الأدنى **15 دقيقة** ثابت في النظام
(`MIN_PERIODIC_INTERVAL_MILLIS`)، ولا حيلة لتخفيضه.

### «فوري» — ما قدرت أعطيه فعلاً
طلبت «instant». هذا غير ممكن حرفياً: Neon لا يملك قناة realtime ولا push،
فلا شيء يدفع الرسالة إلى الهاتف — شيء ما يجب أن **يسأل**. أسرع جدول
لا يحرق البطارية:

```
أثناء الشحن ................ 15 ث
الشاشة مضاءة / استُعمل <1س . 20 ث
خمول 1–6 س ................. 45 ث
خمول > 6 س ................. 180 ث
+ استطلاع فوري لحظة إضاءة الشاشة  ← يجعلها تبدو فورية عملياً
```

### كيف تصادق Java نفسها
الجلسة كوكي `httpOnly`؛ JS لا يقرأه، لكن `android.webkit.CookieManager`
مشترك بين الـ WebView و Java في نفس الـ process:

```
CookieManager.getCookie(AUTH_URL)
  → GET  {AUTH}/token                    → JWT (يُخزَّن 4 د)
  → POST {DATA_API}/rpc/pending_alerts   → الصفوف الجديدة
```

`pending_alerts` موجودة أصلاً في `FULL_SCHEMA_sm.sql:1069` — **لا تعديل SQL**.

### منع الرنّة المزدوجة
هذه كانت أخطر نقطة. لو احتفظت Java بعلامة و JS بعلامة أخرى، كل رسالة
سترنّ مرتين: مرة من الخدمة والتطبيق مغلق، ومرة من الصفحة عند فتحها وهي
تعيد الاستطلاع من نسختها القديمة.

الآن **علامة واحدة** في SharedPreferences، يقرأها ويكتبها الطرفان
(`SyncPrefs` ← Java، `AndroidSync` ← JS). وأضفت في `checkAlerts()`
إعادة قراءة العلامة قبل كل استطلاع بدل الثقة بالنسخة في الذاكرة.
وأثناء وجود التطبيق على الشاشة تواصل الخدمة الاستطلاع لكنها **تتوقف عن
النشر** وتترك الأمر للصفحة.

---

## 3. مشكلة اكتشفتها ولم تطلبها: الكود المصدري كان ضائعاً

`koliya-apk/app/` لم يكن فيه سوى `build.gradle`. الـ 9 ملفات `.java`
والـ manifest والـ `res/` ضاعت في rollback سابق. استخرجتها من الـ APK
نفسه (`apktool` + `jadx`) وأعدت كتابتها كوداً نظيفاً — الآن 16 ملف Java
مصدري في `app/src/main/java/`. نسخة العمل محفوظة في `koliya-apk/_recover/`.

نفس الشيء لـ `native_sm.js` و `gestures_sm.js` (كانا مفقودَين من
`public/`) و 8 ملفات JS/CSS كانت `public/` فيها **أقدم** من الـ APK —
استعدتها كلها، والنسخة السابقة في `koliya/.backup_prev_public/`.

### وأخطاء وجدتها أثناء إعادة الكتابة
1. **`onShowFileChooser` كان ينادي `onReceiveValue` مرتين** — مرة بالملفات
   ثم مرة بـ `null`، فالنداء الثاني يلغي الأول: إرفاق ملف من منتقي النظام
   كان لا يفعل شيئاً بصمت. مُصلَح.
2. **خيار `lang` في `harness.mjs` لم يعمل يوماً** — يكتب
   `localStorage['koliya.locale']` بينما `store_sm.js` يقرأ `pref:locale`.
   أي اختبار عربي استعمله كان يفحص صفحة إنجليزية ويمرّ. الاختبار الجديد
   يستدعي `setLang('ar')`.
3. **`persist.test.mjs` كان يقرأ `/tmp/av.png`** و `/tmp` يُمسح بين
   الجلسات ⇐ 5 إخفاقات بـ «0 bytes» بلا خطأ في التطبيق. صار يولّد الـ PNG
   بنفسه (`makePng` + `crc32` + zlib).

---

## 4. الأرقام

```
tests/run.sh           851/851   jsdom
tests/browser/run.sh   181/181   Chrome حقيقي
  background 47   ← جديد: جسر AndroidSync، عدم التكرار، البطاقة، العربية
  live       74
  persist    38
  sound      22
tests/sql/run.sh        34/34    PostgreSQL 17 حقيقي
```

`background.test.mjs` يحقن `AndroidSync` مزيّفاً يسجّل كل نداء، ثم يشغّل
التطبيق الحقيقي فوقه. اسم دالة خاطئ أو وسيط ناقص يفشل هناك تماماً كما
سيفشل على الهاتف — وهذا بالضبط نوع الخطأ الذي شُحن مرتين من قبل.
ويؤكّد أيضاً أن **الموقع** يعمل بلا الجسر إطلاقاً.

### تحقّق بنيوي على الـ APK المُسلَّم
| ما تحقّقت منه | كيف |
|---|---|
| `versionCode=4`, `versionName=1.2` | `aapt dump badging` على الملف الناتج |
| نفس مفتاح التوقيع كـ 1.1 | `apksigner --print-certs`، SHA-256 متطابق |
| `zipalign` | `zipalign -c 4` |
| 7 أصناف جديدة موجودة | استخراج `classes.dex` وقراءة الأسماء |
| `<service … foregroundServiceType="dataSync" stopWithTask="false">` | manifest داخل الـ APK |
| الأذونات الجديدة الثلاثة | `aapt dump badging` |
| JS الجديد مضمَّن فعلاً | فكّ الـ APK و grep على `AndroidSync` |

---

## 5. صور

`shots/B1-bg-warning` · `B2-bg-ok` · `B3-bg-off` · `B4-bg-arabic` ·
`B5-bg-error` — عرض 412px، كلها داخل الحدود (left 6 → right 396).
فتحتها ونظرت إليها بنفسي قبل الإرسال.

---

## 6. ما لم أستطع قياسه — اقرأ هذا الجزء

**لم أشغّل هذا الـ APK ولا مرة.** لا `/dev/kvm` و 2 GB RAM، والمحاكي يرفض
الإقلاع. الجزء التالي **غير مُتحقَّق منه سلوكياً**:

- أن الخدمة تصمد فعلاً على MIUI/HyperOS بعد ساعة من الإغلاق
- أن `CookieManager.getCookie()` يسلّم كوكي الجلسة لـ Java على WebView
  جهازك تحديداً. هناك علّة معروفة على API < 28 مع WebView قديم تحجب
  الكوكيات ذات `SameSite`. **إن حدث ذلك ستقرأ `NOT_SIGNED_IN` في
  الإعدادات ← حول التطبيق** — لهذا أضفت سطر التشخيص
- أن الإشعار يصل والشاشة مطفأة (Doze حقيقي)
- الاستهلاك الحقيقي للبطارية. تقديري 3–6٪ إضافية يومياً، وهو تقدير لا قياس

## 7. ما زال عليك أنت
1. **Neon → Auth → Trusted domains**: أضف
   `https://appassets.androidplatform.net`
2. شغّل `db/FULL_SCHEMA_sm.sql` ثم Data API → Refresh schema cache
3. على شاومي: الإعدادات → التطبيقات → كلية → **التشغيل التلقائي** — لا
   يستطيع أي تطبيق منح نفسه هذا
4. لو انهار: `adb logcat -d | grep -iE "koliya|AndroidRuntime"`
