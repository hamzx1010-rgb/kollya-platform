# PLAN V8 — Notifications 24/7 + APK versioning
**قبل التنفيذ. اقرأ ووافق أو غيّر.**
Written 2026-07-28. Nothing below has been executed yet.

---

## 0. ما تحقّقت منه فعلياً قبل كتابة هذه الخطة

فككت `apk/Koliya-1.1.apk` بـ `apktool 2.9.3` و `jadx 1.5.0` وقرأت الـ manifest
الحقيقي من داخل الـ APK المثبّت عندك. هذه أرقام مقروءة، مش تخمين:

| ما قرأته | القيمة داخل Koliya-1.1.apk |
|---|---|
| `versionCode` | **1** |
| `versionName` | **"1.0"** |
| `applicationId` | `dz.koliya.app` |
| Services في الـ manifest | فقط `androidx.work.*` و CameraX — **لا يوجد أي service خاص بـ Koliya** |
| `FOREGROUND_SERVICE` permission | موجودة، لكن **لا service يستعملها** |
| `RECEIVE_BOOT_COMPLETED` | موجودة، `BootReceiver` يعيد جدولة التذكير اليومي فقط |
| ما يعمل في الخلفية اليوم | `ReminderWorker` فقط — إشعار واحد الساعة 19:00 |

---

## 1. «لماذا 1.1 يظهر كتحديث وليس كتطبيق» — الجواب

**غلطتي.** سمّيت الملف `Koliya-1.1.apk` لكن **لم أرفع `versionCode` أبداً**.
داخل الـ APK ما زال مكتوب `versionCode 1` / `versionName "1.0"` — نفس أرقام
النسخة الأولى بالضبط.

نتيجة ذلك على الهاتف:
- Android يرى نفس الـ package (`dz.koliya.app`) بنفس `versionCode` → يعرض
  **"Update"** بدل **"Install"**.
- بعض المثبّتات (MIUI خصوصاً) ترفض التثبيت أصلاً أو تقول "app not installed"
  لأن النسخة ليست أحدث.
- في شاشة App info سيبقى مكتوب **الإصدار 1.0** مهما ثبّتّ.

هذا ليس سلوكاً غريباً من الهاتف — هو نتيجة مباشرة لخطأ في `app/build.gradle`.

### الحل الدائم
1. `versionCode` يرتفع **كل بناء** (1 → 3) و `versionName "1.2"`.
2. سكربت `build_apk.sh` يقرأ الرقم، يزيده، يبني، ويسمّي الملف من الرقم نفسه —
   فيستحيل أن يختلف اسم الملف عن محتواه مرة أخرى.
3. رقم الإصدار + `versionCode` يظهران داخل **Settings → About** في التطبيق،
   فتعرف بنظرة أي نسخة مركّبة فعلاً على الهاتف بدون adb.
4. بعد البناء سأشغّل `aapt dump badging` وألصق لك المخرجات الحقيقية.

### سؤال يحتاج قرارك (السؤال 1 في الأسفل)
هل تريده يبقى **نفس التطبيق** (`dz.koliya.app`) — يستبدل المثبّت ويحافظ على
جلستك — أم **تطبيق منفصل** (`dz.koliya.app.dev`, اسم "Koliya Dev", أيقونة
مختلفة) يُثبّت بجانبه فتقارن الاثنين؟ الثاني يعني تسجيل دخول جديد.

---

## 2. مشكلة أكبر يجب أن تعرفها: **الكود المصدري لجافا ضاع**

`/home/user/koliya-apk/app/` فيه `build.gradle` فقط. الـ 9 ملفات `.java`،
الـ `AndroidManifest.xml`، والـ `res/` كلها **غير موجودة** — ضاعت في rollback
سابق (نفس الحادثة المذكورة في السجل).

**لا أعيد كتابتها من الذاكرة.** خطتي: استخرجتها للتو من الـ APK نفسه:

```
jadx  → /tmp/decomp/sources/dz/koliya/app/*.java   (9 classes, 1376 سطر)
apktool → /tmp/apktool_out/AndroidManifest.xml + res/  (كامل)
```

الخطوة الأولى قبل أي ميزة جديدة: **إعادة بناء المشروع من هذه المصادر
والتأكد أنه يُترجم ويُنتج APK مطابق وظيفياً للـ 1.1** — ثم فقط أضيف الجديد.
لو فشلت هذه الخطوة سأقول لك «فشلت» ولن أكمل على أساس مكسور.
كود jadx المفكوك يحتاج تنظيفاً يدوياً (lambdas مسمّاة `$$ExternalSyntheticLambda`،
تعليقات JADX) — هذا عمل حقيقي، ليس نسخاً ولصقاً.

---

## 3. الميزة المطلوبة: قراءة الرسائل 24/7 خارج التطبيق

