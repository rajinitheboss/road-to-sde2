// 3D model of the 60 days: 9 weeks (rows) × 7 days (columns), one block per day.
// Block height and colour show how much of that day is done. Drag to rotate; tap a block to open the day.
// Uses Three.js r128 (loaded from cdnjs). Falls back to a flat 2D grid when WebGL isn't available,
// and stops all motion when the device asks for reduced motion.
const Scene3D = (() => {
  const COLS = 7, ROWS = 9, GAP = 1.18, SIZE = 0.92;
  const reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  let host, tipEl, renderer, scene, camera, group, base, cubes = [], data = [], onPick = null, getTip = null;
  let active = false, inView = true, raf = 0, t0 = performance.now(), introStart = 0, fallback = null;
  let userRot = 0, userTilt = 0, drag = null, needsRender = true;
  const ray = window.THREE ? new THREE.Raycaster() : null, ptr = window.THREE ? new THREE.Vector2() : null;

  function cssColor(name) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return window.THREE ? new THREE.Color(v || "#888888") : v;
  }

  function mount(el, tip, pickCb, tipCb) {
    host = el; tipEl = tip; onPick = pickCb; getTip = tipCb;
    if (!window.THREE) return useFallback();
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    } catch (e) { return useFallback(); }
    if (!renderer.getContext()) return useFallback();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    host.prepend(renderer.domElement);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(34, 1, 0.1, 200);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 0.85));
    const key = new THREE.DirectionalLight(0xffffff, 0.85); key.position.set(6, 12, 8); scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.35); rim.position.set(-8, 5, -6); scene.add(rim);

    group = new THREE.Group(); scene.add(group);
    const plateGeo = new THREE.BoxGeometry(COLS * GAP + 0.5, 0.18, ROWS * GAP + 0.5);
    base = new THREE.Mesh(plateGeo, new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, transparent: true, opacity: 0.55 }));
    base.position.y = -0.09; group.add(base);

    const geo = new THREE.BoxGeometry(SIZE, 1, SIZE); geo.translate(0, 0.5, 0); // grow upward from the plate
    const edgeGeo = new THREE.EdgesGeometry(geo);
    for (let i = 0; i < ROWS * COLS; i++) {
      const n = i + 1;
      const r = Math.floor(i / COLS), c = i % COLS;
      if (n > 60) { cubes.push(null); continue; }
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.38, metalness: 0.08, transparent: true, opacity: 1 });
      const m = new THREE.Mesh(geo, mat);
      m.position.set((c - (COLS - 1) / 2) * GAP, 0, (r - (ROWS - 1) / 2) * GAP);
      m.scale.y = reduced ? 0.22 : 0.001;
      m.userData = { n, h: 0.22, target: 0.22, state: "future" };
      const edges = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ transparent: true, opacity: 0.18 }));
      m.add(edges); m.userData.edges = edges;
      group.add(m); cubes.push(m);
    }
    applyColors();
    resize();
    new ResizeObserver(resize).observe(host);
    if ("IntersectionObserver" in window) new IntersectionObserver(e => { inView = e[0].isIntersecting; loop(); }).observe(host);
    document.addEventListener("visibilitychange", loop);
    bindPointer();
    introStart = performance.now();
  }

  function useFallback() {
    fallback = document.createElement("div"); fallback.className = "grid2d";
    for (let n = 1; n <= 60; n++) { const i = document.createElement("i"); i.title = "Day " + n; fallback.appendChild(i); }
    host.prepend(fallback);
    const hint = host.querySelector(".hint"); if (hint) hint.remove();
    host.style.cursor = "default";
    setData(data);
  }

  function applyColors() {
    if (!scene) return;
    const C = {
      done: cssColor("--primary"), today: cssColor("--tertiary"), miss: cssColor("--error"),
      future: cssColor("--surface-lowest"), base: cssColor("--surface-low"), edge: cssColor("--on-primary-container"),
    };
    base.material.color.copy(C.base);
    cubes.forEach(m => {
      if (!m) return;
      const s = m.userData.state, f = m.userData.frac || 0;
      let col;
      if (s === "done") col = C.done.clone();
      else if (s === "today") col = C.today.clone();
      else if (s === "miss") col = C.miss.clone().lerp(C.future, 0.35);
      else if (s === "part") col = C.future.clone().lerp(C.done, 0.35 + 0.45 * f);
      else col = C.future.clone();
      m.material.color.copy(col);
      m.material.opacity = s === "future" ? 0.72 : 1;
      m.material.emissive = s === "today" ? C.today.clone().multiplyScalar(0.25) : new THREE.Color(0x000000);
      m.userData.edges.material.color.copy(C.edge);
    });
    needsRender = true; loop();
  }

  // items: [{n, state: done|part|today|miss|future, frac: 0..1}]
  function setData(items) {
    data = items || [];
    if (fallback) {
      const cells = fallback.children;
      data.forEach(d => { const el = cells[d.n - 1]; if (el) el.className = d.state; });
      return;
    }
    if (!scene) return;
    data.forEach(d => {
      const m = cubes[d.n - 1]; if (!m) return;
      const old = m.userData.state;
      m.userData.state = d.state; m.userData.frac = d.frac;
      let h = 0.22;
      if (d.state === "done") h = 2.0;
      else if (d.state === "part") h = 0.35 + 1.4 * d.frac;
      else if (d.state === "today") h = Math.max(0.6, 0.35 + 1.4 * d.frac);
      m.userData.target = h;
      if (reduced) m.scale.y = h;
      if (old !== d.state && d.state === "done" && !reduced && introStart && performance.now() - introStart > 2500) m.userData.bounce = performance.now();
    });
    applyColors();
  }

  function resize() {
    if (!renderer) return;
    const w = host.clientWidth || 1, h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const dist = 23 * Math.max(1, 1.25 / camera.aspect);
    camera.position.set(0, dist * 0.62, dist * 0.78);
    camera.lookAt(0, 0.9, 0);
    camera.updateProjectionMatrix();
    needsRender = true; loop();
  }

  function bindPointer() {
    const el = renderer.domElement;
    el.addEventListener("pointerdown", e => { drag = { x: e.clientX, y: e.clientY, rot: userRot, tilt: userTilt, moved: false }; el.setPointerCapture(e.pointerId); });
    el.addEventListener("pointermove", e => {
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
        userRot = drag.rot + dx * 0.008;
        userTilt = Math.max(-0.25, Math.min(0.35, drag.tilt + dy * 0.004));
        needsRender = true; loop(); hideTip();
      } else if (e.pointerType === "mouse") hover(e);
    });
    el.addEventListener("pointerup", e => { if (drag && !drag.moved) { const m = pick(e); if (m && onPick) onPick(m.userData.n); } drag = null; });
    el.addEventListener("pointercancel", () => { drag = null; });
    el.addEventListener("pointerleave", hideTip);
  }
  function pick(e) {
    const r = renderer.domElement.getBoundingClientRect();
    ptr.x = ((e.clientX - r.left) / r.width) * 2 - 1; ptr.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects(cubes.filter(Boolean), false)[0];
    return hit ? hit.object : null;
  }
  function hover(e) {
    const m = pick(e);
    if (!m) return hideTip();
    const r = host.getBoundingClientRect();
    tipEl.textContent = getTip ? getTip(m.userData.n) : "Day " + m.userData.n;
    tipEl.style.left = (e.clientX - r.left) + "px"; tipEl.style.top = (e.clientY - r.top) + "px";
    tipEl.classList.add("show"); host.style.cursor = "pointer";
  }
  function hideTip() { if (tipEl) tipEl.classList.remove("show"); if (host && !fallback) host.style.cursor = ""; }

  function frame(now) {
    raf = 0;
    const t = (now - t0) / 1000;
    let animating = false;
    cubes.forEach((m, i) => {
      if (!m) return;
      const delay = reduced ? 0 : i * 0.018;
      const since = (now - introStart) / 1000 - delay;
      if (since < 0) { animating = true; return; }
      const cur = m.scale.y, tgt = m.userData.target;
      if (Math.abs(cur - tgt) > 0.002) { m.scale.y = cur + (tgt - cur) * 0.12; animating = true; }
      else m.scale.y = tgt;
      if (m.userData.bounce) {
        const b = (now - m.userData.bounce) / 1000;
        if (b < 0.8) { m.position.y = Math.sin(b * Math.PI / 0.8) * 0.9; animating = true; } else { m.position.y = 0; m.userData.bounce = 0; }
      }
      if (m.userData.state === "today" && !reduced) {
        m.material.emissiveIntensity = 0.6 + 0.6 * Math.sin(t * 3); animating = true;
      }
    });
    const auto = reduced ? 0 : Math.sin(t * 0.22) * 0.32;
    group.rotation.y = -0.45 + userRot + auto;
    group.rotation.x = userTilt;
    renderer.render(scene, camera);
    needsRender = false;
    if (!reduced || animating) loop();
  }
  function loop() {
    if (!renderer || raf) return;
    const visible = active && inView && document.visibilityState !== "hidden";
    if (!visible) return;
    if (reduced && !needsRender && !drag) {
      // reduced motion: draw only when something changed
      let pending = cubes.some(m => m && (Math.abs(m.scale.y - m.userData.target) > 0.002));
      if (!pending) return;
    }
    raf = requestAnimationFrame(frame);
  }
  function setActive(on) { active = on; if (on) { needsRender = true; resize(); loop(); } }

  return { mount, setData, setActive, refreshColors: applyColors };
})();
