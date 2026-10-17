# Bleep: Uygulama Tanımı ve Yeniden Oluşturma Prompt'u

Aşağıdaki metni bir yapay zekâya ya da geliştiriciye olduğu gibi verebilirsin. Uygulamanın ne yaptığını, nasıl çalıştığını ve hangi sınırlar içinde kaldığını eksiksiz anlatır.

---

## Prompt

Sen deneyimli bir web geliştiricisisin. **Bleep** adında, tek HTML dosyasından oluşan, yüklenebilir bir web uygulaması (PWA) yazacaksın. Arayüz dili Türkçe olacak.

### Amaç
Kullanıcı, telefonuna ya da bilgisayarına Bluetooth ile **bağlı** kulaklığını kaybettiğinde, kulaklıktan yüksek ve kesintisiz bir bip sesi çalarak sesin geldiği yönü takip edip kulaklığı bulur. Uygulama bütün kulaklık markaları için çalışır. AirPods'a özel değildir.

### Uyulması zorunlu teknik gerçekler
Bunları değiştirmeye ya da aşmaya çalışma, kullanıcıya da aksini vaat etme:

1. **Web Bluetooth ses aktaramaz.** Sadece BLE veri bağlantısı kurabilir, iOS'ta hiç yoktur. Bu yüzden sayfa kulaklığa kendisi **bağlanmaz**. Kulaklık işletim sisteminin Bluetooth ayarlarından bağlanır, sayfa sadece onu **ses çıkışı olarak seçer** ve sesi oraya gönderir.
2. **Sayfa sistem ses seviyesini değiştiremez**, kulaklığın donanım limitini de aşamaz. Sayfanın kontrol edebildiği tek şey kendi ürettiği sinyalin seviyesidir. Kullanıcıya sistem sesini fiziksel tuşlarla açmasını hatırlat.
3. **Kulak algılama:** AirPods gibi kulaklıklar takılı değilken işletim sistemi sesi kulaklığa göndermez. Bu, kod ile çözülemez. Kullanıcıya ayarın kapatılması gerektiğini söyle.
4. **Kutusundaki, şarjı bitmiş ya da menzil dışındaki kulaklık çalmaz.** Uygulama Apple'ın Find My özelliğinin yerine geçmez.

### Ekran düzeni
Telefon öncelikli, tek ekran. Her şey alt alta dizilmiş bir form gibi değil:

- **Üst bar:** Solda sadece uygulama ikonu (yazı yok, `alt="Bleep"`). Sağda iki hap şeklinde buton:
  - **"Yükle"**: Sadece uygulama yüklenebilir olduğunda görünür.
  - **Cihaz göstergesi**: Bir durum noktası ve metin. Bağlanmadan önce "Cihaz seç" yazar. Bağlandıktan sonra cihazın adını yazar, nokta sarı olur. Dokununca cihaz seçme paneli açılır.
- **Ortada büyük yuvarlak buton** (telefonda 230px, geniş ekranda 280px). Üç durumu var:
  - **Bağlı değil:** Gri, 🎧 ikonu. Başlık "Önce bağlan", alt yazı "Kulaklığını seçmek için dokun". Dokununca cihaz seçme panelini açar, ses çalmaz.
  - **Hazır:** Sarı zemin, siyah yazı. ▶ ikonu, başlık "Çal", alt yazı "Kesintisiz bip".
  - **Çalıyor:** Turuncu zemin, siyah yazı. ■ ikonu, başlık "Durdur", alt yazı "Sese doğru yürü". Butonun etrafından üç halka sürekli dışa doğru yayılır. `prefers-reduced-motion` açıksa animasyon durur.
- **Altta iki kontrol kutusu yan yana:**
  - **Şiddet:** 0–200%, varsayılan 200%. Değer büyük puntoyla yazar. 100%'ün üstündeyse yanında turuncu "BOOST" etiketi çıkar.
  - **Ton:** 500–4000 Hz, adım 50, varsayılan 1000 Hz. "1.0 kHz" biçiminde gösterilir.
  - İkisi de çalarken anında etkili olur.
- **Uyarı kutusu:** "Takılı değilken çalmıyorsa kulaklığının kulak algılama ayarını kapat (AirPods'ta: Otomatik Kulak Algılama). Kulaklık kulağındayken çalma; ses işitmene zarar verebilir."
- **Geniş ekran (≥ 820px):** Büyük buton solda, kontroller sağda alt alta.

### Cihaz seçme (tarayıcıya göre üç yol)
1. **`navigator.mediaDevices.selectAudioOutput` varsa (Firefox):** Tarayıcının kendi seçim penceresini aç. Seçilen cihazın `deviceId`'sini sakla.
2. **`setSinkId` destekleniyorsa (Chrome, Edge):**
   - Cihaz adlarını görebilmek için önce `getUserMedia({audio:true})` ile mikrofon izni iste, akışı hemen durdur.
   - `enumerateDevices()` ile `audiooutput` türündeki cihazları alttan açılan bir panelde (`<dialog>`) listele.
   - Adı şu desene uyan cihazları listenin üstüne al, kenarlığını vurgula ve yanına 🎧 koy: `/airpods|beats|buds|pods|headphone|headset|earphone|earbud|kulakl|bose|jabra|sennheiser|wh-|wf-|jbl|soundcore/i`.
   - Listede bu desene uyan cihaz yoksa "Listede kulaklık görünmüyor…" mesajını göster.
3. **İkisi de yoksa (iOS Safari):** Seçim yapılamaz. Panelde adımları göster: kulaklığı aç, Denetim Merkezi'ndeki AirPlay simgesinden kulaklığı seç, geri dön. Altına "Kulaklığımı bağladım" butonu koy. Bu butona basınca uygulama sistemin varsayılan ses çıkışını kullanır.

