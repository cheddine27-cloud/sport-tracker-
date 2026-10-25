# إدارة المحل الرياضي (sports-store)

تطبيق سطح مكتب (Next.js ثابت + Tauri v2 + SQLite) لإدارة محل معدات رياضية، يعمل بالكامل دون إنترنت وبواجهة عربية RTL.

## التشغيل في وضع التطوير
```bash
npm install
npm run tauri dev
```
المتطلبات: Node.js LTS، Rust (rustup)، وMicrosoft C++ Build Tools على Windows.

## الاختبارات الآلية
```bash
npm run test:db        # 16 فحص لطبقة القاعدة
npm run test:products  npm run test:stock    npm run test:sales
npm run test:exports   npm run test:expenses npm run test:statistics
npm run test:distributors npm run test:settings npm run test:backup
npm run test:ui        # فحوصات دخانية للواجهات
```
ملاحظة: `better-sqlite3` مستخدم فقط في الاختبارات (devDependency) وقد يحتاج تجميعًا أصليًا على Windows؛ لا يدخل في حزمة التطبيق النهائي.

## بناء نسخة Windows عبر GitHub Actions
1. ارفع الكود إلى مستودع GitHub.
2. من تبويب **Actions** اختر "Build Windows Installer" ثم **Run workflow** (أو أنشئ وسمًا: `git tag v1.0.0 && git push origin v1.0.0`).
3. بعد نجاح البناء:
   - عند الوسم: يظهر مثبّت `.msi` و`.exe` ضمن **Draft Release**.
   - دائمًا: حمّل الحزم من قسم **Artifacts** في صفحة تشغيل الـ workflow (`windows-installers`).

يمكن أيضًا البناء محليًا: `npm run tauri build` (المخرجات في `src-tauri/target/release/bundle/`).

## مكان قاعدة البيانات على Windows
```
%APPDATA%\com.sportsstore.app\sports_store.db
```
النسخ الاحتياطية التلقائية تُحفظ في مجلد `backups` بجانب الملف (آخر 14 نسخة)، ويمكن إنشاء نسخة يدوية أو استعادة نسخة من صفحة **الإعدادات**.
