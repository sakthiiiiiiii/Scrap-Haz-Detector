/* Scrap Haz Detector - front-end logic (no build step, no dependencies). */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);

  // ---- Tunables ------------------------------------------------------------
  const SEND_MAX = 800;      // longest side (px) of frames sent to the server
  const MIN_GAP_MS = 120;    // minimum pause between live requests
  const HOLD_MS = 1200;      // keep banner on this long after an object disappears
  const CONFIRM_HITS = 3;    // frames an object must persist before it is counted
  const MAX_MISSED = 8;      // frames an object may vanish before its track is dropped
  const IOU_MATCH = 0.25;    // box overlap needed to treat two frames' boxes as the same object
  const ALERT_COOLDOWN = 1500;

  const META = {
    "shock absorber": { color: "#22e55c", hazard: true,  counter: "count-shock", route: "Route to Depressurization Bin" },
    "cylinder":       { color: "#3b9eff", hazard: false, counter: "count-cyl",   route: "Route to Metal Crusher" },
  };
  const meta = (label) => META[label.toLowerCase()] || { color: "#ffc400", hazard: false };

  // ---- Elements & state ----------------------------------------------------
  const video = $("video"), still = $("still"), overlay = $("overlay"), stage = $("stage"), wrap = $("stage-wrap");
  const ctx = overlay.getContext("2d");
  const grab = document.createElement("canvas");
  const S = { mode: "idle", stream: null, token: 0, modelOk: false, modelMsg: "", blob: null, stillUrl: null,
              dets: [], stillDets: [], lastSeen: {}, counts: {}, tracks: [], nextId: 1, lastAlert: 0,
              srcW: 1280, srcH: 720, done: [], sessionStart: Date.now() };

  // ---- Helpers -------------------------------------------------------------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function say(text) { const m = $("msg"); m.textContent = text || ""; m.hidden = !text; }

  function fitStage(w, h) {
    S.srcW = w; S.srcH = h;
    const k = Math.min((wrap.clientWidth - 20) / w, Math.max(240, window.innerHeight * 0.62) / h);
    stage.style.aspectRatio = "auto";
    stage.style.width = Math.floor(w * k) + "px";
    stage.style.height = Math.floor(h * k) + "px";
    const dpr = window.devicePixelRatio || 1;
    overlay.width = Math.round(stage.clientWidth * dpr);
    overlay.height = Math.round(stage.clientHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(S.mode === "still" ? S.stillDets : S.dets);
  }

  function toBlob(src) {
    const w = src.videoWidth || src.naturalWidth || src.width, h = src.videoHeight || src.naturalHeight || src.height;
    const k = Math.min(1, SEND_MAX / Math.max(w, h));
    grab.width = Math.round(w * k); grab.height = Math.round(h * k);
    grab.getContext("2d").drawImage(src, 0, 0, grab.width, grab.height);
    return new Promise((res) => grab.toBlob(res, "image/jpeg", 0.85));
  }

  async function detect(blob) {
    const form = new FormData();
    form.append("file", blob, "frame.jpg");
    form.append("conf", $("conf").value);
    const r = await fetch("/api/detect", { method: "POST", body: form });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      if (r.status === 503) { S.modelOk = false; S.modelMsg = body.detail || "Model not loaded."; renderPills(); }
      throw new Error(body.detail || `Server error ${r.status}`);
    }
    return r.json();
  }

  // ---- Drawing: bounding boxes + confidence badge --------------------------
  function draw(dets) {
    const W = stage.clientWidth, H = stage.clientHeight;
    ctx.clearRect(0, 0, W, H);
    ctx.font = "700 14px system-ui, sans-serif"; ctx.textBaseline = "middle";
    for (const d of dets) {
      const m = meta(d.label), b = d.box;
      const x = b.x1 * W, y = b.y1 * H, w = (b.x2 - b.x1) * W, h = (b.y2 - b.y1) * H;
      ctx.lineWidth = 3; ctx.strokeStyle = m.color; ctx.strokeRect(x, y, w, h);
      const text = `${d.label} (${(d.confidence * 100).toFixed(1)}%)`;
      const bw = ctx.measureText(text).width + 14, bh = 24;
      const bx = Math.min(Math.max(0, x - 1.5), Math.max(0, W - bw)), by = y - bh >= 0 ? y - bh : y;
      ctx.fillStyle = m.color; ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = "#06120a"; ctx.fillText(text, bx + 7, by + bh / 2 + 1);
    }
  }

  // ---- Lightweight tracker: count each physical item once ------------------
  const iou = (a, b) => {
    const w = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1), h = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
    if (w <= 0 || h <= 0) return 0;
    const i = w * h;
    return i / ((a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - i);
  };
  function updateTracks(dets) {
    const confirmed = [];
    S.tracks.forEach((t) => (t.seen = false));
    for (const d of dets) {
      let best = null, bestIou = IOU_MATCH;
      for (const t of S.tracks) {
        if (t.seen || t.label !== d.label) continue;
        const v = iou(t.box, d.box);
        if (v > bestIou) { bestIou = v; best = t; }
      }
      if (best) {
        Object.assign(best, { box: d.box, missed: 0, seen: true }); best.hits++;
        if (best.hits >= CONFIRM_HITS && !best.counted) { best.counted = true; confirmed.push(d); }
      } else S.tracks.push({ label: d.label, box: d.box, hits: 1, missed: 0, seen: true, counted: false });
    }
    S.tracks.forEach((t) => { if (!t.seen) t.missed++; });
    S.tracks = S.tracks.filter((t) => t.missed <= MAX_MISSED);
    return confirmed;
  }

  function addCounts(items) {
    for (const d of items) {
      const el = $(meta(d.label).counter);
      S.counts[d.label] = (S.counts[d.label] || 0) + 1;
      if (el) { el.textContent = S.counts[d.label]; el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump"); }
    }
    $("count-total").textContent = Object.values(S.counts).reduce((a, b) => a + b, 0);
    if (items.some((d) => meta(d.label).hazard)) alarm();
  }

  // ---- Alerts: flash + chime -----------------------------------------------
  let actx;
  function initAudio() {
    try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === "suspended") actx.resume(); } catch (_) {}
  }
  function chime() {
    if (!$("sound").checked) return;
    initAudio(); if (!actx) return;
    const t = actx.currentTime;
    [988, 740, 988, 740].forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain(), s = t + i * 0.2;
      o.type = "square"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.18, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.18);
      o.connect(g).connect(actx.destination); o.start(s); o.stop(s + 0.2);
    });
  }
  function alarm(force) {
    const now = performance.now();
    if (!force && now - S.lastAlert < ALERT_COOLDOWN) return;
    S.lastAlert = now;
    for (const el of [$("flash"), stage]) {
      el.classList.remove("on", "alert"); void el.offsetWidth; el.classList.add(el === stage ? "alert" : "on");
    }
    chime();
  }

  // ---- Status banner -------------------------------------------------------
  const BANNERS = {
    idle:     ["Standby", "Start the camera or upload a photo to begin sorting.", ""],
    clear:    ["No object in view", "Waiting for the next item on the line.", ""],
    cylinder: ["Cylinder detected", "Classified as a standard cylinder.", META.cylinder.route],
    shock:    ["Shock absorber detected", "Contains high-pressure fluid/spring. Do not crush, cut or puncture.", META["shock absorber"].route],
  };
  function renderBanner() {
    let state, text;
    const now = Date.now();
    const present = (label) => S.mode === "still" ? S.stillDets.some((d) => d.label.toLowerCase() === label)
                                                 : now - (S.lastSeen[label] || 0) < HOLD_MS;
    if (!S.modelOk) { state = "error"; BANNERS.error = ["Model not ready", S.modelMsg || "Cannot reach the detection model.", ""]; }
    else if (S.mode === "idle") state = "idle";
    else if (present("shock absorber")) { state = "shock"; if (present("cylinder")) text = BANNERS.shock[1] + " A cylinder is also in view: separate before routing."; }
    else if (present("cylinder")) state = "cylinder";
    else state = "clear";
    const [title, msg, route] = BANNERS[state];
    const b = $("banner");
    if (b.dataset.state !== state) b.dataset.state = state;
    $("banner-icon").textContent = state === "idle" || state === "clear" ? "i" : "!";
    $("banner-title").textContent = title;
    $("banner-text").textContent = text || msg;
    $("banner-route").textContent = route; $("banner-route").hidden = !route;
  }

  function renderPills() {
    $("pill-model").className = "pill " + (S.modelOk ? "ok" : "bad");
    $("model-text").textContent = S.modelOk ? "Model online" : "Model offline";
  }
  async function pollHealth() {
    try { const h = await (await fetch("/api/health")).json(); S.modelOk = h.model_loaded; S.modelMsg = h.error || ""; }
    catch (_) { S.modelOk = false; S.modelMsg = "Cannot reach the server."; }
    renderPills(); renderBanner();
  }

  // ---- Modes ---------------------------------------------------------------
  function setMode(mode) {
    S.mode = mode; S.token++;
    S.dets = []; S.stillDets = []; S.tracks = []; S.lastSeen = {};
    video.hidden = mode !== "live"; still.hidden = mode !== "still";
    $("stage-empty").hidden = mode !== "idle"; $("live-tag").hidden = mode !== "live";
    $("btn-capture").disabled = mode !== "live";
    $("btn-resume").hidden = mode !== "still";
    $("btn-resume").textContent = S.stream ? "Resume live" : "Clear photo";
    const start = $("btn-start"); start.textContent = S.stream ? "Stop camera" : "Start camera"; start.classList.toggle("stop", !!S.stream);
    if (mode === "idle") fitStage(1280, 720); else draw([]);
    renderBanner();
  }

  async function startCamera() {
    say("");
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      say("Camera access needs HTTPS or http://localhost. Open the app via localhost, enable HTTPS (see README), or use Upload image."); return;
    }
    try {
      S.stream = await navigator.mediaDevices.getUserMedia({ audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } });
    } catch (e) { say(`Could not open the camera (${e.name}). Allow camera permission in the browser and make sure no other app is using it.`); return; }
    video.srcObject = S.stream; video.hidden = false; await video.play();
    if (!video.videoWidth) await new Promise((r) => video.addEventListener("loadedmetadata", r, { once: true }));
    initAudio(); fitStage(video.videoWidth, video.videoHeight);
    setMode("live"); liveLoop(S.token);
  }
  function stopCamera() {
    if (S.stream) S.stream.getTracks().forEach((t) => t.stop());
    S.stream = null; video.srcObject = null; setMode("idle");
  }

  const stamps = [];
  async function liveLoop(token) {
    while (S.mode === "live" && token === S.token) {
      const t0 = performance.now();
      try {
        const res = await detect(await toBlob(video));
        if (S.mode !== "live" || token !== S.token) return;
        const now = Date.now();
        S.dets = res.detections; draw(S.dets); say("");
        res.detections.forEach((d) => (S.lastSeen[d.label.toLowerCase()] = now));
        addCounts(updateTracks(res.detections));
        const dt = performance.now() - t0;
        stamps.push(performance.now()); if (stamps.length > 8) stamps.shift();
        if (stamps.length > 1) $("fps").textContent = ((stamps.length - 1) * 1000 / (stamps[stamps.length - 1] - stamps[0])).toFixed(1);
        $("latency").textContent = Math.round(dt) + " ms";
        if (!S.modelOk) { S.modelOk = true; renderPills(); }
      } catch (e) { say("Detection failed: " + e.message); await sleep(1000); }
      renderBanner();
      await sleep(Math.max(0, MIN_GAP_MS - (performance.now() - t0)));
    }
  }

  // ---- Still photo (captured frame or uploaded file) -----------------------
  async function showStill(blob) {
    S.blob = blob;
    if (S.stillUrl) URL.revokeObjectURL(S.stillUrl);
    S.stillUrl = URL.createObjectURL(blob); still.src = S.stillUrl; await still.decode();
    setMode("still"); fitStage(still.naturalWidth, still.naturalHeight);
    await analyseStill(true);
  }
  async function analyseStill(count) {
    const token = S.token;
    try {
      const t0 = performance.now(), res = await detect(S.blob);
      if (token !== S.token) return;
      S.stillDets = res.detections; draw(S.stillDets); say(res.detections.length ? "" : "No cylinder or shock absorber found at this confidence level.");
      $("latency").textContent = Math.round(performance.now() - t0) + " ms";
      if (count) addCounts(res.detections);
    } catch (e) { say("Detection failed: " + e.message); }
    renderBanner();
  }

  // ---- Wire up UI ----------------------------------------------------------
  $("btn-start").onclick = () => (S.stream ? stopCamera() : startCamera());
  $("btn-capture").onclick = async () => { initAudio(); await showStill(await toBlob(video)); };
  $("btn-resume").onclick = () => { if (S.stream) { setMode("live"); liveLoop(S.token); } else setMode("idle"); };
  $("file-input").onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    try { initAudio(); await showStill(await toBlob(await createImageBitmap(f))); }
    catch (_) { say("Could not read that image file."); }
  };
  $("conf").oninput = (e) => ($("conf-val").textContent = Math.round(e.target.value * 100) + "%");
  $("conf").onchange = () => { if (S.mode === "still") analyseStill(false); };
  $("btn-test").onclick = () => alarm(true);
  $("btn-reset").onclick = () => {
    S.counts = {}; S.tracks = []; S.sessionStart = Date.now();
    ["count-shock", "count-cyl", "count-total"].forEach((id) => ($(id).textContent = "0"));
  };
  window.addEventListener("resize", () => fitStage(S.srcW, S.srcH));
  setInterval(() => {
    const s = Math.floor((Date.now() - S.sessionStart) / 1000), p = (n) => String(n).padStart(2, "0");
    $("session-time").textContent = `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`;
    if (S.mode === "live") renderBanner();
  }, 500);
  setInterval(pollHealth, 10000);

  setMode("idle"); pollHealth();
})();
