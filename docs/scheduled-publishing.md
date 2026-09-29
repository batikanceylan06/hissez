# Opsiyonel server-side zamanlanmış yayın

Mevcut istemci akışı backend gerektirmeden çalışır. `postSchedule` collection'ında yalnızca
`publishAt` ve `updatedAt` metadata alanları tutulur. İstemci `Date.now()` ile zamanı geldiği
düşünülen kayıtların kimliklerini seçer ve asıl post belgesini `getDoc` ile okur. Bu kontrol
yalnızca yenileme/görünürlük ipucudur; istemci saati bir güvenlik kaynağı değildir.

Asıl güvenlik Firestore Rules tarafındadır: scheduled içeriklerin erişimi
`request.time.toMillis()` ile server-side kontrol edilir. İstemci saati ileri alınsa bile
gelecekteki içerik açılmaz; Firestore Rules isteği reddeder. İstemci saati geri kalırsa
görünürlük yenilemesi gecikebilir. Client akışı `status` alanını değiştirmez ve dakikalık
yenileme döngüsü nedeniyle normalde en fazla yaklaşık bir dakika gecikme oluşturur.

Tam vaktinde kalıcı durum geçişi istenirse Firebase Cloud Functions Scheduler kullanılabilir.
Bu, mevcut istemci fallback'inin yerine geçmek zorunda değildir; birlikte çalışabilir.

Örnek ikinci nesil zamanlayıcı:

```js
import { onSchedule } from "firebase-functions/v2/scheduler";
import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

initializeApp();

export const publishDuePosts = onSchedule(
  { schedule: "every 1 minutes", timeZone: "Europe/Istanbul" },
  async () => {
    const db = getFirestore();
    const now = Date.now();
    const snapshot = await db.collection("posts")
      .where("status", "==", "scheduled")
      .where("publishAt", "<=", now)
      .orderBy("publishAt", "asc")
      .get();

    const batch = db.batch();
    snapshot.docs.forEach((post) => batch.update(post.ref, {
      status: "published",
      publishAt: FieldValue.delete(),
      updatedAt: now
    }));
    snapshot.docs.forEach((post) => batch.delete(db.collection("postSchedule").doc(post.id)));

    if (!snapshot.empty) await batch.commit();
  }
);
```

Bu çözüm için Functions projesi ve Scheduler faturalandırması gerekir. Service account
anahtarı frontend'e veya repoya konmamalıdır. Fonksiyonu eklemeden önce emülatörde test et;
ardından Firestore Rules/indekslerini, Function'ı ve en son frontend'i yayınla.

Bu opsiyonel Function etkinleştirilirse `status ASC + publishAt ASC` composite indexini
`config/firestore.indexes.json` dosyasına ekle. Mevcut backend'siz `postSchedule` akışı bu
composite indexe ihtiyaç duymaz.
