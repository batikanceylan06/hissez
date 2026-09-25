# Hissez

Sezin’in şiirlerini ve günlük tarzı gün notlarını yayınlayabileceği Firebase destekli kişisel blog sitesi.

## Dosyalar

- `index.html`: Ana sayfa
- `siirler.html`: Yayındaki şiirler
- `gun-notlari.html`: Yayındaki gün notları
- `yazi.html`: Yazı detay sayfası
- `hakkimda.html`: Hakkımda sayfası
- `sezin-panel.html`: Şifreli yönetim paneli
- `assets/js/firebase-config.js`: Firebase bağlantı ayarları
- `assets/js/admin.js`: Admin giriş, yazı ekleme, düzenleme, yayına alma
- `assets/js/posts.js`: Public site yazı listeleme ve detay gösterme

## Firebase Kurulum

1. Firebase Console üzerinden proje oluştur.
2. Web App ekle.
3. Firebase config bilgilerini `assets/js/firebase-config.js` içine yaz.
4. Authentication > Sign-in method bölümünden Email/Password girişini aktif et.
5. Authentication > Users bölümünden Sezin için e-posta/şifre oluştur.
6. Aşağıdaki “Admin Custom Claim kurulumu” adımlarıyla kullanıcıya `admin: true` yetkisi ver.
7. `config/firebase-rules.json` kurallarını yayınla.

## Realtime Database Rules

Aktif kurallar `config/firebase-rules.json` dosyasındadır. Public erişim yalnızca istemcinin
`orderByChild("status").equalTo("published")` sorgusuna izin verir; filtresiz `/posts`
okuması ve tekil taslak okuması reddedilir. Yönetici tam okuma/yazma yetkisi
`auth.token.admin === true` Custom Claim ile verilir.

Kurallardaki iki e-posta kontrolü yalnızca mevcut yöneticileri ilk Custom Claim kurulana
kadar kilitlememek için geçici uyumluluk katmanıdır. Tüm yönetici hesaplarına claim
verildikten sonra bu e-posta koşulları kurallardan kaldırılmalıdır.

Frontend dosyalarında yönetici e-posta listesi tutulmaz; gerçek yetki her zaman Firebase
Authentication tokenı ve Realtime Database Rules tarafından belirlenir.

## Admin Panel

Panel adresi:

```txt
/sezin-panel.html
```

Bu adres public menüde, footer’da veya ana sayfada görünmez. Ayrıca:

- `sezin-panel.html` içinde `noindex, nofollow` vardır.
- `robots.txt` panel dosyasını engeller.
- `vercel.json` Vercel üzerinde panel için `X-Robots-Tag` header ekler.
- Asıl güvenlik Firebase Auth + Database Rules tarafındadır.

## Yayın Mantığı

Admin panelde yazılar iki durumda tutulur:

- `draft`: Taslak
- `published`: Yayında

Public sitede sadece `published` yazılar görünür.

## Firebase Veri Yapısı

```json
{
  "posts": {
    "postId": {
      "title": "İçimde Kalan Bir Cümle",
      "slug": "icimde-kalan-bir-cumle",
      "content": "Yazının tam içeriği...",
      "type": "poem",
      "category": "Şiir",
      "status": "published",
      "featured": true,
      "excerpt": "Kısa açıklama",
      "date": "2026-04-30",
      "createdAt": 1777550000000,
      "updatedAt": 1777550000000
    }
  }
}
```

## Yayına Alma

1. `/sezin-panel.html` adresine git.
2. E-posta ve şifreyle giriş yap.
3. Yazı başlığı, türü, tarihi ve içeriği gir.
4. Taslak olarak kaydet veya direkt yayına al.
5. Yayındaki yazılar sitede otomatik görünür.


## Admin Custom Claim kurulumu

Bu işlem yalnızca güvenilen bir yerel makinede veya yönetici backend ortamında yapılmalıdır.
Firebase servis hesabı anahtarını repoya koyma.