Bağlantı onaylanınca: cihaz göstergesi güncellenir, panel kapanır ve büyük buton "Hazır" durumuna geçer.

### Ses motoru (Web Audio API)
- Zincir: `OscillatorNode (sine)` → `GainNode drive` → `WaveShaperNode` → `GainNode out` → çıkış.
- **WaveShaper eğrisi:** `Float32Array([-1, 1])` (doğrusal), `oversample = "4x"`. Böylece ±1 dışına çıkan sinyal sert biçimde kırpılır.
- **Şiddet eşlemesi** (`v` = kaydırıcı değeri):
  - `v ≤ 100`: `drive = 1`, `out = (v/100)² × 0.98`. Temiz sinüs; karesel eğri, kulağa doğrusal gelen bir artış sağlar.
  - `v > 100` (boost): `drive = 1 + (v−100)/100 × 7` (en fazla 8), `out = 0.95`. Sinyal kırpılarak kare dalgaya yaklaşır. Tepe seviyesi aynı kalır, enerji (RMS) yaklaşık +2.5 dB artar ve ses daha keskin duyulur.
- Kaydırıcılar değişince `setTargetAtTime(değer, now, 0.02)` kullan, tıkırtı olmasın.
- **Ses çıkışını yönlendirme:**
  - `AudioContext.prototype.setSinkId` varsa: `ctx.setSinkId(deviceId)`.
  - Yoksa ama `HTMLMediaElement.setSinkId` varsa: Sesi `MediaStreamAudioDestinationNode` üzerinden bir `<audio>` elemanına bağla, o elemana `setSinkId` uygula, `play()` çağır.
  - İkisi de yoksa: varsayılan çıkışı (`ctx.destination`) kullan.
- **iOS:** Sessiz anahtarı açıkken de çalması için `navigator.audioSession.type = "playback"` ayarla (destekleniyorsa).
- **Durdur:** Oscillator'ı, `<audio>` elemanını ve `AudioContext`'i kapatıp serbest bırak. Ses kullanıcı Durdur'a basana kadar kesintisiz çalar.
- `AudioContext` mutlaka kullanıcının dokunuşuyla başlatılmalı (autoplay kuralları).
- Hata olursa büyük butonun alt yazısında "Çalınamadı: …" göster.

### Web App (PWA)
- `manifest.webmanifest`:
  - `name` ve `short_name`: "Bleep"
  - `display`: "standalone", `orientation`: "portrait"
  - `background_color`: `#ffd23f`, `theme_color`: `#0f0e0b`
  - İkonlar: 192px, 512px ve maskable 512px PNG ile SVG.
- **iOS meta etiketleri:** `apple-mobile-web-app-capable`, `apple-mobile-web-app-title="Bleep"`, `status-bar-style="black-translucent"`, `apple-touch-icon` (180px). Kenarlara `env(safe-area-inset-*)` boşluğu ver.
- **Service worker:** Uygulamanın kendi dosyalarını önbelleğe alır.
  - Strateji: önce ağdan dene, ağ yoksa önbellekten ver.
  - Önbellek adı sürümlü olsun (ör. `bleep-v4`), yeni sürüm gelince eskisini silsin.
  - Sadece HTTPS ya da localhost'ta kaydolsun.
- **"Yükle" butonu:**
  - Chrome ve Android: `beforeinstallprompt` olayını yakala, buton tarayıcının kendi yükleme penceresini açsın.
  - iOS Safari'de, ana ekrandan açılmamışsa: buton, "Paylaş → Ana Ekrana Ekle → Ekle" adımlarını gösteren bir panel açsın.

### Görsel kimlik
- **İkon:** Sarı (`#ffd23f`) yuvarlatılmış kare zemin. Üzerinde siyah (`#111`) bir kulak içi kulaklık ve sağında iki ses dalgası (dıştaki %50 saydam). Düz renkler, gradyan yok.
- **Palet** (CSS değişkenleri, koyu ve açık tema `prefers-color-scheme` ile):
  - **Koyu tema:**
    - Zemin `#0f0e0b`, kutu `#1a1915`, çizgi `#312e25`
    - Yazı `#f6f3ea`, soluk yazı `#a8a291`
    - Vurgu (kaydırıcı, nokta) sarı `#ffd23f`
  - **Açık tema:**
    - Zemin krem `#fff8e1`, kutu `#ffffff`, çizgi `#efe4bf`
    - Yazı `#111`, soluk yazı `#6b6450`
    - Kaydırıcılar siyah (sarı, krem zeminde kaybolur)
  - **İki temada da aynı:**
    - Ana butonlar sarı zemin üzerinde siyah yazı.
    - "Çalıyor" rengi turuncu (`#ff6b3d` koyu, `#f2552c` açık).
- Yazı tipi sistem fontu (`-apple-system, Segoe UI, Roboto`). Telefon genişliğinde (390px) sayfa yana taşmamalı.

### Kabul kriterleri
- Bağlanmadan önce Çal butonu ses çalmaz, cihaz panelini açar.
- Bağlanınca butona basılınca ses başlar, Durdur'a basılınca tamamen kesilir.
- Çalarken şiddet ve ton değişiklikleri anında duyulur. Boost'ta tepe seviyesi 1.0'ı aşmaz.
- Telefon ve masaüstü, açık ve koyu temada konsolda hata yok.
- Chrome'un yüklenebilirlik kontrolü hata vermez. Sayfa internet yokken de açılır.
- Hiçbir metin uygulamanın Bluetooth ile kendisi bağlandığını, sistem sesini yükselttiğini ya da kutusundaki kulaklığı bulabildiğini iddia etmez.
