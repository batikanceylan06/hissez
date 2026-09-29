# Opsiyonel server-side zamanlanmış yayın

Mevcut sürüm backend gerektirmeden güvenli çalışır: gelecekteki `scheduled` kayıtlar Rules
tarafından gizlenir, süresi gelen kayıtlar sunucu dakikasına kilitli bir sorguyla public
olur. Bu yöntem veritabanındaki `status` alanını değiştirmez ve en fazla yaklaşık bir
dakika gecikmeyle görünürlük sağlar.

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