```powershell
npm install --no-save --no-package-lock firebase-admin
$env:GOOGLE_APPLICATION_CREDENTIALS="C:\guvenli-konum\service-account.json"
node scripts/set-admin-claim.mjs yonetici@ornek.com grant
```

Yetkiyi kaldırmak için:

```powershell
node scripts/set-admin-claim.mjs yonetici@ornek.com revoke
```

Claim değişikliğinden sonra kullanıcı panelden çıkış yapıp tekrar giriş yapmalıdır. Tüm
mevcut yöneticilere claim verildikten sonra `config/firebase-rules.json` içindeki geçici
`auth.token.email` koşullarını kaldır ve yalnızca `auth.token.admin === true` bırak.

## Güvenli yayınlama sırası

Önce güncel frontend/Vercel sürümünü yayınla; ardından Database Rules'ı yayınla. Böylece
eski Service Worker önbelleği temizlenirken public site kesintiye uğramaz.

```powershell
npx firebase-tools deploy --only database --project hissez
```

`firebase.json`, kuralların `config/firebase-rules.json` konumundan alınmasını sağlar.

Kuralları production verisine dokunmadan emülatörde test etmek için:

```powershell
npx -y firebase-tools@latest emulators:exec --only database,auth --project demo-hissez "node scripts/test-firebase-rules.mjs"
```

## SEO ve sitemap notu

Yazı detay sayfası canonical, Open Graph, article tarihleri ve BlogPosting JSON-LD
alanlarını tarayıcıda günceller. WhatsApp, Facebook ve X gibi JavaScript çalıştırmayan
botlar ilk statik `yazi.html` meta alanlarını görebilir; her yazıya özel sosyal önizleme
için ileride build-time static generation veya küçük bir serverless render katmanı gerekir.

`sitemap.xml` yalnızca sabit, doğrudan açılabilen sayfaları içerir. Dinamik yazıları
güvenilir biçimde sitemap'e eklemek için aynı static-generation/serverless adımında yalnız
`published` kayıtlarından sitemap üretmek gerekir; istemci tarafı sitemap oluşturamaz.


## 30.04 güncellemesi

Admin ekranında giriş yapılmadan panelin altta görünmesine sebep olan CSS `hidden` ezilme problemi düzeltildi.

Eklenen güvenlik katmanları:

```css
[hidden] {
  display: none !important;
}
```

Admin panel artık sadece Firebase Authentication doğrulaması başarılı olursa görünür. Giriş yapılmadan panel HTML içinde bulunsa bile CSS ve JS tarafından kapalı tutulur.


## Logo, favicon ve PWA güncellemesi

Bu sürümde yüklediğin logo siteye entegre edildi ve şu favicon dosyaları eklendi:

- favicon.ico
- favicon-16x16.png
- favicon-32x32.png
- favicon-48x48.png
- apple-touch-icon.png
- android-chrome-192x192.png
- android-chrome-512x512.png
- site.webmanifest
- panel.webmanifest

### Telefona uygulama olarak ekleme

Public site için:
- Android Chrome veya iPhone Safari üzerinden siteyi aç.
- Menüden `Ana ekrana ekle` seç.

Panel için:
- `sezin-panel.html` adresini aç.
- Menüden `Ana ekrana ekle` yap.

Ayrıca istersen public site ve panel ayrı zip olarak da kullanılabilir.


## Son tasarım güncellemesi

- Logo artık çerçevesiz kullanılıyor.
- Hissez wordmark yeniden tasarlandı.
- Şiir ve yazı kartları daha premium hale getirildi.
- Arka plan için sakin ambient müzik eklendi.
- Bir yazı öne çıkan yapılınca diğer tüm eski öne çıkanlar otomatik kapanır.


## Premium tasarım güncellemesi

