/*
 * App controller: holds the state, wires the UI panels to the RF engine,
 * the map, the drive test and the "Fix the Network" cases.
 */
(function () {
  'use strict';

  const { W, H } = NET.WORLD;
  const RES = 20; // metres per map pixel cell
  const $ = (id) => document.getElementById(id);
  const fmt = (v, d) => (Number.isFinite(v) ? v.toFixed(d === undefined ? 1 : d) : '-');
  const esc = (t) => String(t).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  const S = {
    tab: 'planner', layer: 'rsrp',
    sites: NET.defaultSites(), env: NET.defaultEnv(),
    selected: 'A', addMode: false,
    ctx: null, grid: null, stats: null, pci: null,
    zone: null, scenarioId: null, reveal: { hints: 0, solution: false, interview: false }, solved: {}, goalPass: false,
    routeKey: 'loop', route: NET.ROUTES.loop.pts, customRoute: null, drawing: false, draft: [],
    sim: null, running: false, hover: null, dragging: null,
  };

  const map = new MAP.MapView($('map'), $('mapWrap'), S);

  /* ================= Recompute ================= */

  let pending = false;
  function scheduleRecompute() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; recompute(); });
  }

  function recompute() {
    S.ctx = RF.prepare({ sites: S.sites }, S.env);
    S.grid = RF.computeGrid(S.ctx, W, H, RES);
    S.stats = RF.areaStats(S.grid);
    S.pci = RF.pciIssues(S.ctx, S.grid);
    map.updateHeat(S.grid, S.layer, S.ctx);
    renderKpis();
    renderLegend();
    renderEditorWarnings();
    if (S.scenarioId) renderGoal();
    refreshHover();
    if (S.sim) resetDrive('Network changed, drive test reset.');
  }

  /* ================= KPIs + legend ================= */

  function kpi(label, value, sub, cls) {
    return '<div class="kpi ' + (cls || '') + '"><div class="k-label">' + label + '</div><div class="k-val">' + value + '</div>' +
      (sub ? '<div class="k-sub">' + sub + '</div>' : '') + '</div>';
  }

  function renderKpis() {
    const st = S.stats, p = S.pci;
    const band = RF.BANDS[S.env.band];
    $('kpis').innerHTML =
      kpi('Coverage (RSRP >= -100)', fmt(st.cov100, 0) + '%', 'of the city area', st.cov100 >= 90 ? 'good' : st.cov100 >= 75 ? 'warn' : 'bad') +
      kpi('Average RSRP', fmt(st.avgRsrp) + ' dBm', 'signal strength') +
      kpi('Average SINR', fmt(st.avgSinr) + ' dB', 'signal quality', st.avgSinr >= 8 ? 'good' : st.avgSinr >= 4 ? 'warn' : 'bad') +
      kpi('Bad quality area', fmt(st.badSinr) + '%', 'SINR below 0 dB', st.badSinr <= 8 ? 'good' : st.badSinr <= 15 ? 'warn' : 'bad') +
      kpi('Pilot pollution', fmt(st.polluted) + '%', '4+ cells within 5 dB', st.polluted <= 2 ? 'good' : st.polluted <= 6 ? 'warn' : 'bad') +
      kpi('PCI problems', p.collisions.length + ' / ' + p.mod3.length, 'collisions / mod-3 clashes', p.collisions.length ? 'bad' : p.mod3.length ? 'warn' : 'good') +
      kpi('Avg throughput', fmt(st.avgThr, 0) + ' Mbps', band.tech + ', ' + band.bw + ' MHz');
  }

  const LAYER_INFO = {
    rsrp: { title: 'RSRP: signal strength', kind: 'rsrp', text: 'How strong the signal from the best tower is at each point. It falls with distance (path loss), with the angle away from the antenna beam, and behind buildings.', say: 'RSRP shows coverage. Red areas are coverage holes.' },
    sinr: { title: 'SINR: signal quality', kind: 'sinr', text: 'Wanted signal divided by interference from all other cells plus noise. Low SINR near cell borders is normal. Low SINR everywhere means too much overlap.', say: 'Good RSRP but bad SINR means an interference problem, not a coverage problem.' },
    rsrq: { title: 'RSRQ: received quality', kind: 'rsrq', text: 'RSRP divided by the total received power (RSSI). It gets worse when the cells are loaded or when many cells overlap. Try changing the network load.', say: 'RSRQ includes load and interference, so it is often used for handover.' },
    thr: { title: 'Throughput estimate', kind: 'thr', text: 'Download speed a single user could get. It is calculated from SINR (Shannon formula, 60% efficiency), bandwidth and 2x2 MIMO.', say: 'Throughput depends on SINR, bandwidth and the number of MIMO layers.' },
    best: { title: 'Best server', kind: null, text: 'Each colour is one sector: same colour family = same tower, lighter or darker = sector 1, 2 or 3. A clean plot has one solid patch per sector. Islands of a colour far from its tower mean overshooting.', say: 'The best-server plot shows the dominance area of each cell.' },
    pollution: { title: 'Pilot pollution', kind: null, text: 'How many cells are within 5 dB of the strongest one. Purple means 4 or more cells are almost equal, so no cell dominates and the phone suffers.', say: 'Pilot pollution: too many equal cells. Fix it by making one cell dominant.' },
  };

  function renderLegend() {
    const info = LAYER_INFO[S.layer];
    let html = '<span class="title">' + info.title + '</span>';
    if (info.kind) {
      RF.CLASSES[info.kind].forEach((c) => {
        html += '<span><i style="background:' + c.color + '"></i>' + c.label + ' (' + c.range + ')</span>';
      });
    } else if (S.layer === 'best') {
      S.sites.forEach((s, si) => { html += '<span><i style="background:' + MAP.siteColor(si) + '"></i>Site ' + esc(s.id) + '</span>'; });
    } else {
      html += '<span><i style="background:#c51b7d"></i>4+ cells (polluted)</span><span><i style="background:#de77ae"></i>3 cells</span><span><i style="background:#4a5e74"></i>2 cells</span><span><i style="background:#2c3c4e"></i>1 dominant cell</span>';
    }
    $('legend').innerHTML = html;
    $('layerHelp').innerHTML = '<h3>What am I looking at?</h3><p>' + info.text + '</p><div class="tip"><b>Say it in the interview:</b> ' + info.say + '</div>';
  }

  function setLayer(layer) {
    S.layer = layer;
    document.querySelectorAll('#layerSeg button').forEach((b) => b.classList.toggle('active', b.dataset.layer === layer));
    if (S.grid) map.updateHeat(S.grid, S.layer, S.ctx);
    renderLegend();
  }

  /* ================= Hover: the heart, explained ================= */

  function refreshHover() {
    const card = $('hoverCard');
    if (!S.hover || !S.ctx || S.ctx.n === 0 || S.dragging) { card.hidden = true; map.dirty = true; return; }
    const { x, y } = S.hover;
    const m = RF.evaluatePoint(S.ctx, x, y);
    if (!m) { card.hidden = true; return; }
    const sec = S.ctx.sectors[m.serv];
    const bd = RF.sectorBreakdown(S.ctx, sec, x, y);
    S.hover.m = m;
    const cls = RF.classify('rsrp', m.rsrp);
    const band = S.ctx.band;
    const row = (name, why, val, sign) => '<tr><td>' + name + (why ? '<div class="why">' + why + '</div>' : '') + '</td><td class="' + (sign || '') + '">' + val + '</td></tr>';
    const signed = (v) => (v >= 0 ? '-' + fmt(v) : '+' + fmt(-v)) + ' dB';
    const others = Array.from(m.rs.keys()).filter((i) => i !== m.serv).sort((a, b) => m.rs[b] - m.rs[a]).slice(0, 3)
      .map((i) => esc(S.ctx.sectors[i].label) + ' ' + fmt(m.rs[i]));
    const sinrCls = RF.classify('sinr', m.sinr);
    card.innerHTML =
      '<h4>Signal at this point</h4>' +
      '<div class="muted" style="margin-bottom:6px">Best cell <b style="color:#fff">' + esc(sec.label) + '</b> (PCI ' + sec.pci + ') on Site ' + esc(sec.site.id) + ', ' + fmt(bd.distance / 1000, 2) + ' km away</div>' +
      '<table class="calc-table">' +
      row('Tower power', '', fmt(bd.txPower) + ' dBm') +
      row('Shared over ' + 12 * band.nRB + ' subcarriers', 'RSRP is per subcarrier', '-' + fmt(bd.perRe) + ' dB', 'minus') +
      row('Antenna gain', '', '+' + fmt(bd.gain) + ' dB', 'plus') +
      row('Direction loss', fmt(Math.abs(bd.phi), 0) + ' deg to the side, ' + fmt(bd.elev) + ' deg down (beam ' + fmt(sec.tilt) + ' deg down)', '-' + fmt(bd.antLoss) + ' dB', 'minus') +
      row('Cable loss', '', '-' + fmt(bd.cable) + ' dB', 'minus') +
      row('Path loss', fmt(bd.distance / 1000, 2) + ' km at ' + band.freq + ' MHz, ' + S.ctx.envDef.label, '-' + fmt(bd.pathLoss) + ' dB', 'minus') +
      (S.env.shadowing ? row('Buildings (shadowing)', bd.shadow >= 0 ? 'blocked by buildings here' : 'open street, clearer path than average', signed(bd.shadow), bd.shadow >= 0 ? 'minus' : 'plus') : '') +
      (S.env.indoor ? row('Walls (indoor user)', '', '-' + fmt(bd.indoor) + ' dB', 'minus') : '') +
      '<tr class="total"><td>RSRP</td><td>' + fmt(m.rsrp) + ' dBm <span class="pill" style="background:' + cls.color + '">' + cls.label + '</span></td></tr>' +
      '</table>' +
      '<div class="hc-metrics">' +
      '<div><span>SINR</span><b style="color:' + sinrCls.color + '">' + fmt(m.sinr) + ' dB</b></div>' +
      '<div><span>RSRQ</span><b>' + fmt(m.rsrq) + ' dB</b></div>' +
      '<div><span>' + m.modulation + '</span><b>' + fmt(m.throughput, 0) + ' Mbps</b></div>' +
      '</div>' +
      '<div class="hc-next">Interfering cells: ' + (others.join(', ') || 'none') + (m.near >= 4 ? ' <b style="color:#ff7ac0">(pilot pollution)</b>' : '') + '</div>';
    card.hidden = false;
    // Keep the card inside the map
    const wr = $('mapWrap').getBoundingClientRect();
    const px = x * map.s, py = y * map.s;
    const cw = card.offsetWidth, ch = card.offsetHeight;
    let left = px + 18, top = py + 18;
    if (left + cw > wr.width - 4) left = px - cw - 18;
    // Prefer staying inside the map; if the card is taller than the map, let it hang below
    if (top + ch > wr.height - 4) top = ch > wr.height ? 4 : Math.max(4, py - ch - 18);
    card.style.left = Math.max(4, left) + 'px';
    card.style.top = top + 'px';
    map.dirty = true;
  }

  /* ================= Map interaction ================= */

  const canvas = $('map');

  function localPos(e) {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  canvas.addEventListener('pointerdown', (e) => {
    const [px, py] = localPos(e);
    const [x, y] = map.toWorld(px, py);
    if (S.tab === 'planner' && S.addMode) { addSite(x, y); return; }
    if (S.tab === 'drive' && S.drawing) {
      S.draft.push([Math.round(x), Math.round(y)]);
      $('finishRouteBtn').disabled = S.draft.length < 2;
      map.dirty = true;
      return;
    }
    const site = map.siteAt(px, py);
    if (site && S.tab !== 'drive') {
      selectSite(site.id);
      if (S.tab === 'planner') {
        S.dragging = { id: site.id, dx: site.x - x, dy: site.y - y };
        canvas.classList.add('dragging');
        canvas.setPointerCapture(e.pointerId);
        refreshHover();
      }
      return;
    }
    // A tap (touch screens have no hover) shows the calculation for that point
    S.hover = { x, y };
    refreshHover();
  });

  canvas.addEventListener('pointermove', (e) => {
    const [px, py] = localPos(e);
    const [x, y] = map.toWorld(px, py);
    if (S.dragging) {
      const site = S.sites.find((s) => s.id === S.dragging.id);
      site.x = Math.round(Math.min(Math.max(x + S.dragging.dx, 20), W - 20));
      site.y = Math.round(Math.min(Math.max(y + S.dragging.dy, 20), H - 20));
      map.dirty = true;
      scheduleRecompute();
      return;
    }
    canvas.classList.toggle('over-site', S.tab !== 'drive' && !S.addMode && !!map.siteAt(px, py));
    S.hover = { x, y };
    refreshHover();
  });

  const endDrag = () => {
    if (!S.dragging) return;
    S.dragging = null;
    canvas.classList.remove('dragging');
    refreshHover();
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', () => { if (!S.dragging) { S.hover = null; refreshHover(); } });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (S.addMode) setAddMode(false);
    if (S.drawing) { S.drawing = false; S.draft = []; syncDriveButtons(); map.dirty = true; }
  });

  /* ================= Sites ================= */

  function selectSite(id) {
    S.selected = id;
    renderChips();
    renderEditor();
    map.dirty = true;
  }

  function nextSiteId() {
    const used = new Set(S.sites.map((s) => s.id));
    for (let c = 65; c <= 90; c++) if (!used.has(String.fromCharCode(c))) return String.fromCharCode(c);
    return 'S' + (S.sites.length + 1);
  }

  function freePcis() {
    const used = new Set();
    S.sites.forEach((s) => s.sectors.forEach((x) => used.add(x.pci)));
    for (let g = 1; g < 168; g++) {
      const p = [g * 3, g * 3 + 1, g * 3 + 2];
      if (p.every((v) => !used.has(v))) return p;
    }
    return [0, 1, 2];
  }

  function addSite(x, y) {
    const id = nextSiteId();
    const site = NET.makeSite(id, 'New tower ' + id, Math.round(x), Math.round(y), { pcis: freePcis(), seed: 500 + Math.floor(Math.random() * 10000) });
    S.sites.push(site);
    setAddMode(false);
    selectSite(id);
    scheduleRecompute();
  }

  function setAddMode(on) {
    S.addMode = on;
    $('addSiteBtn').classList.toggle('active', on);
    $('addSiteBtn').textContent = on ? 'Click on the map...' : '+ Add tower';
    updateHint();
  }

  function renderChips() {
    const el = $('siteChips');
    el.innerHTML = '';
    S.sites.forEach((s, si) => {
      const b = document.createElement('button');
      b.className = 'chip' + (S.selected === s.id ? ' active' : '');
      b.innerHTML = '<span class="dot" style="background:' + MAP.siteColor(si) + '"></span><span></span>';
      b.lastChild.textContent = s.name;
      b.firstChild.textContent = s.id;
      b.addEventListener('click', () => selectSite(s.id));
      el.appendChild(b);
    });
    $('delSiteBtn').disabled = !S.selected;
  }

  $('addSiteBtn').addEventListener('click', () => setAddMode(!S.addMode));
  $('delSiteBtn').addEventListener('click', () => {
    if (!S.selected) return;
    S.sites = S.sites.filter((s) => s.id !== S.selected);
    S.selected = S.sites.length ? S.sites[0].id : null;
    renderChips(); renderEditor(); scheduleRecompute();
  });
  $('resetCityBtn').addEventListener('click', () => resetCity());

  function resetCity() {
    S.sites = NET.defaultSites();
    S.env = NET.defaultEnv();
    S.scenarioId = null;
    S.zone = null;
    S.selected = 'A';
    syncEnvControls();
    renderChips(); renderEditor(); renderScenarioList(); renderBanner();
    $('scenarioCard').hidden = true;
    rebuildRouteOptions();
    recompute();
    updateHint();
  }

  /* ================= Site editor ================= */

  function activeSlot() {
    const g = document.querySelector('.panel-group[data-for="' + S.tab + '"]');
    return g ? g.querySelector('.editor-slot') : null;
  }

  function renderEditor() {
    document.querySelectorAll('.editor-slot').forEach((s) => { s.innerHTML = ''; });
    const slot = activeSlot();
    if (!slot) return;
    const si = S.sites.findIndex((s) => s.id === S.selected);
    if (si < 0) {
      slot.innerHTML = '<h3>Tower editor</h3><p class="muted">Click a tower on the map to see and change its antennas.</p>';
      return;
    }
    const site = S.sites[si];
    slot.appendChild($('editorTpl').content.cloneNode(true));
    slot.querySelector('.ed-title').textContent = 'Site ' + site.id + ': ' + site.name;
    const name = slot.querySelector('.ed-name');
    name.value = site.name;
    name.addEventListener('input', () => {
      site.name = name.value || site.id;
      slot.querySelector('.ed-title').textContent = 'Site ' + site.id + ': ' + site.name;
      renderChips();
    });
    const hr = slot.querySelector('.ed-height'), hv = slot.querySelector('.ed-hval');
    hr.value = site.height; hv.textContent = site.height + ' m';
    hr.addEventListener('input', () => { site.height = +hr.value; hv.textContent = site.height + ' m'; scheduleRecompute(); });

    const list = slot.querySelector('.sectors');
    site.sectors.forEach((sec, k) => {
      const box = document.createElement('div');
      box.className = 'sector' + (sec.on ? '' : ' off');
      box.innerHTML =
        '<div class="sector-head"><span class="name"><i style="background:' + MAP.sectorColor(si, k) + '"></i>Sector ' + esc(site.id) + (k + 1) + '</span>' +
        '<label class="check small"><input type="checkbox" class="on"' + (sec.on ? ' checked' : '') + '> on air</label></div>' +
        slider('Azimuth', 'azimuth', 0, 359, 1, sec.azimuth, ' deg') +
        slider('Tilt', 'tilt', 0, 15, 0.5, sec.tilt, ' deg') +
        slider('Power', 'power', 30, 49, 1, sec.power, ' dBm') +
        '<div class="srow"><span>PCI</span><input type="number" class="pci" min="0" max="503" value="' + sec.pci + '"><output>mod3 = ' + (sec.pci % 3) + '</output></div>' +
        '<div class="pci-warn" data-sec="' + k + '"></div>';
      box.querySelector('.on').addEventListener('change', (e) => {
        sec.on = e.target.checked; box.classList.toggle('off', !sec.on); map.dirty = true; scheduleRecompute();
      });
      box.querySelectorAll('input[type=range]').forEach((r) => {
        r.addEventListener('input', () => {
          sec[r.dataset.key] = +r.value;
          r.parentElement.querySelector('output').textContent = r.value + r.dataset.unit;
          map.dirty = true;
          scheduleRecompute();
        });
      });
      const pci = box.querySelector('.pci');
      pci.addEventListener('input', () => {
        const v = Math.round(+pci.value);
        if (!Number.isFinite(v) || v < 0 || v > 503) return;
        sec.pci = v;
        pci.parentElement.querySelector('output').textContent = 'mod3 = ' + (v % 3);
        scheduleRecompute();
      });
      list.appendChild(box);
    });
    renderEditorWarnings();
  }

  function slider(label, key, min, max, step, val, unit) {
    return '<div class="srow"><span>' + label + '</span><input type="range" data-key="' + key + '" data-unit="' + unit + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '"><output>' + val + unit + '</output></div>';
  }

  function renderEditorWarnings() {
    const slot = activeSlot();
    if (!slot || !S.ctx || !S.pci) return;
    slot.querySelectorAll('.pci-warn').forEach((el) => {
      const k = +el.dataset.sec;
      const idx = S.ctx.sectors.findIndex((s) => s.site.id === S.selected && s.k === k);
      const msgs = [];
      if (idx >= 0) {
        S.pci.collisions.forEach(([a, b]) => {
          if (a === idx || b === idx) msgs.push('PCI collision with ' + S.ctx.sectors[a === idx ? b : a].label);
        });
        S.pci.mod3.forEach(([a, b]) => {
          if (a === idx || b === idx) msgs.push('same PCI mod 3 as neighbour ' + S.ctx.sectors[a === idx ? b : a].label);
        });
      }
      el.textContent = msgs.length ? 'Warning: ' + msgs.join(', ') : '';
    });
  }

  /* ================= Network settings ================= */

  function initEnvControls() {
    const bs = $('bandSel');
    Object.values(RF.BANDS).forEach((b) => bs.add(new Option(b.label + ' (' + b.tech + ', ' + b.bw + ' MHz)', b.id)));
    const es = $('envSel');
    Object.entries(RF.ENVIRONMENTS).forEach(([k, e]) => es.add(new Option(e.label, k)));
    bs.addEventListener('change', () => { S.env.band = bs.value; scheduleRecompute(); });
    es.addEventListener('change', () => { S.env.environment = es.value; scheduleRecompute(); });
    $('loadRange').addEventListener('input', (e) => { S.env.load = +e.target.value; $('loadVal').textContent = S.env.load + '%'; scheduleRecompute(); });
    $('shadowChk').addEventListener('change', (e) => { S.env.shadowing = e.target.checked; scheduleRecompute(); });
    $('indoorChk').addEventListener('change', (e) => { S.env.indoor = e.target.checked; scheduleRecompute(); });
    syncEnvControls();
  }

  function syncEnvControls() {
    $('bandSel').value = S.env.band;
    $('envSel').value = S.env.environment;
    $('loadRange').value = S.env.load;
    $('loadVal').textContent = S.env.load + '%';
    $('shadowChk').checked = S.env.shadowing;
    $('indoorChk').checked = S.env.indoor;
  }

  /* ================= Tabs ================= */

  function switchTab(tab) {
    if (S.tab === 'drive' && tab !== 'drive') pauseDrive();
    if (S.addMode) setAddMode(false);
    if (S.drawing) { S.drawing = false; S.draft = []; syncDriveButtons(); }
    S.tab = tab;
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    const isMap = tab === 'planner' || tab === 'drive' || tab === 'fix';
    $('mapView').hidden = !isMap;
    $('calcView').hidden = tab !== 'calc';
    $('learnView').hidden = tab !== 'learn';
    if (tab === 'calc' && !$('calcView').childElementCount) TOOLS.renderCalcs($('calcView'));
    if (tab === 'learn' && !$('learnView').childElementCount) TOOLS.renderLearn($('learnView'));
    document.querySelectorAll('.panel-group').forEach((g) => { g.hidden = g.dataset.for !== tab; });
    $('chartCard').hidden = tab !== 'drive';
    if (isMap) {
      renderEditor();
      renderBanner();
      updateHint();
      if (tab === 'drive') { renderLive(); drawChart(); }
      map.resize();
    }
  }

  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  document.querySelectorAll('#layerSeg button').forEach((b) => b.addEventListener('click', () => setLayer(b.dataset.layer)));

  function updateHint() {
    let t = '';
    if (S.tab === 'planner') t = S.addMode ? 'Click on the map to place the new tower (Esc to cancel)' : 'Hover = see the calculation. Drag a tower to move it.';
    else if (S.tab === 'drive') t = S.drawing ? 'Click on the map to add route points, then press "Finish route"' : (S.sim ? '' : 'Choose a route and press "Start drive"');
    else if (S.tab === 'fix') t = S.scenarioId ? 'Hover to investigate. Click a tower to change its antennas.' : 'Pick a customer complaint on the right';
    $('mapHint').textContent = t;
  }

  function renderBanner() {
    const b = $('banner');
    const sc = S.scenarioId && SC.SCENARIOS.find((x) => x.id === S.scenarioId);
    if (!sc || S.tab === 'fix') { b.hidden = true; return; }
    b.hidden = false;
    b.innerHTML = '<span>You are using the network from the case <b></b>.</span><button class="btn ghost">Back to the healthy city</button>';
    b.querySelector('b').textContent = sc.title;
    b.querySelector('button').addEventListener('click', resetCity);
  }

  /* ================= Drive test ================= */

  function rebuildRouteOptions() {
    const sel = $('routeSel');
    sel.innerHTML = '';
    const sc = S.scenarioId && SC.SCENARIOS.find((x) => x.id === S.scenarioId);
    if (sc && sc.route) sel.add(new Option('Problem area route (' + sc.title + ')', 'scenario'));
    Object.entries(NET.ROUTES).forEach(([k, r]) => sel.add(new Option(r.name, k)));
    if (S.customRoute) sel.add(new Option('My route', 'custom'));
    if (![...sel.options].some((o) => o.value === S.routeKey)) S.routeKey = sc && sc.route ? 'scenario' : 'loop';
    sel.value = S.routeKey;
    S.route = routePts(S.routeKey);
  }

  function routePts(key) {
    if (key === 'custom') return S.customRoute;
    if (key === 'scenario') return SC.SCENARIOS.find((x) => x.id === S.scenarioId).route;
    return NET.ROUTES[key].pts;
  }

  $('routeSel').addEventListener('change', (e) => {
    S.routeKey = e.target.value;
    S.route = routePts(S.routeKey);
    resetDrive();
  });

  $('drawRouteBtn').addEventListener('click', () => {
    pauseDrive();
    S.drawing = true;
    S.draft = [];
    syncDriveButtons();
    map.dirty = true;
  });

  $('finishRouteBtn').addEventListener('click', () => {
    if (S.draft.length >= 2) {
      S.customRoute = S.draft.slice();
      S.routeKey = 'custom';
      rebuildRouteOptions();
    }
    S.drawing = false;
    S.draft = [];
    syncDriveButtons();
    resetDrive();
  });

  function syncDriveButtons() {
    $('drawRouteBtn').hidden = S.drawing;
    $('finishRouteBtn').hidden = !S.drawing;
    $('finishRouteBtn').disabled = S.draft.length < 2;
    $('playBtn').disabled = S.drawing;
    const label = !S.sim ? 'Start drive' : S.sim.done ? 'Drive again' : S.running ? 'Pause' : 'Resume';
    $('playBtn').textContent = label;
    $('csvBtn').disabled = !S.sim || !S.sim.samples.length;
    updateHint();
  }

  let lastFrame = 0, acc = 0, renderedEvents = 0;

  $('playBtn').addEventListener('click', () => {
    if (!S.sim || S.sim.done) {
      S.sim = new DRIVE.DriveSim(S.ctx, S.route, +$('ueSpeedSel').value);
      renderedEvents = 0;
      $('events').innerHTML = '';
      $('driveSummary').hidden = true;
      S.running = true;
    } else {
      S.running = !S.running;
    }
    lastFrame = performance.now();
    acc = 0;
    syncDriveButtons();
    if (S.running) requestAnimationFrame(tick);
  });

  $('resetDriveBtn').addEventListener('click', () => resetDrive());
  $('ueSpeedSel').addEventListener('change', () => resetDrive());

  $('csvBtn').addEventListener('click', () => {
    if (!S.sim) return;
    const blob = new Blob([S.sim.toCSV()], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'cellsim_drive_log.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  });

  function pauseDrive() {
    if (S.running) { S.running = false; syncDriveButtons(); }
  }

  function resetDrive(note) {
    S.sim = null;
    S.running = false;
    renderedEvents = 0;
    $('events').innerHTML = '<li class="muted">' + esc(note || 'Start the drive to see handovers and drops.') + '</li>';
    $('driveSummary').hidden = true;
    $('progressBar').style.width = '0%';
    syncDriveButtons();
    renderLive();
    drawChart();
    map.dirty = true;
  }

  function tick(now) {
    if (!S.running || !S.sim) return;
    const realDt = Math.min((now - lastFrame) / 1000, 0.1);
    lastFrame = now;
    acc += realDt * +$('simSpeedSel').value;
    let steps = 0;
    while (acc >= 0.1 && !S.sim.done && steps < 400) { S.sim.step(0.1); acc -= 0.1; steps++; }
    if (steps) {
      renderLive();
      renderEvents();
      drawChart();
      $('progressBar').style.width = (100 * S.sim.dist / S.sim.length).toFixed(1) + '%';
      map.dirty = true;
    }
    if (S.sim.done) {
      S.running = false;
      renderSummary();
      syncDriveButtons();
      return;
    }
    requestAnimationFrame(tick);
  }

  function liveCell(label, value, color, wide) {
    return '<div class="cell' + (wide ? ' wide' : '') + '"><span>' + label + '</span><b' + (color ? ' style="color:' + color + '"' : '') + '>' + value + '</b></div>';
  }

  function renderLive() {
    const el = $('live');
    const p = S.sim && S.sim.last;
    if (!p) {
      el.innerHTML = liveCell('Serving cell', '-', null, true) + liveCell('RSRP', '-') + liveCell('SINR', '-') + liveCell('RSRQ', '-') + liveCell('Speed', '-');
      return;
    }
    const rc = RF.classify('rsrp', p.rsrp).color;
    const sc = p.sinr === null ? '#888' : RF.classify('sinr', p.sinr).color;
    let bars = '<div class="bars">';
    p.top.forEach((c) => {
      const w = Math.max(2, Math.min(100, ((c.rsrp + 130) / 70) * 100));
      bars += '<div class="bar"><span>' + esc(c.label) + ' (' + c.pci + ')' + (c.i === p.serv ? ' *' : '') + '</span><div class="track"><div class="fill" style="width:' + w + '%;background:' + RF.classify('rsrp', c.rsrp).color + '"></div></div><span>' + fmt(c.rsrp) + '</span></div>';
    });
    bars += '</div>';
    el.innerHTML =
      liveCell('Serving cell', p.connected ? esc(p.label) + ' (PCI ' + p.pci + ')' : 'NO SERVICE', p.connected ? null : '#ff5d5d', true) +
      liveCell('RSRP', fmt(p.rsrp) + ' dBm', rc) +
      liveCell('SINR', p.sinr === null ? '-' : fmt(p.sinr) + ' dB', sc) +
      liveCell('RSRQ', fmt(p.rsrq) + ' dB') +
      liveCell(p.mod, fmt(p.thr, 0) + ' Mbps') +
      '<div class="cell wide"><span>Strongest cells (* = serving)</span>' + bars + '</div>' +
      liveCell('Time / distance', fmt(p.t, 0) + ' s / ' + fmt(S.sim.dist / 1000, 2) + ' km', null, true);
  }

  function renderEvents() {
    const sim = S.sim;
    if (!sim) return;
    const ol = $('events');
    if (renderedEvents === 0) ol.innerHTML = '';
    for (; renderedEvents < sim.events.length; renderedEvents++) {
      const e = sim.events[renderedEvents];
      const li = document.createElement('li');
      li.className = e.kind;
      li.innerHTML = '<span class="t">' + fmt(e.t, 1) + 's</span>';
      li.appendChild(document.createTextNode(e.text));
      ol.insertBefore(li, ol.firstChild);
    }
  }

  function renderSummary() {
    const s = S.sim.summary();
    const el = $('driveSummary');
    el.hidden = false;
    const k = (l, v, cls) => '<div class="kpi ' + (cls || '') + '"><div class="k-label">' + l + '</div><div class="k-val">' + v + '</div></div>';
    el.innerHTML = '<h3>Drive test report</h3><div class="summary-grid">' +
      k('HO success rate', fmt(s.hoSuccessRate, 0) + '%', s.hoSuccessRate >= 98 ? 'good' : 'bad') +
      k('Handovers', s.ho + ' / ' + s.hoAttempts + ' tried') +
      k('HO failures', s.hoFail, s.hoFail ? 'bad' : 'good') +
      k('Ping-pong HOs', s.pingPong, s.pingPong ? 'warn' : 'good') +
      k('Call drops', s.drops, s.drops ? 'bad' : 'good') +
      k('No service time', fmt(s.noService) + '%', s.noService ? 'warn' : 'good') +
      k('Avg RSRP', fmt(s.avgRsrp) + ' dBm') +
      k('Avg SINR', fmt(s.avgSinr) + ' dB') +
      k('Samples RSRP >= -100', fmt(s.goodRsrp, 0) + '%') +
      k('Avg throughput', fmt(s.avgThr, 0) + ' Mbps') +
      '</div><p class="muted small" style="margin-top:8px">' + fmt(s.distance / 1000, 2) + ' km in ' + fmt(s.time, 0) + ' s. Export the CSV to analyse it in Excel, just like a TEMS log.</p>';
  }

  function drawChart() {
    const cv = $('chart');
    if ($('chartCard').hidden) return;
    const r = cv.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.max(1, Math.round(r.width * dpr));
    cv.height = Math.max(1, Math.round(r.height * dpr));
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = r.width, h = r.height, L = 44, R = 36, T = 8, B = 22;
    c.clearRect(0, 0, w, h);
    c.font = '10.5px Segoe UI, system-ui, sans-serif';
    const yR = (v) => T + (1 - (v + 130) / 80) * (h - T - B);      // RSRP -130..-50
    const yS = (v) => T + (1 - (v + 15) / 50) * (h - T - B);       // SINR -15..35
    c.strokeStyle = '#243447'; c.lineWidth = 1;
    for (let v = -130; v <= -50; v += 20) {
      c.beginPath(); c.moveTo(L, yR(v)); c.lineTo(w - R, yR(v)); c.stroke();
      c.fillStyle = '#3fb7ff'; c.fillText(String(v), 6, yR(v) + 3);
    }
    for (let v = -15; v <= 35; v += 10) { c.fillStyle = '#f5b942'; c.fillText(String(v), w - R + 6, yS(v) + 3); }
    const sim = S.sim;
    if (!sim || !sim.samples.length) {
      c.fillStyle = '#8ea0b5'; c.fillText('Start the drive to plot RSRP and SINR along the route', L + 10, h / 2);
      return;
    }
    const total = sim.length / sim.speed;
    const x = (t) => L + (t / total) * (w - L - R);
    for (const e of sim.events) {
      const col = { ho: 'rgba(255,255,255,0.35)', pingpong: '#f5b942', hofail: '#ff9f43', drop: '#ff5d5d', reest: '#3ccf7a', connect: '#3ccf7a' }[e.kind];
      c.strokeStyle = col; c.lineWidth = e.kind === 'drop' || e.kind === 'hofail' ? 2 : 1;
      c.beginPath(); c.moveTo(x(e.t), T); c.lineTo(x(e.t), h - B); c.stroke();
    }
    const line = (key, yf, color) => {
      c.strokeStyle = color; c.lineWidth = 1.8; c.beginPath();
      let pen = false;
      for (const p of sim.samples) {
        const v = p[key];
        if (!p.connected || v === null) { pen = false; continue; }
        const yy = yf(Math.max(-130, Math.min(v, 40)));
        if (pen) c.lineTo(x(p.t), yy); else { c.moveTo(x(p.t), yy); pen = true; }
      }
      c.stroke();
    };
    line('rsrp', yR, '#3fb7ff');
    line('sinr', yS, '#f5b942');
    c.fillStyle = '#8ea0b5';
    c.fillText('time (s) ->  ' + fmt(sim.t, 0) + ' / ' + fmt(total, 0) + ' s', L, h - 6);
  }

  window.addEventListener('resize', () => { if (S.tab === 'drive') drawChart(); });

  /* ================= Fix the network ================= */

  function renderScenarioList() {
    const el = $('scenarioList');
    el.innerHTML = '';
    SC.SCENARIOS.forEach((sc, i) => {
      const b = document.createElement('button');
      b.className = 'scn' + (S.scenarioId === sc.id ? ' active' : '');
      b.innerHTML = '<span><b></b></span><span>' + (S.solved[sc.id] ? '<span class="done">Fixed </span>' : '') + '<span class="tag"></span></span>';
      b.querySelector('b').textContent = 'Case ' + (i + 1) + ': ' + sc.title;
      b.querySelector('.tag').textContent = sc.tag;
      b.addEventListener('click', () => loadScenario(sc.id));
      el.appendChild(b);
    });
  }

  function loadScenario(id) {
    const sc = SC.SCENARIOS.find((x) => x.id === id);
    const built = SC.buildScenario(sc);
    S.scenarioId = id;
    S.sites = built.sites;
    S.env = built.env;
    S.zone = sc.zone;
    S.selected = null;
    S.reveal = { hints: 0, solution: false, interview: false };
    S.goalPass = false;
    syncEnvControls();
    S.routeKey = sc.route ? 'scenario' : 'loop';
    rebuildRouteOptions();
    setLayer(sc.layer);
    renderScenarioList();
    renderChips();
    renderEditor();
    recompute();
    renderScenarioCard();
    updateHint();
  }

  function renderScenarioCard() {
    const sc = SC.SCENARIOS.find((x) => x.id === S.scenarioId);
    const el = $('scenarioCard');
    if (!sc) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML =
      '<h3></h3><div class="quote"></div><p class="story"></p><p><b>Your job:</b> <span class="task"></span></p>' +
      '<div class="goal" id="goalBox"><div><b>Goal:</b> <span class="gtext"></span></div><div class="status" id="goalStatus"></div></div>' +
      '<div class="btn-row">' +
      '<button class="btn" id="hintBtn"></button>' +
      '<button class="btn ghost" id="driveCaseBtn">Drive test this area</button>' +
      '<button class="btn ghost" id="solBtn">Show solution</button>' +
      '<button class="btn ghost" id="resetCaseBtn">Reset case</button>' +
      '</div>' +
      '<ol class="hint-list" id="hintList"></ol>' +
      '<div id="solBox"></div>' +
      '<div class="btn-row"><button class="btn ghost" id="intBtn">How to explain this in an interview</button></div>' +
      '<div id="intBox"></div>';
    el.querySelector('h3').textContent = sc.title;
    el.querySelector('.quote').textContent = sc.complaint;
    el.querySelector('.story').textContent = sc.story;
    el.querySelector('.task').textContent = sc.task;
    el.querySelector('.gtext').textContent = sc.goal.text;
    const hintList = el.querySelector('#hintList');
    const hintBtn = el.querySelector('#hintBtn');
    const showHints = () => {
      hintList.innerHTML = '';
      sc.hints.slice(0, S.reveal.hints).forEach((h) => { const li = document.createElement('li'); li.textContent = h; hintList.appendChild(li); });
      hintBtn.textContent = S.reveal.hints >= sc.hints.length ? 'No more hints' : 'Show hint (' + (S.reveal.hints + 1) + '/' + sc.hints.length + ')';
      hintBtn.disabled = S.reveal.hints >= sc.hints.length;
    };
    hintBtn.addEventListener('click', () => { S.reveal.hints++; showHints(); });
    showHints();
    const solBox = el.querySelector('#solBox');
    const showSol = () => {
      if (!S.reveal.solution) { solBox.innerHTML = ''; return; }
      solBox.innerHTML = '<div class="reveal"><b>Solution:</b> <span></span><div class="btn-row"><button class="btn primary" id="applyBtn">Apply the fix for me</button></div></div>';
      solBox.querySelector('span').textContent = sc.solution.text;
      solBox.querySelector('#applyBtn').addEventListener('click', () => {
        sc.solution.apply(S.sites);
        renderEditor();
        recompute();
      });
    };
    el.querySelector('#solBtn').addEventListener('click', () => { S.reveal.solution = !S.reveal.solution; showSol(); });
    showSol();
    const intBox = el.querySelector('#intBox');
    el.querySelector('#intBtn').addEventListener('click', () => {
      S.reveal.interview = !S.reveal.interview;
      intBox.innerHTML = S.reveal.interview ? '<div class="reveal interview"><b>Interview answer (STAR style):</b> <span></span></div>' : '';
      if (S.reveal.interview) intBox.querySelector('span').textContent = sc.interview;
    });
    el.querySelector('#resetCaseBtn').addEventListener('click', () => loadScenario(sc.id));
    el.querySelector('#driveCaseBtn').addEventListener('click', () => {
      S.routeKey = sc.route ? 'scenario' : 'loop';
      rebuildRouteOptions();
      resetDrive();
      switchTab('drive');
    });
    renderGoal();
  }

  function renderGoal() {
    const sc = SC.SCENARIOS.find((x) => x.id === S.scenarioId);
    const box = $('goalBox');
    if (!sc || !box || !S.grid) return;
    const st = RF.areaStats(S.grid, sc.zone || null);
    const r = sc.goal.check(st, S.ctx, S.grid, RF);
    box.classList.toggle('pass', r.pass);
    box.classList.toggle('fail', !r.pass);
    $('goalStatus').textContent = (r.pass ? 'FIXED! ' : 'Not fixed yet. Now: ') + r.now;
    if (r.pass && !S.solved[sc.id]) { S.solved[sc.id] = true; renderScenarioList(); }
    S.goalPass = r.pass;
  }

  /* ================= Start ================= */

  initEnvControls();
  renderChips();
  rebuildRouteOptions();
  renderScenarioList();
  recompute();
  setLayer('rsrp');
  renderEditor();
  resetDrive();
  switchTab('planner');
})();
