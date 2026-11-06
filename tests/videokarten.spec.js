// Videokarten: verdeckter Stapel, am Magnum-Abend zieht jede Person, die dabei ist, eine Karte.
const { test, expect, login, tab, BEAT } = require("./fixtures");

// Ein Anlass, der gerade läuft (die Testuhr steht auf 31.10.2026, 10:00), und vier Karten im Stapel
const stapel = (page, beatStatus = "in") => page.evaluate((st) => {
  const d = window.__mg.db(), jetzt = Date.now();
  d.events.push({ id: "e-jetzt", title: "Oktober-Magnum", starts_at: new Date(jetzt - 3600e3).toISOString(), location: "Pinte", organizer_id: null, created_by: "u-ot", created_at: new Date(jetzt - 864e5).toISOString() });
  if (st) d.rsvps.push({ event_id: "e-jetzt", member_id: "u-beat", status: st, redeemed: false, updated_at: new Date(jetzt - 864e5).toISOString() });
  d.video_karten.push(
    { id: "v-1", title: "Korken knallt", path: "videos/u-ot/1.webm", created_by: "u-ot", created_at: new Date(jetzt - 5e6).toISOString() },
    { id: "v-2", title: "Kurt tanzt", path: "videos/u-chris/2.webm", created_by: "u-chris", created_at: new Date(jetzt - 4e6).toISOString() },
    { id: "v-3", title: "Der Schwur", path: "videos/u-chris/3.webm", created_by: "u-chris", created_at: new Date(jetzt - 3e6).toISOString() },
    { id: "v-4", title: "Beats Video", path: "videos/u-beat/4.webm", created_by: "u-beat", created_at: new Date(jetzt - 2e6).toISOString() });
  localStorage.setItem("__mg_db", JSON.stringify(d));
}, beatStatus);

test.describe("Videokarten", () => {
  test("am Abend eine Karte ziehen: Stand mit Prozent, nie die eigene, nur einmal", async ({ page }) => {
    await page.goto("/");
    await stapel(page);
    await login(page, BEAT);
    await tab(page, "Karten");
    await expect(page.locator("[data-test=video-stand]")).toHaveText("0 von 4 · 0 %");
    await expect(page.locator("[data-test=video-eigene]")).toHaveText("Von dir im Stapel: 1");
    // Verdeckt: Beat sieht nur die eigene Karte, nicht die der anderen
    expect(await page.evaluate(() => D.video_karten.map((k) => k.id))).toEqual(["v-4"]);

    await tab(page, "Termine");
    const box = page.locator("[aria-label='Karte ziehen']");
    await expect(box).toContainText("Oktober-Magnum");
    await box.getByRole("button", { name: "Karte ziehen" }).click();
    await expect(page.locator("#toast")).toContainText("Deine Karte ist gezogen");
    await expect(page.locator("#ov video")).toHaveCount(1);
    const gezogen = await page.evaluate(() => OV.id);
    expect(["v-1", "v-2", "v-3"]).toContain(gezogen);
    await page.getByRole("button", { name: "Zurück" }).click();
    await expect(box).toHaveCount(0);

    await tab(page, "Karten");
    await expect(page.locator("[data-test=video-stand]")).toHaveText("1 von 4 · 25 %");
    await expect(page.locator("[aria-label=Videokarten] .kc")).toHaveCount(1);
    await tab(page, "Club");
    await expect(page.locator("li", { hasText: "Beat" }).locator("[data-test=video-zahl]")).toHaveText("🎬 1");

    // Ein zweites Mal geht nicht, auch nicht an der App vorbei
    const fehler = await page.evaluate(() => sb.rpc("karte_ziehen", { p_event: "e-jetzt" }).then((r) => r.error && r.error.message));
    expect(fehler).toContain("schon gezogen");
  });

  test("wer nicht dabei ist, bekommt keine Karte", async ({ page }) => {
    await page.goto("/");
    await stapel(page, "out");
    await login(page, BEAT);
    await expect(page.locator("[data-test=punkte]")).toBeVisible();
    await expect(page.locator("[aria-label='Karte ziehen']")).toHaveCount(0);
    const fehler = await page.evaluate(() => sb.rpc("karte_ziehen", { p_event: "e-jetzt" }).then((r) => r.error && r.error.message));
    expect(fehler).toContain("nur für alle, die dabei sind");
  });

  test("virtuell dabei zieht auch, gezogene Karte lässt sich vom Ersteller nicht mehr löschen", async ({ page }) => {
    await page.goto("/");
    await stapel(page, "virtual");
    await login(page, BEAT);
    await page.locator("[aria-label='Karte ziehen']").getByRole("button", { name: "Karte ziehen" }).click();
    await expect(page.locator("#ov video")).toHaveCount(1);
    await expect(page.locator("#ov").getByRole("button", { name: "Videokarte löschen" })).toHaveCount(0);
  });

  test("Video wird auf 7 Sekunden gekürzt und verdeckt in den Stapel gelegt", async ({ page }, info) => {
    test.skip(info.project.name != "desktop", "braucht echtes Aufnehmen im Browser, einmal reicht");
    test.setTimeout(90000);
    await login(page, BEAT);
    // Testvideo: 9 Sekunden, im Browser aufgenommen
    const daten = await page.evaluate(() => new Promise((ok) => {
      const c = document.createElement("canvas"); c.width = 320; c.height = 240; const g = c.getContext("2d");
      const rec = new MediaRecorder(c.captureStream(25), { mimeType: "video/webm" }), teile = [];
      rec.ondataavailable = (e) => teile.push(e.data);
      rec.onstop = async () => ok(Array.from(new Uint8Array(await new Blob(teile).arrayBuffer())));
      const t0 = performance.now(); rec.start(200);
      (function malen() { const t = (performance.now() - t0) / 1000; g.fillStyle = "hsl(" + (t * 40) + ",70%,40%)"; g.fillRect(0, 0, 320, 240); g.fillStyle = "#fff"; g.font = "60px sans-serif"; g.fillText(t.toFixed(1), 80, 140); if (t < 9) requestAnimationFrame(malen); else rec.stop() })();
    }));
    await tab(page, "Karten");
    await page.getByRole("button", { name: "+ Videokarte hochladen" }).click();
    await page.locator("[data-k=vkTitle]").fill("Neun Sekunden");
    await page.locator("input[aria-label='Video wählen']").setInputFiles({ name: "lang.webm", mimeType: "video/webm", buffer: Buffer.from(daten) });
    await expect(page.locator("[data-test=video-gewaehlt]")).toContainText("lang.webm");
    await page.getByRole("button", { name: "In den Stapel legen" }).click();
    await expect(page.locator("#toast")).toContainText("verdeckt im Stapel", { timeout: 40000 });
    await expect(page.locator("[data-test=video-eigene]")).toHaveText("Von dir im Stapel: 1");
    await expect(page.locator("[data-test=video-stand]")).toHaveText("0 von 1 · 0 %");
    // Länge des gespeicherten Videos messen (WebM aus dem Browser kennt seine Dauer erst nach einem Sprung ans Ende)
    const dauer = await page.evaluate(() => new Promise((ok) => {
      const b = Object.values(window.__mg_videos)[0], v = document.createElement("video");
      v.muted = true; v.src = URL.createObjectURL(b);
      v.onloadedmetadata = () => { if (isFinite(v.duration)) return ok(v.duration); v.currentTime = 1e6; v.ontimeupdate = () => { v.ontimeupdate = null; ok(v.duration) } };
    }));
    expect(dauer).toBeGreaterThan(5.5);
    expect(dauer).toBeLessThan(7.6);
  });
});
