# RTDB → Cloud Firestore migration rehberi

Bu geçiş `posts/{postId}` kayıtlarını RTDB'den Firestore'daki aynı document ID'lerine
kopyalar. Script hiçbir RTDB kaydını silmez. `createdAt`, `updatedAt` ve `publishAt` epoch
millisecond number olarak korunur. Migration tekrarlanabilir; aynı ID ikinci kez duplicate
doküman oluşturmaz.

Backend zorunluluğu olmadan güvenli zamanlanmış yayın için Firestore'da ayrıca
`postSchedule/{postId}` metadata collection'ı tutulur. Bu belgelerde yalnızca `publishAt`
ve `updatedAt` vardır; gelecekte yayınlanacak yazının başlığı veya içeriği public olmaz.
Zamanı gelen ID için asıl `posts/{postId}` belgesi tekil okunur ve Rules sunucu zamanını
yeniden doğrular.

## Ön koşullar

- Firebase Console'da `hissez` projesinin varsayılan Cloud Firestore database'ini oluştur.
- Service account JSON dosyasını repo dışında güvenli bir klasörde sakla.
- JSON anahtarını hiçbir HTML/JS dosyasına veya Git'e ekleme.
- Production migration öncesi Firebase Console'dan RTDB yedeği almak ek bir güvenlik
  katmanı sağlar; migration scripti RTDB'ye yazmasa da yedek önerilir.

## 1. Bağımlılıkları kur

```powershell
npm install
```

## 2. Service account ortam değişkenini ayarla

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS="C:\firebase-keys\hissez-admin.json"
```

Gerekirse proje ve RTDB URL'si açıkça verilebilir:

```powershell
$env:GOOGLE_CLOUD_PROJECT="hissez"
$env:FIREBASE_DATABASE_URL="https://hissez-default-rtdb.firebaseio.com"
```

## 3. Dry run çalıştır

```powershell
npm run migrate:firestore
```

Bu komut RTDB postlarını ve mevcut Firestore dokümanlarını okur; kaç kaydın geçerli,
geçersiz, aynı veya migrate edilmeyi beklediğini raporlar. `--apply` olmadığı için
Firestore'a yazmaz.

`INVALID` satırı varsa gerçek migration yapma. İlgili RTDB kaydını ve güvenlik şemasını
incele. Script `--apply` ile çağrılsa bile geçersiz tek bir kayıt varsa kısmi migration
yapmadan, Firestore'a hiçbir şey yazmadan durur.

## 4. Migration'ı uygula

Bu adım yalnızca dry run temizse ve production yazımı açıkça onaylandıysa çalıştırılmalı:

```powershell
npm run migrate:firestore -- --apply
```

Yazımlar en fazla 400 document içeren batch'lerle yapılır. Aynı RTDB push ID, Firestore
document ID olarak korunur. Mevcut aynı ID güvenli şekilde kaynak verisiyle set edilir.
RTDB'den hiçbir şey silinmez.

## 5. Migration'ı doğrula

```powershell
npm run verify:firestore
```

Beklenen sonuçta `MISMATCHED`, `MISSING` ve `EXTRA` sıfırdır. Script salt okunurdur.

## 6. Firestore Rules ve indeksleri yayınla

Önce emülatör testlerini çalıştır:

```powershell
npm run test:rules
```

Ardından Firestore yapılandırmasını yayınla:

```powershell
npx firebase-tools deploy --only firestore --project hissez
```

Bu komut `config/firestore.rules` ve `config/firestore.indexes.json` dosyalarını kullanır.
RTDB rules dosyası ve RTDB verisi yerinde kalır.

## 7. Uygulama testlerini çalıştır

```powershell
npm test
npm run test:rules
npm run test:migration
```

Public published/scheduled sorgularını, admin login/CRUD akışını ve mobil paylaşım
özelliklerini yerelde kontrol et.

## 8. Siteyi yayınla

Migration doğrulaması başarılı, kurallar ve indeksler hazır olduktan sonra Firestore
istemci değişikliklerini deploy et. Frontend'i migration'dan önce yayınlama; aksi halde
Firestore'da henüz bulunmayan yazılar public sitede görünmez.

## 9. Rollback

1. Frontend'i Firestore geçişinden önceki RTDB commitine döndür.
2. Frontend'i yeniden deploy et.
3. Gerekirse RTDB rules'ı mevcut `config/firebase-rules.json` ile yeniden yayınla:

```powershell
npx firebase-tools deploy --only database --project hissez
```

Migration RTDB kayıtlarını değiştirmediği veya silmediği için eski frontend aynı post ID ve
URL'lerle çalışmaya devam eder. Firestore dokümanlarını rollback sırasında silmek gerekmez;
önce veri bütünlüğü ve geri dönüş doğrulandıktan sonra ayrı bir bakım kararı verilmelidir.