### لماذا لا تعمل الآن — السبب الدقيق
البوللينج كله في JavaScript داخل الـ WebView:

```js
// core/notify_sm.js:253
pollTimer = setInterval(tick, 20000);
```

`setInterval` يعيش داخل الصفحة. لحظة ما تخرج من التطبيق، Android يجمّد الـ
WebView (وغالباً يقتل الـ process كلياً على MIUI). لا صفحة = لا timer =
لا استعلام = لا إشعار. حتى صفحة الرسائل نفسها (`messages_sm.js:286`) نفس القصة.
هذا يفسّر بالضبط ما تصفه: الإشعارات تشتغل **وأنت داخل التطبيق فقط**.

### الحل: نقل البوللينج من JavaScript إلى Java

بحثت في الوثائق الرسمية والقيود الحالية. الخلاصة:

- **WorkManager وحده لا يكفي**: الحد الأدنى للتكرار الدوري **15 دقيقة**
  (`PeriodicWorkRequest.MIN_PERIODIC_INTERVAL_MILLIS`) — قيمة مثبّتة في النظام،
  لا توجد حيلة لتخفيضها. رسالة تصل بعد 15 دقيقة ليست تطبيق دردشة.
- **Foreground Service** هو الطريقة الوحيدة للاستطلاع كل 30-60 ثانية،
  ويحتاج `foregroundServiceType="dataSync"` + إذن
  `FOREGROUND_SERVICE_DATA_SYNC` على Android 14+، وإلا يتحطّم التطبيق.
- Android 15 يحدّ `dataSync` بـ **6 ساعات كل 24 ساعة**؛ نحن على `targetSdk 34`
  فالحد لا ينطبق حالياً، لكنه يأتي مع أي رفع مستقبلي — سأصمّم على أساسه.
- **MIUI/HyperOS** (هاتفك من صور Xiaomi في `uploads/`) يقتل الخدمات بعدوانية.
  لا يوجد حل برمجي 100%؛ الحل هو **طبقات متعددة** + خطوات يدوية للمستخدم.
- **FCM (Firebase) هو الحل الصحيح فعلاً** لكنه يحتاج مشروع Firebase وخادم
  يرسل الـ push — Neon لا يملك webhooks. لن أدّعي أننا نفعل push حقيقياً.

### البنية المقترحة — 5 طبقات

| # | المكوّن | الدور | التردد |
|---|---|---|---|
| 1 | `SyncService` (foreground, `dataSync`) | البوللينج الحقيقي | 45 ث (30 ث عند الشحن، 3 د بعد ساعة خمول) |
| 2 | `SyncWorker` (WorkManager دوري) | شبكة أمان: يوقظ الخدمة إن قُتلت | 15 د |
| 3 | `AlarmManager.setExactAndAllowWhileIdle` | سلسلة إيقاظ تخترق Doze | 15 د |
| 4 | `BootReceiver` (موجود، سيُوسَّع) | إعادة تشغيل كل شيء بعد الإقلاع | — |
| 5 | بطاقة إعداد داخل Settings | إعفاء البطارية + Autostart لـ MIUI | مرة واحدة |

### كيف تصادق خدمة Java نفسها على Neon (النقطة التقنية الحرجة)
الجلسة كوكي `httpOnly` داخل الـ WebView. Java تقرأها عبر
`CookieManager.getInstance().getCookie(AUTH_URL)` — هي **نفس الـ store**
المشترك بين WebView و Java في نفس الـ process. الخطوات:

```
1. cookie  = CookieManager.getInstance().getCookie(AUTH_URL)
2. GET  {AUTH_URL}/token          Cookie: <cookie>        → JWT (TTL 4 د)
3. POST {DATA_API}/rpc/pending_alerts   Authorization: Bearer <JWT>
        body {"p_since": <آخر طابع زمني>}
4. لكل صف جديد → NotifyBridge.post(...) بالقناة الصحيحة
5. خزّن أحدث created_at في SharedPreferences "koliya"
```
`pending_alerts` موجودة فعلاً في `FULL_SCHEMA_sm.sql:1069` وتُرجع
`kind, actor_name, actor_avatar, text, created_at` — لا تحتاج أي تعديل SQL.
`CookieManager.flush()` سيُستدعى عند كل `onPageFinished` حتى تبقى الجلسة
على القرص بعد قتل الـ process.

### منع الإشعار المزدوج
`lastSeen` سيصبح **مصدراً واحداً** في SharedPreferences، يقرأه ويكتبه
الطرفان (Java و JS عبر جسر جديد `AndroidSync.lastSeen()/setLastSeen()`).
وعندما يكون التطبيق في المقدمة (`ProcessLifecycleOwner`) تتوقف خدمة Java عن
إصدار الإشعارات وتترك الأمر لـ JS — لا رنّتين لنفس الرسالة.

