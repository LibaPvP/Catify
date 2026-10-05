/* =====================================================================
   Catify community gallery
   Stores shared skins in Firebase Firestore. Skins are tiny (64x64 PNG,
   a few KB), so each one is saved straight into a database document as
   a data URL; no file storage bucket is needed.
   ===================================================================== */

const FIREBASE_VERSION = "10.12.2";
const PAGE_SIZE = 24;
const HIDE_AFTER_REPORTS = 3;       // skins with this many reports disappear from the gallery
const SHARE_COOLDOWN_MS = 60 * 1000; // one share per minute per browser

const $ = id => document.getElementById(id);
const dialog = $("gallery"), grid = $("galleryGrid"), more = $("galleryMore"), gStatus = $("galleryStatus");
const shareBtn = $("shareBtn"), shareName = $("shareName"), shareStatus = $("shareStatus");

const config = window.CATIFY_FIREBASE || {};
const configured = !!(config.apiKey && config.projectId);

/* ------------------------------ browser memory ------------------------------ */
const store = {
  get(k, d) { try { const v = localStorage.getItem("catify:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("catify:" + k, JSON.stringify(v)); } catch { /* private mode */ } },
};
shareName.value = store.get("shareName", "");

/* ------------------------------ Firebase setup ------------------------------ */
let fb = null; // { db, fns }
async function firebase() {
  if (fb) return fb;
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
  const siteKey = window.CATIFY_RECAPTCHA_KEY || "";
  const [{ initializeApp }, fs, ac] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-firestore.js`),
    siteKey ? import(`${base}/firebase-app-check.js`) : null,
  ]);
  const app = initializeApp(config);
  // App Check: proves requests come from the real Catify page, so bots can't flood the gallery
  if (ac) {
    ac.initializeAppCheck(app, { provider: new ac.ReCaptchaV3Provider(siteKey), isTokenAutoRefreshEnabled: true });
  }
  fb = { db: fs.getFirestore(app), fs };
  return fb;
}

/* ------------------------------ helpers ------------------------------ */
function setStatus(el, msg, isError) { el.textContent = msg; el.classList.toggle("error", !!isError); }

function timeAgo(date) {
  if (!date) return "just now";
  const s = Math.max(1, Math.round((Date.now() - date.getTime()) / 1000));
  const steps = [[60, "second"], [60, "minute"], [24, "hour"], [7, "day"], [4.35, "week"], [12, "month"], [Infinity, "year"]];
  let n = s;
  for (const [size, unit] of steps) {
    if (n < size) { n = Math.floor(n); return `${n} ${unit}${n === 1 ? "" : "s"} ago`; }
    n /= size;
  }
}

const cleanName = v => v.replace(/[^A-Za-z0-9_ ]/g, "").replace(/\s+/g, " ").trim().slice(0, 20);

/* Draws a flat front view of a skin (with the ear tips on top) for the gallery cards. */
function drawFigure(canvas, img, slim) {
  const ctx = canvas.getContext("2d");
  const aw = slim ? 3 : 4;
  canvas.width = 16; canvas.height = 33;
  ctx.imageSmoothingEnabled = false;
  const part = (sx, sy, w, h, dx, dy) => ctx.drawImage(img, sx, sy, w, h, dx, dy, w, h);
  // ear tips: front row of the head's top face, base then hat layer
  part(8, 7, 8, 1, 4, 0); part(40, 7, 8, 1, 4, 0);
  // head
  part(8, 8, 8, 8, 4, 1); part(40, 8, 8, 8, 4, 1);
  // body
  part(20, 20, 8, 12, 4, 9); part(20, 36, 8, 12, 4, 9);
  // arms (the character's right arm is on the viewer's left)
  part(44, 20, aw, 12, 4 - aw, 9); part(44, 36, aw, 12, 4 - aw, 9);
  part(36, 52, aw, 12, 12, 9); part(52, 52, aw, 12, 12, 9);
  // legs
  part(4, 20, 4, 12, 4, 21); part(4, 36, 4, 12, 4, 21);
  part(20, 52, 4, 12, 8, 21); part(4, 52, 4, 12, 8, 21);
}

function loadImg(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}

function downloadDataUrl(url, name) {
  window.Catify.saveSkin(url, `${name || "catify"}_cat.png`);
}

/* ------------------------------ gallery ------------------------------ */
let lastDoc = null, loading = false, loadedOnce = false, sortBy = "new", generation = 0;
const reported = new Set(store.get("reported", []));
const hearted = new Set(store.get("hearted", []));
const skinLink = id => `${location.origin}${location.pathname}#skin=${id}`;

function card(id, data) {
  const el = document.createElement("article");
  el.className = "skin-card";
  const name = data.name || "Anonymous";
  const when = data.createdAt?.toDate ? data.createdAt.toDate() : null;

  // 3D thumbnail when WebGL is available, flat front view otherwise
  const fig = document.createElement("img");
  fig.className = "skin-figure";
  fig.alt = `${name}'s skin`;
  fig.decoding = "async";
  loadImg(data.png).then(img => {
    if (img.naturalWidth !== 64 || img.naturalHeight !== 64) { el.remove(); return; }
    const url = (() => { try { return window.Catify.renderThumb(img, data.slim); } catch { return null; } })();
    if (url) { fig.src = url; fig.classList.add("is-3d"); }
    else { const c = document.createElement("canvas"); drawFigure(c, img, data.slim); fig.src = c.toDataURL(); }
  }).catch(() => el.remove());

  el.innerHTML = `
    <div class="skin-stage"></div>
    <div class="skin-meta">
      <div class="skin-who"><span class="skin-name"></span><span class="skin-time"></span></div>
      <button class="heart" data-act="heart" aria-pressed="false"><span class="heart-icon" aria-hidden="true"></span><span class="heart-count">0</span></button>
    </div>
    <div class="skin-actions">
      <button class="btn small primary-soft" data-act="use">Try on</button>
      <button class="btn small" data-act="download">Download</button>
      <button class="btn small" data-act="link" aria-label="Copy link to this skin">Link</button>
    </div>
    <button class="skin-report" data-act="report">Report</button>`;
  el.querySelector(".skin-stage").appendChild(fig);
  el.querySelector(".skin-name").textContent = name;
  el.querySelector(".skin-time").textContent = timeAgo(when);
  const reportBtn = el.querySelector('[data-act="report"]');
  if (reported.has(id)) { reportBtn.disabled = true; reportBtn.textContent = "Reported"; }

  const heartBtn = el.querySelector(".heart"), heartCount = el.querySelector(".heart-count");
  let hearts = data.hearts || 0;
  const paintHeart = () => {
    const on = hearted.has(id);
    heartBtn.setAttribute("aria-pressed", on);
    heartBtn.setAttribute("aria-label", `${on ? "Remove heart" : "Give a heart"} (${hearts})`);
    heartCount.textContent = hearts;
  };
  paintHeart();

  el.addEventListener("click", async e => {
    const act = e.target.closest("button")?.dataset.act;
    if (act === "use") {
      try { await window.Catify.loadShared(data.png, { name: data.name, slim: data.slim }); dialog.close(); }
      catch { setStatus(gStatus, "That skin couldn't be loaded.", true); }
    } else if (act === "download") {
      downloadDataUrl(data.png, (data.name || "gallery").replace(/\s+/g, "_"));
    } else if (act === "heart") {
      if (heartBtn.disabled) return;
      const adding = !hearted.has(id);
      // show it straight away, undo if the database says no
      hearts = Math.max(0, hearts + (adding ? 1 : -1));
      adding ? hearted.add(id) : hearted.delete(id);
      paintHeart(); heartBtn.classList.toggle("pop", adding);
      heartBtn.disabled = true;
      try {
        const { db, fs } = await firebase();
        await fs.updateDoc(fs.doc(db, "skins", id), { hearts: fs.increment(adding ? 1 : -1) });
        store.set("hearted", [...hearted]);
      } catch (err) {
        console.warn(err);
        hearts = Math.max(0, hearts + (adding ? -1 : 1));
        adding ? hearted.delete(id) : hearted.add(id);
        paintHeart();
        setStatus(gStatus, "Couldn't save your heart. Try again later.", true);
      } finally { heartBtn.disabled = false; }
    } else if (act === "link") {
      copyLink(id, name);
    } else if (act === "report") {
      if (!confirm("Report this skin as inappropriate? Skins with several reports are hidden.")) return;
      try {
        const { db, fs } = await firebase();
        await fs.updateDoc(fs.doc(db, "skins", id), { reports: fs.increment(1) });
        reported.add(id); store.set("reported", [...reported]);
        reportBtn.disabled = true; reportBtn.textContent = "Reported";
        el.classList.add("is-reported");
      } catch (err) {
        console.warn(err);
        setStatus(gStatus, "Couldn't send the report. Try again later.", true);
      }
    }
  });
  return el;
}

async function loadPage() {
  if (loading) return;
  loading = true; more.disabled = true;
  const gen = generation;
  if (!lastDoc) setStatus(gStatus, "Loading skins…");
  try {
    const { db, fs } = await firebase();
    const order = sortBy === "loved" ? fs.orderBy("hearts", "desc") : fs.orderBy("createdAt", "desc");
    const parts = [fs.collection(db, "skins"), order];
    if (lastDoc) parts.push(fs.startAfter(lastDoc));
    parts.push(fs.limit(PAGE_SIZE));
    const snap = await fs.getDocs(fs.query(...parts));
    if (gen !== generation) return; // the tab was switched while this was loading
    let shown = 0;
    snap.forEach(d => {
      const data = d.data();
      if ((data.reports || 0) >= HIDE_AFTER_REPORTS || typeof data.png !== "string") return;
      grid.appendChild(card(d.id, data)); shown++;
    });
    lastDoc = snap.docs[snap.docs.length - 1] || lastDoc;
    more.classList.toggle("hidden", snap.size < PAGE_SIZE);
    if (!grid.children.length) setStatus(gStatus, "No skins yet. Be the first to share one!");
    else setStatus(gStatus, "");
    loadedOnce = true;
  } catch (err) {
    console.warn("Gallery error:", err);
    setStatus(gStatus, "The gallery couldn't load right now. Check your connection and try again.", true);
  } finally {
    loading = false; more.disabled = false;
  }
}

function refreshGallery() {
  generation++;
  grid.innerHTML = ""; lastDoc = null; loadedOnce = false; loading = false;
  more.classList.add("hidden");
  loadPage();
}

// Newest / Most loved tabs (added here so index.html doesn't need to change)
if (!$("gallerySort")) {
  const sort = document.createElement("div");
  sort.className = "seg gallery-sort"; sort.id = "gallerySort";
  sort.setAttribute("role", "group"); sort.setAttribute("aria-label", "Sort skins");
  sort.innerHTML = '<button data-sort="new" aria-pressed="true">Newest</button><button data-sort="loved" aria-pressed="false">Most loved</button>';
  document.querySelector(".gallery-head").appendChild(sort);
}
document.querySelectorAll("#gallerySort button").forEach(b => b.addEventListener("click", () => {
  if (sortBy === b.dataset.sort) return;
  sortBy = b.dataset.sort;
  document.querySelectorAll("#gallerySort button").forEach(x => x.setAttribute("aria-pressed", x === b));
  if (configured) refreshGallery();
}));

/* ------------------------------ share links ------------------------------ */
async function copyLink(id, name) {
  const url = skinLink(id);
  // phones: the share sheet (Discord, WhatsApp…); computers: copy to clipboard
  if (matchMedia("(pointer: coarse)").matches && navigator.share) {
    try { await navigator.share({ title: `${name}'s Catify skin`, url }); return; }
    catch (e) { if (e.name === "AbortError") return; }
  }
  try { await navigator.clipboard.writeText(url); toast("Link copied, paste it anywhere, nya~"); }
  catch { prompt("Copy this link:", url); }
}

// Opening a link like …/Catify/#skin=abc123 shows that skin straight away
async function openFromLink() {
  const m = /^#skin=([A-Za-z0-9]{1,40})$/.exec(location.hash);
  if (!m || !configured) return;
  try {
    const { db, fs } = await firebase();
    const snap = await fs.getDoc(fs.doc(db, "skins", m[1]));
    const data = snap.exists() ? snap.data() : null;
    if (!data || (data.reports || 0) >= HIDE_AFTER_REPORTS || typeof data.png !== "string") {
      toast("That skin isn't in the gallery anymore.");
      return;
    }
    await window.Catify.loadShared(data.png, { name: data.name, slim: data.slim });
    toast(`Showing ${data.name || "someone"}'s skin from the gallery`);
  } catch (err) {
    console.warn("Skin link error:", err);
    toast("That skin link couldn't be opened.");
  }
}
window.addEventListener("hashchange", openFromLink);
openFromLink();

function openGallery() {
  if (!dialog.open) dialog.showModal();
  if (!configured) {
    setStatus(gStatus, "The gallery isn't set up yet. The site owner needs to add the Firebase settings (see README).");
    return;
  }
  if (!loadedOnce) loadPage();
}

$("galleryBtn").addEventListener("click", openGallery);
$("galleryClose").addEventListener("click", () => dialog.close());
more.addEventListener("click", loadPage);
// click on the dimmed backdrop closes the gallery
dialog.addEventListener("click", e => { if (e.target === dialog) dialog.close(); });

/* ------------------------------ sharing ------------------------------ */
let lastSharedPng = store.get("lastSharedPng", "");

// Adds a skin to the gallery. Returns a short message describing what happened.
async function addToGallery(png, { quiet = false } = {}) {
  const say = (msg, err) => { if (!quiet) setStatus(shareStatus, msg, err); return { ok: false, msg }; };
  if (!configured) return say("The gallery isn't set up yet.", true);
  if (!window.Catify.earsOn()) return say("Turn on \"Show cat ears\" first, this is a cat ear gallery!", true);
  if (png === lastSharedPng) return say("You already shared this exact skin.", true);
  const wait = store.get("lastShareAt", 0) + SHARE_COOLDOWN_MS - Date.now();
  if (wait > 0) return say(`Please wait ${Math.ceil(wait / 1000)} seconds before sharing again.`, true);
  if (png.length >= 16000) return say("This skin is too detailed to share (file too big).", true);

  const typed = cleanName(shareName.value);
  store.set("shareName", typed);
  // no name typed: use the Minecraft username the skin was loaded with (if any)
  const name = typed || cleanName(window.Catify.mcName() || "");
  shareBtn.disabled = true;
  if (!quiet) setStatus(shareStatus, "Sharing…");
  try {
    const { db, fs } = await firebase();
    await fs.addDoc(fs.collection(db, "skins"), {
      png, name, slim: window.Catify.isSlim(), createdAt: fs.serverTimestamp(), reports: 0, hearts: 0,
    });
    lastSharedPng = png;
    store.set("lastSharedPng", png);
    store.set("lastShareAt", Date.now());
    setStatus(shareStatus, "Shared! Your skin is now in the gallery, nya~");
    if (loadedOnce) refreshGallery();
    return { ok: true };
  } catch (err) {
    console.warn("Share error:", err);
    return say("Sharing failed. Try again in a moment.", true);
  } finally {
    shareBtn.disabled = false;
  }
}
const share = () => addToGallery(window.Catify.getPNG());

/* Every download is also added to the gallery (no need to press Share). */
let toastTimer = null;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 4500);
}
window.CatifyGallery = {
  async onDownload(png) {
    const res = await addToGallery(png, { quiet: true });
    if (res.ok) toast("Skin saved, and added to the community gallery, nya~");
  },
};

shareBtn.addEventListener("click", share);
shareName.addEventListener("keydown", e => { if (e.key === "Enter") share(); });

if (!configured) {
  setStatus(shareStatus, "Sharing turns on once the gallery is set up (see README).");
}
