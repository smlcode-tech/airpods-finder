// Bleep PWA uçtan uca testleri: cihaz bağlama akışı ve cihaza göre gruplanan
// "Son görüldüğü yer" konum geçmişi. Gerçek tarayıcıda koşar; yalnız lint'in
// göremeyeceği hataları (ör. `defer`'li Leaflet'in yükleme sırası) yakalamak için var.
const { test, expect } = require("@playwright/test");

const IST = { latitude: 41.0082, longitude: 28.9784, accuracy: 14 };

// OSM karolarını kes: testler dış ağa bağımlı olmasın, CI'da aralıklı kırmızı çıkmasın.
// Sayfa hatalarını da topla: her test sonunda "JS hatası yok" doğrulanır.
// Bir worker içindeki testler sırayla koştuğu için modül düzeyinde tek dizi yeterli.
let pageErrors = [];
test.beforeEach(async ({ context, page }) => {
  await context.route(/tile\.openstreetmap\.org/, (r) => r.abort());
  pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => {
    // Kesilen karo istekleri "Failed to load resource" üretir; bu beklenen gürültüdür.
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) pageErrors.push(m.text());
  });
});
test.afterEach(async () => {
  expect(pageErrors, "sayfada JS hatası olmamalı").toEqual([]);
});

// iOS gibi cihaz adını vermeyen tarayıcıyı taklit eder: etiketler boş gelince
// uygulama manuel (ad soran) yola düşer.
const forceManual = () => {
  const orig = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
  navigator.mediaDevices.enumerateDevices = async () =>
    (await orig()).map((d) => ({ kind: d.kind, deviceId: d.deviceId, label: "" }));
};

// Manuel yolda bağlanır: "btn:Ad" önceki ad düğmesine, düz metin yeni ad alanına gider.
async function manualConnect(page, name) {
  await page.click("#pill");
  if (name.startsWith("btn:")) await page.click(`#manual .dev:has-text("${name.slice(4)}")`);
  else {
    await page.fill("#nameInput", name);
    await page.click("#manual .btn");
  }
}

const history = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("bleep.history") || "null"));