### الإشعار الدائم (السؤال 2)
`dataSync` يفرض إشعاراً مستمراً في الشريط. عندي خياران:
- **A** — قناة `IMPORTANCE_MIN` بنص "Koliya يستقبل الرسائل": يختفي من شريط
  الحالة، يبقى مطوياً أسفل قائمة الإشعارات. **أقل إزعاج مع بقاء الخدمة حيّة.**
- **B** — بدون foreground service إطلاقاً: WorkManager فقط، **تأخير حتى 15
  دقيقة**، ولا شيء في الشريط.

خياري المقترح: **A**، مع مفتاح في Settings يحوّل إلى B لمن يزعجه.

---

## 4. ما سأسلّمه

```
koliya-apk/app/src/main/java/dz/koliya/app/
    MainActivity.java        معاد بناؤه + بدء SyncService + ProcessLifecycle
    NotifyBridge.java        معاد بناؤه + قناة sync (IMPORTANCE_MIN)
    CameraActivity/Bridge, DeviceBridge, KoliyaApp,
    NotificationActionReceiver, ReminderWorker      معاد بناؤها كما هي
    BootReceiver.java        + إعادة تشغيل SyncService
    SyncService.java         جديد — الخدمة الأمامية والبوللينج
    SyncWorker.java          جديد — شبكة أمان WorkManager
    AlarmScheduler.java      جديد — سلسلة setExactAndAllowWhileIdle
    NeonClient.java          جديد — token + rpc/pending_alerts بـ HttpURLConnection
    SyncBridge.java          جديد — @JavascriptInterface: lastSeen, setLastSeen,
                                     isBackgroundOn, setBackgroundOn, openBatterySettings
AndroidManifest.xml          + FOREGROUND_SERVICE_DATA_SYNC + POST_NOTIFICATIONS
                             + <service dataSync> + REQUEST_IGNORE_BATTERY_OPTIMIZATIONS
build.gradle                 versionCode 3, versionName "1.2"
build_apk.sh                 يرفع versionCode ويسمّي الملف تلقائياً
koliya/public/js/features/settings_sm.js   بطاقة «الإشعارات 24/7» + شاشة About
koliya/apk/Koliya-1.2.apk    الناتج
```

## 5. الاختبار — ما أستطيع وما لا أستطيع

**سأقيسه فعلاً:**
- `aapt dump badging` → versionCode/versionName/permissions (ألصق المخرجات)
- `apksigner verify` + `zipalign -c`
- استخراج `classes.dex` والتأكد من وجود الأصناف الجديدة والـ
  `@JavascriptInterface` الجديدة (نفس الطريقة التي أثبتت خطأ سابق)
- اختبار Chrome حقيقي جديد `background.test.mjs`: أزيّف `AndroidSync` وأتحقق
  أن JS يقرأ/يكتب `lastSeen` من الجسر ولا يكرّر الإشعار، وأن الموقع يعمل
  عادياً بدون الجسر
- تشغيل الـ 851 + 160 + 34 اختباراً كلها
- **PNG حقيقية** لبطاقة الإعدادات الجديدة وشاشة About بالعربية والفرنسية،
  أفتحها وأنظر إليها بنفسي قبل أن أرسلها لك

**ما لن أستطيع قياسه — قُلها لي الآن لا بعد التسليم:**
- أن الخدمة تصمد فعلاً على MIUI بعد ساعة من الإغلاق
- أن الإشعار يصل والشاشة مطفأة (Doze حقيقي)
- أن `CookieManager` يسلّم الكوكي لـ Java على WebView الخاص بجهازك
- استهلاك البطارية الحقيقي
السبب هو نفسه كل مرة: **لا يوجد `/dev/kvm` و 2 GB RAM فقط، المحاكي يرفض
الإقلاع.** الاختبار الحقيقي هو هاتفك.

---

## 6. صراحة بخصوص البطارية
بوللينج كل 45 ثانية + خدمة أمامية = استهلاك حقيقي، أقدّره **3-6٪ إضافية
يومياً**. هذا ثمن عدم امتلاك push حقيقي. الحل النهائي الصحيح هو FCM
(مجاني، لكنه يحتاج مشروع Firebase + دالة على Neon تستدعي خادم إرسال).
أستطيع بناءه لاحقاً كـ V9 إن أردت.

---

## الأسئلة الثلاثة التي أحتاج جوابها قبل أن أبدأ
1. نفس التطبيق (يستبدل ويحافظ على الجلسة) أم تطبيق منفصل بجانبه؟
2. الإشعار الدائم: A (خدمة حيّة + إشعار صامت) أم B (بدون شريط + تأخير 15 د)؟
3. تردد الاستطلاع: 30 ث / 45 ث / 60 ث ؟
