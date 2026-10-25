// Playwright ayarı: tests/ altındaki uçtan uca testleri web/ klasörünü sunan
// yerel bir statik sunucuya karşı çalıştırır. Uygulamanın build adımı yoktur;
// sunulan dosyalar Vercel'e giden dosyaların birebir aynısıdır.
const { defineConfig } = require("@playwright/test");

const PORT = 8137;

module.exports = defineConfig({
  testDir: "tests",
  // CI'da yeniden deneme yok: aralıklı kırmızıyı gizlemek yerine görünür kılsın.
  retries: 0,
  // Testler localStorage'a yazar ama her test kendi tarayıcı bağlamında koşar; paralellik güvenli.
  fullyParallel: true,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    browserName: "chromium",
    // localhost güvenli bağlam sayılır: geolocation ve service worker HTTPS olmadan çalışır.
    launchOptions: {
      // Mikrofon izni penceresini otomatik onayla ve sahte ses cihazları üret: cihaz
      // listesi (enumerateDevices) gerçek donanım olmadan dolar.
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
    },
  },
  webServer: {
    command: `python3 -m http.server ${PORT} --directory web`,
    url: `http://localhost:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
    // http.server her isteği stderr'e yazar; test çıktısını boğmasın. Sunucu açılmazsa
    // Playwright url beklemesinde zaman aşımıyla zaten hata verir.
    stderr: "ignore",
  },
});