Bu sürümde şunlar eklendi:
- Logo çerçevesiz kullanıldı.
- Hissez wordmark yenilendi.
- Karanlık mod / aydınlık mod eklendi.
- Orijinal ambient arka plan müziği eklendi.
- Kart tasarımı daha premium hale getirildi.
- Meta, Open Graph, Twitter ve canonical etiketleri eklendi.
- sitemap.xml ve gelişmiş robots.txt oluşturuldu.
- Admin panelinde bir yazı öne çıkarıldığında diğer öne çıkan yazılar otomatik kaldırılır.


## Final v4 güncellemesi

- Karanlık / aydınlık mod butonları artık HTML içinde doğrudan bulunur.
- 4 farklı özgün ambient arka plan müziği eklendi.
- Müzik seçici eklendi.
- Şiir ve gün notları klasik karttan çıkarılıp editorial / defter akışı yapısına taşındı.
- Meta SEO, Open Graph, Twitter Card, canonical, JSON-LD, robots.txt ve sitemap.xml kontrol edildi.
- Admin panelinde bir yazı öne çıkarılınca diğer öne çıkan yazılar otomatik pasife alınır.


## Final v5 güncellemesi

- Logo artık span/ikon kutusu içinde değil; doğrudan çerçevesiz img olarak kullanılıyor.
- Şiirler sayfası defter sayfası görünümüne çevrildi.
- Gün notları sayfası timeline akışına çevrildi.
- Service worker cache versiyonu v5'e yükseltildi.


## Final v6 düzeltmeleri

- Müzik alanı sağ altta tek ikon olarak kompakt hale getirildi, panel tıklayınca açılır.
- Karanlık modda tüm beyaz yüzeyler koyu, tüm siyah yazılar beyaz olacak şekilde güçlü override eklendi.
- Açık modda beyaz yüzey / siyah yazı dengesi korundu.
- Logo tamamen çerçevesiz img yapısına alındı; eski ikon kutusu devre dışı bırakıldı.
- Hissez yazısında His ve sez aynı font/stil ailesine alındı, yapıştırılmış hissi azaltıldı.
- Şiirler sayfası kitap/defter görünümüne, gün notları sayfası ayrı timeline görünümüne çevrildi.
- Service worker cache v6'ya yükseltildi.


## Final v7 güncellemesi

- Ana sayfada artık sadece son 1 şiir ve son 1 gün notu gösterilir.
- Diğer tüm şiirler için `siirler.html`, diğer tüm gün notları için `gun-notlari.html` sayfasına gidilmesi gerekir.
- Service worker cache versiyonu v7'ye yükseltildi.


## Final v8 düzeltmeleri

- Karanlık modda yazı detay sayfası ve tüm içerik alanları okunabilir hale getirildi.
- Sabit koyu renkli `.article-body` gibi eski renkler override edildi.
- Müzik alanı tamamen değiştirildi: eski blur/bozuk panel kapatıldı, tek ikon + temiz açılır panel yapısı getirildi.
- Service worker cache versiyonu v8'e yükseltildi.


## Final v9 düzeltmeleri

- Açık modda görünmeyen closing/final alan metinleri düzeltildi.
- Şiir defteri görünümü karanlık modda daha okunabilir ve daha az boşluklu hale getirildi.
- Ana Sayfa ve diğer aksiyon butonlarının açık/koyu mod renkleri tutarlı hale getirildi.
- Müzik widget tamamen yenilendi: sağ altta temiz pill buton + üstünde açılır panel.
- Eski müzik widget sınıfları force-hide edildi.
- Service worker cache versiyonu v9'a yükseltildi.


## Final v10 düzeltmeleri

- Müzik sistemi sıfırdan yazıldı.
- Eski tüm müzik widget sınıfları force-hide edildi.
- Sayfada artık tek bir müzik butonu bulunur.
- Hero/ana başlık alanının arka planı kart gibi değil, sayfa arka planı ile aynı yapıldı.
- Service worker cache versiyonu v10'a yükseltildi.


## Final v11 düzeltmeleri

