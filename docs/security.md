# Hissez güvenlik işlemleri

Bu dosya kod içinde yapılamayan Firebase Console, Google Cloud ve Vercel adımlarını
toplar. Production Firebase verisine migration, toplu write veya delete çalıştırmadan
uygulanmalıdır.

## Firebase App Check (reCAPTCHA Enterprise)

1. Google Cloud Console'da `hissez` projesini seçip Fraud Defense / reCAPTCHA Enterprise
   bölümünde **Web** tipi, score-based bir key oluştur. `hissez.com` ve kullanılacak
   production alt alan adlarını ekle; `localhost` production key'e eklenmemelidir.
2. Firebase Console > **Security > App Check** bölümünde Web uygulamasını kaydet ve aynı
   site key'i gir.
3. `assets/js/firebase-config.js` içindeki `appCheckSiteKey` değerini bu public site key ile
   değiştir. Bu değer secret değildir; private API/service-account anahtarı ekleme.
4. Kod, Firebase App Check'i Firestore/Auth servisleri kullanılmadan önce başlatır ve
   token otomatik yenilemeyi açar. `localhost`, `127.0.0.1` ve `file:` ortamlarında App
   Check başlatılmaz; emulator geliştirmesi production attestation beklemez.
5. Önce App Check metriklerini **Unenforced/monitoring** modunda izle. Production trafiği
   doğrulandıktan sonra Firestore ve Authentication için enforcement'ı Console'dan ayrı
   ayrı etkinleştir. Enforcement kod tarafından taklit edilmez.

## Admin custom claim

Admin yetkisi yalnızca Firebase Auth ID token'ındaki `admin: true` custom claim ile
verilir. Rules içinde e-posta fallback'i yoktur. Yetki verme/kaldırma işlemi güvenilen,
erişimi kısıtlı bir makinede yapılmalıdır:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS="C:\guvenli-konum\service-account.json"
node scripts/set-admin-claim.mjs yonetici@ornek.com grant
node scripts/set-admin-claim.mjs yonetici@ornek.com revoke
```

Script Application Default Credentials kullanır, mevcut claim'leri korur, yalnızca
`admin` claim'ini ekler/kaldırır ve refresh token'ları iptal eder. Kullanıcı yeni token
almak için panelden çıkış yapıp tekrar giriş yapmalıdır. Claim olmayan authenticated
kullanıcı public yayınlar dışındaki admin verilerine erişemez.

Service account JSON anahtarını repoya, frontend'e, Vercel environment log'una veya
ekip sohbetine koyma. İş bittikten sonra yerel güvenli konumdan kaldır/rotasyon yap.

## Authentication kontrolleri

- Email/Password sağlayıcısı yalnızca gereken hesaplar için açık tutulmalı.
- Password Policy'de en az 12 karakter, yaygın şifre reddi ve mümkünse harf/rakam/özel
  karakter gereksinimleri etkinleştirilmeli.
- Authentication > Settings bölümünde **Email enumeration protection** etkinleştirilmeli;
  istemci de giriş ve şifre sıfırlama hatalarında hesap var/yok ayrımı yapmamalı.
- MFA bu proje için opsiyoneldir. Etkinleştirmek için Firebase Authentication with
  Identity Platform yükseltmesi ve uygun ikinci faktör/rollout planı gerekir; yalnızca
  Console'da açmadan önce kullanıcı kurtarma akışını test et.

## Vercel

- Vercel Firewall/WAF'da admin path (`/sezin-panel`, `/sezin-panel.html`) için rate limit
  ve gerekiyorsa ülke/IP kısıtları tanımla.
- Login endpoint'i için başarısız denemeleri izleyip düşük eşikli rate limit uygula.
- HSTS, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`,
  `Permissions-Policy` ve CSP header'larını gevşetme.
- Preview deployment erişimini ekip üyeleriyle sınırla; production App Check site key'ine
  preview domainlerini yalnızca bilinçli olarak ekle.

## Firestore yedekleme

- Firestore için günlük backup ve mümkünse **Point-in-Time Recovery (PITR)** etkinleştir.
- Retention süresini ve geri yükleme tatbikatını dokümante et; yedeklerin erişimini en az
  ayrıcalık ilkesiyle sınırla.
- Rules/index değişikliğinden önce emülatör testlerini çalıştır; production verisi üzerinde
  migration veya toplu write/delete komutu çalıştırma.

## `postSchedule` privacy notu

`postSchedule` public istemciye yalnızca `publishAt` ve `updatedAt` metadata'sını verir;
başlık, içerik ve yazar bilgisi bu collection'a yazılmaz. Bu erişim gelecekte yayınlanacak
kayıtların zamanlarını ve document ID'lerini açığa çıkarabilir. Mevcut backend'siz istemci
bu index'i keşif için dinlediği için Rules erişimini yalnızca due kayıtlarla sınırlamak,
aynı anda server-time uyumlu bir sorgu veya serverless endpoint gerektirir. Bu mimariyi
bozmamak için erişim değiştirilmedi; asıl post içeriği Rules tarafından `request.time`
kontrolüyle korunur.