test.describe("konum izni varken", () => {
  test.use({ permissions: ["geolocation"], geolocation: IST });

  test("ilk açılışta boş durum görünür", async ({ page }) => {
    await page.goto("/index.html");
    await expect(page.locator("#seenEmpty")).toBeVisible();
    await expect(page.locator("#seenDevice")).toBeHidden();
    await expect(page.locator("#map")).toBeHidden();
    await expect(page.locator("#seenList")).toBeHidden();
  });

  test("cihaz listesinden bağlanınca kayıt o cihazın adıyla tutulur", async ({ page }) => {
    await page.goto("/index.html");
    await page.click("#pill");
    const dev = page.locator(".dev").first();
    const label = await dev.locator("span").first().textContent();
    await dev.click();
    await expect(page.locator("#app")).toHaveClass(/ready/);
    await expect(page.locator("#seenList li")).toHaveCount(1);
    await expect(page.locator("#seenDevice option")).toHaveCount(1);
    // Leaflet `defer` ile yüklenir; marker çıkıyorsa yükleme sırası doğrudur.
    await expect(page.locator("#map .leaflet-marker-icon")).toHaveCount(1);
    const h = await history(page);
    expect(Object.values(h.devices).map((d) => d.name)).toEqual([label]);
  });

  test.describe("manuel (iOS) yol", () => {
    test.beforeEach(async ({ context }) => { await context.addInitScript(forceManual); });

    test("ad verilir, geçmiş cihaza göre gruplanır ve seçiciyle gezilir", async ({ page }) => {
      await page.goto("/index.html");
      await page.click("#pill");
      await expect(page.locator("#nameInput")).toBeVisible();
      await expect(page.locator("#manual .dev")).toHaveCount(0);   // önceki ad yok
      await page.click("#closeSheet");

      await manualConnect(page, "AirPods Pro");
      await expect(page.locator("#pillText")).toHaveText("AirPods Pro");
      await expect(page.locator("#seenList li")).toHaveCount(1);

      await manualConnect(page, "btn:AirPods Pro");                 // önceki ad düğmesiyle
      await expect(page.locator("#seenList li")).toHaveCount(2);
      await expect(page.locator("#map .leaflet-marker-icon")).toHaveCount(2);
      // Zaman damgası: "gg.aa.yyyy ss:dd · ±N m"
      await expect(page.locator("#seenList li button span").first()).toHaveText(/^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2} · ±\d+ m$/);
      await expect(page.locator("#seenWhen")).toHaveText(/^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}/);

      await manualConnect(page, "Beats Studio");
      await expect(page.locator("#seenDevice option")).toHaveCount(2);
      await expect(page.locator("#seenDevice")).toHaveValue("beats studio");
      await expect(page.locator("#seenList li")).toHaveCount(1);

      await page.selectOption("#seenDevice", "airpods pro");
      await expect(page.locator("#seenList li")).toHaveCount(2);
      await page.click("#seenList li:nth-child(2) button");
      await expect(page.locator("#seenList li:nth-child(2) button")).toHaveClass(/sel/);
      await expect(page.locator("#seenOpen")).toHaveAttribute("href", /mlat=41\.0082/);

      // Önceki adlar en son bağlanan önde listelenir.
      await page.click("#pill");
      await expect(page.locator("#manual .dev span:first-child")).toHaveText(["Beats Studio", "AirPods Pro"]);
      await page.click("#closeSheet");

      // Yeniden açılış: son seçilen cihaz ve haritası geri gelir.
      await page.reload();
      await expect(page.locator("#seenDevice")).toHaveValue("airpods pro");
      await expect(page.locator("#map .leaflet-marker-icon")).toHaveCount(2);
    });

    test("cihaz başına en fazla 50 kayıt tutulur", async ({ page }) => {
      await page.goto("/index.html");
      await page.evaluate(() => {
        const recs = Array.from({ length: 55 }, (_, i) => ({ lat: 41 + i / 1000, lng: 29, acc: 10, t: Date.now() - i * 3600e3 }));
        localStorage.setItem("bleep.history", JSON.stringify({ v: 1, devices: { x: { name: "X", records: recs } } }));
      });
      await manualConnect(page, "btn:X");
      await expect(page.locator("#seenList li")).toHaveCount(50);
      expect((await history(page)).devices.x.records).toHaveLength(50);
      // 50 satır sayfayı uzatmasın: liste kendi içinde kayar.
      expect(await page.locator("#seenList").evaluate((e) => e.clientHeight)).toBeLessThanOrEqual(200);
    });
  });
});

test("eski tek kayıt (bleep.lastSeen) geçmişe taşınır", async ({ page }) => {
  await page.goto("/index.html");
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("bleep.lastSeen", JSON.stringify({ lat: 41, lng: 29, acc: 9, t: Date.now() - 7200e3 }));
  });
  await page.reload();
  await expect(page.locator("#map")).toBeVisible();
  await expect(page.locator("#seenDevice option")).toHaveText([/^Önceki kayıt · 1 kayıt$/]);
  expect(await page.evaluate(() => localStorage.getItem("bleep.lastSeen"))).toBeNull();
});

test.describe("konum izni reddedilince", () => {
  test.use({ permissions: [] });
  test.beforeEach(async ({ context }) => { await context.addInitScript(forceManual); });

  test("bağlanma bozulmaz, kart boş durumda kalır", async ({ page }) => {
    await page.goto("/index.html");
    await manualConnect(page, "AirPods");
    await expect(page.locator("#app")).toHaveClass(/ready/);
    await expect(page.locator("#seenEmpty")).toBeVisible();
    await expect(page.locator("#map")).toBeHidden();
  });
});

for (const colorScheme of ["dark", "light"]) {
  test.describe(`390px telefon, ${colorScheme} tema`, () => {
    test.use({ viewport: { width: 390, height: 844 }, colorScheme });

    test("geçmiş doluyken yatay taşma yok", async ({ page }) => {
      await page.goto("/index.html");
      await page.evaluate(() => {
        const mk = (n) => Array.from({ length: n }, (_, i) => ({ lat: 41 + i / 500, lng: 29, acc: 12, t: Date.now() - i * 5400e3 }));
        localStorage.setItem("bleep.history", JSON.stringify({ v: 1, devices: {
          "airpods pro": { name: "AirPods Pro", records: mk(4) },
          "beats studio": { name: "Beats Studio", records: mk(2) } } }));
      });
      await page.reload();
      await expect(page.locator("#seenList li")).toHaveCount(4);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
    });
  });
}