- Eski müzik butonu kalıntılarını JS ile periyodik olarak temizleyen sistem eklendi.
- Yeni müzik player tamamen farklı `.hissez-player` sınıflarıyla kuruldu.
- Hero alıntı kutusunda metin taşması düzeltildi.
- “Bugünden bir his” rozeti kutu içinde güvenli hale getirildi.
- Closing alanı sayfa rengine yakın arka planla güncellendi.
- Hakkımda sağ quote kartı açık modda okunur hale getirildi.
- Service worker cache v11'e yükseltildi.


## Final v13 güncellemesi

- Closing alanı tek renk bordo/pembe zemin yapıldı.
- Kayan beyaz şerit efekti korundu.
- Ana sayfa sağ alandaki “Bugünden bir his” rozeti kaldırıldı.
- Ana sayfa sağ alıntı kutusu açık modda temiz, koyu modda okunur hale getirildi.
- Koyu modda ana rengin zemini fazla açması engellendi.
- Eski müzik widget kalıntıları tekrar force-hide edildi.
- Service worker cache v13'e yükseltildi.


## Final v15 — CSS + SEO Pro Revizyon

Bu sürümde public site tarafı temizlendi ve tek bir düzenli CSS mimarisine çekildi.

Öne çıkanlar:
- Eski üst üste eklenmiş CSS override karmaşası kaldırıldı.
- Light/dark tema değişkenleri temiz ve merkezi hale getirildi.
- Tek müzik player yapısı bırakıldı, eski widget kalıntıları kaldırıldı.
- Hero, sağ alıntı kartı, closing gradient alanı, şiir defteri, gün notu timeline ve detay sayfası yeniden dengelendi.
- Responsive kırılımlar sadeleştirildi.
- Erişilebilirlik için skip-link ve focus-visible eklendi.
- Reduced-motion desteği eklendi.
- SEO meta alanları güçlendirildi.
- Open Graph, Twitter Card, canonical, robots, JSON-LD WebSite/Blog/Person yapısı düzenlendi.
- Detay sayfasında dinamik BlogPosting schema temizlendi.
- sitemap.xml güncel lastmod ile yenilendi.
- Vercel için güvenlik/cache headers eklendi.


## Final v16 güncellemesi

Bu tarihsel sürümde e-posta listesi kullanılıyordu. Güncel sürümde frontend e-posta
listesi kaldırılmış, Custom Claim tabanlı yetkilendirmeye geçiş hazırlanmıştır.


## Final v17 — Premium CSS Pro

Bu sürüm v16 üzerinden daha güçlü bir CSS katmanı ile hazırlandı.

Eklenen / güçlendirilenler:
- Premium design token sistemi
- Daha zengin light/dark tema
- Daha sinematik arka plan glow/grid dokusu
- Daha güçlü header, nav ve logo dengesi
- Hero, sağ alıntı kartı ve CTA alanı güçlendirildi
- Featured/post kartlarında premium hover ve derinlik
- Şiir defteri görünümü daha güçlü hale getirildi
- Gün notları timeline daha premium yapıldı
- Yazı detay sayfası daha iyi okuma deneyimi verdi
- Hakkımda ve quote alanları iyileştirildi
- Müzik player tek sistem olarak korundu
- Responsive kırılımlar ve reduced-motion desteği korundu
- sitemap/robots/vercel headers güncellendi
- Service worker cache v17'ye yükseltildi


## Final v18 — Klasör Yapısı Düzenlendi

- Kök klasördeki ikon dosyaları `assets/icons/` altına taşındı.
- `firebase-rules.json` dosyası `config/` altına alındı.
- `README.md` `docs/` altına taşındı.
- HTML, manifest ve service worker yolları yeni yapıya göre güncellendi.
- Kök klasör daha temiz hale getirildi.


## GitHub kök yükleme notu

Bu proje Vercel'de 404 vermemesi için GitHub repository kök dizinine doğrudan yüklenmelidir. `index.html` dosyası repo ana ekranında görünmelidir. Dosyalar ekstra bir üst klasörün içinde kalırsa Vercel ana sayfayı bulamaz.
