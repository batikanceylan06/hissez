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
import { getDatabase } from "firebase-admin/database";

initializeApp();

export const publishDuePosts = onSchedule(
  { schedule: "every 1 minutes", timeZone: "Europe/Istanbul" },
  async () => {
    const db = getDatabase();
    const now = Date.now();
    const snapshot = await db.ref("posts")
      .orderByChild("publishAt")
      .startAt(1)
      .endAt(now)
      .get();

    const updates = {};
    snapshot.forEach((child) => {
      if (child.child("status").val() !== "scheduled") return;
      updates[`posts/${child.key}/status`] = "published";
      updates[`posts/${child.key}/publishAt`] = null;
      updates[`posts/${child.key}/updatedAt`] = now;
    });

    if (Object.keys(updates).length) await db.ref().update(updates);
  }
);
```

Bu çözüm için Functions projesi ve Scheduler faturalandırması gerekir. Service account
anahtarı frontend'e veya repoya konmamalıdır. Fonksiyonu eklemeden önce emülatörde test et;
ardından önce frontend'i, sonra Database Rules'ı ve en son Function'ı yayınla.
