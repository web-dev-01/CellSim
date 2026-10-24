/*
 * CellSim RF engine - the "heart" of the project.
 *
 * One question drives everything:
 *   "At this location, how strong is the signal from every tower sector?"
 *
 *   RSRP = RS power + antenna gain - direction loss - cable loss - path loss - shadowing - indoor loss
 *
 * Coverage maps, the drive test and the fault scenarios all just call this
 * calculator again and again at different locations.
 */
(function (root) {
  'use strict';

  const DEG = 180 / Math.PI;
  const log10 = Math.log10;

  const BANDS = {
    n28: { id: 'n28', label: '5G n28 - 700 MHz', tech: '5G NR', freq: 700, bw: 10, nRB: 52, scs: 15 },
    B3: { id: 'B3', label: '4G Band 3 - 1800 MHz', tech: '4G LTE', freq: 1800, bw: 20, nRB: 100, scs: 15 },
    B40: { id: 'B40', label: '4G Band 40 - 2300 MHz', tech: '4G LTE', freq: 2300, bw: 20, nRB: 100, scs: 15 },
    n78: { id: 'n78', label: '5G n78 - 3500 MHz', tech: '5G NR', freq: 3500, bw: 100, nRB: 273, scs: 30 },
  };

  const ENVIRONMENTS = {
    dense: { label: 'Dense urban', model: 'hata', cm: 3 },
    urban: { label: 'Urban', model: 'hata', cm: 0 },
    suburban: { label: 'Suburban', model: 'hata-sub', cm: 0 },
    free: { label: 'Free space (no buildings)', model: 'fspl', cm: 0 },
  };

  // Fixed equipment assumptions (typical values used in LTE planning)
  const K = {
    antennaGain: 18,   // dBi, 3-sector panel antenna
    hBeamwidth: 65,    // degrees, horizontal 3 dB beamwidth
    vBeamwidth: 6.5,   // degrees, vertical 3 dB beamwidth
    frontBack: 25,     // dB, max attenuation behind the antenna
    sideLobe: 20,      // dB, max vertical attenuation
    cableLoss: 1,      // dB, jumper + connectors (radio unit mounted on the tower)
    ueHeight: 1.5,     // m, phone held by a person
    noiseFigure: 7,    // dB, phone receiver
    indoorLoss: 15,    // dB, signal lost passing through walls
    shadowSigma: 6,    // dB, building shadowing spread
    shadowMax: 12,     // dB, shadowing is capped at +-2 sigma
    minDistance: 20,   // m
    a3Offset: 3,       // dB, handover margin (A3 offset + hysteresis)
    ttt: 0.32,         // s, time-to-trigger
    rlfSinr: -8,       // dB, below this the link is failing (Qout)
    t310: 1.0,         // s, radio link failure timer
  };

  const LN10_10 = Math.LN10 / 10;
  const dbmToMw = (dbm) => Math.exp(dbm * LN10_10);
  const mwToDbm = (mw) => 10 * log10(mw);
  const wrap180 = (a) => ((((a + 180) % 360) + 360) % 360) - 180;

  /* ---------- Path loss models ---------- */

  function fspl(fMHz, dKm) {
    return 32.44 + 20 * log10(dKm) + 20 * log10(fMHz);
  }

  // Returns {a, b} so that pathLoss = a + b * log10(dKm). Lets the grid loop stay fast.
  function pathLossCoefficients(model, fMHz, hb, hm, cm) {
    if (model === 'fspl') return { a: 32.44 + 20 * log10(fMHz), b: 20 };
    const lf = log10(fMHz);
    const lhb = log10(hb);
    const ahm = (1.1 * lf - 0.7) * hm - (1.56 * lf - 0.8);
    const b = 44.9 - 6.55 * lhb;
    // Okumura-Hata below 1500 MHz, COST-231 Hata above (extended beyond 2 GHz)
    let a = fMHz < 1500
      ? 69.55 + 26.16 * lf - 13.82 * lhb - ahm
      : 46.3 + 33.9 * lf - 13.82 * lhb - ahm;
    if (model === 'hata-sub') a -= 2 * Math.pow(log10(fMHz / 28), 2) + 5.4;
    else a += cm;
    return { a, b };
  }

  function pathLoss(model, fMHz, hb, hm, dKm, cm) {
    const c = pathLossCoefficients(model, fMHz, hb, hm, cm);
    // A model can never predict less loss than free space
    return Math.max(c.a + c.b * log10(dKm), fspl(fMHz, dKm));
  }

  /* ---------- Antenna pattern (3GPP TR 36.814) ---------- */

  function antennaLoss(phi, elev, tilt) {
    const aH = Math.min(12 * Math.pow(phi / K.hBeamwidth, 2), K.frontBack);
    const aV = Math.min(12 * Math.pow((elev - tilt) / K.vBeamwidth, 2), K.sideLobe);
    return { aH, aV, total: Math.min(aH + aV, K.frontBack) };
  }

  /* ---------- Shadowing: smooth, repeatable "buildings" ---------- */

  function hash2(ix, iy, seed) {
    let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed + 1, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
    return ((h >>> 0) / 4294967296) * 2 - 1;
  }

  function valueNoise(x, y, cell, seed) {
    const gx = x / cell, gy = y / cell;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const tx = gx - x0, ty = gy - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = hash2(x0, y0, seed), b = hash2(x0 + 1, y0, seed);
    const c = hash2(x0, y0 + 1, seed), d = hash2(x0 + 1, y0 + 1, seed);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }

  const NOISE_NORM = 2.65; // scales the noise to roughly unit standard deviation

  function unitNoise(x, y, seed) {
    return (0.75 * valueNoise(x, y, 260, seed) + 0.45 * valueNoise(x, y, 90, seed + 101)) * NOISE_NORM;
  }

  // Part of the shadowing is shared by all sites (buildings around the user),
  // part is per-site (buildings along each path).
  function shadowDb(x, y, seed) {
    const v = K.shadowSigma * (0.5 * unitNoise(x, y, 999) + 0.866 * unitNoise(x, y, seed));
    return Math.max(-K.shadowMax, Math.min(K.shadowMax, v));
  }

  /* ---------- Prepare a network for fast evaluation ---------- */

  function prepare(net, env) {
    const band = BANDS[env.band];
    const envDef = ENVIRONMENTS[env.environment];
    const sectors = [];
    net.sites.forEach((site, si) => {
      site.sectors.forEach((sec, k) => {
        if (!sec.on) return;
        const pl = pathLossCoefficients(envDef.model, band.freq, site.height, K.ueHeight, envDef.cm);
        sectors.push({
          site, sec, siteIndex: si, k,
          label: site.id + (k + 1),
          x: site.x, y: site.y, h: site.height,
          az: sec.azimuth, tilt: sec.tilt, pci: sec.pci,
          txPower: sec.power,
          rsPower: sec.power - 10 * log10(12 * band.nRB),
          seed: site.seed,
          plA: pl.a, plB: pl.b,
        });
      });
    });
    const noiseRe = -174 + 10 * log10(band.scs * 1000) + K.noiseFigure;
    return {
      band, envDef, env, sectors, n: sectors.length,
      fsA: 32.44 + 20 * log10(band.freq),
      noiseRe, noiseMw: dbmToMw(noiseRe),
      load: env.load / 100,
      shadowing: env.shadowing,
      indoor: env.indoor ? K.indoorLoss : 0,
    };
  }

  /* ---------- THE HEART: signal from one sector at one location ---------- */

  // Everything except shadowing/indoor loss (those depend only on the location)
  function sectorRsrpBase(ctx, s, x, y) {
    const dx = x - s.x, dy = y - s.y;
    const d = Math.max(Math.sqrt(dx * dx + dy * dy), K.minDistance);
    const ld = log10(d / 1000);
    const pl = Math.max(s.plA + s.plB * ld, ctx.fsA + 20 * ld);
    const bearing = Math.atan2(dx, -dy) * DEG; // 0 = north, clockwise
    const phi = wrap180(bearing - s.az);
    const elev = Math.atan2(s.h - K.ueHeight, d) * DEG;
    const aH = Math.min(12 * (phi / K.hBeamwidth) * (phi / K.hBeamwidth), K.frontBack);
    const ev = (elev - s.tilt) / K.vBeamwidth;
    const aV = Math.min(12 * ev * ev, K.sideLobe);
    const ant = Math.min(aH + aV, K.frontBack);
    return s.rsPower + K.antennaGain - ant - K.cableLoss - pl;
  }

  function sectorRsrp(ctx, s, x, y) {
    const sh = ctx.shadowing ? shadowDb(x, y, s.seed) : 0;
    return sectorRsrpBase(ctx, s, x, y) - sh - ctx.indoor;
  }

  // Shadowing only depends on (location, site seed), so cache it per grid
  const shadowCache = new Map();
  function shadowGrid(seed, cols, rows, res) {
    const key = seed + '|' + cols + '|' + rows + '|' + res;
    let a = shadowCache.get(key);
    if (a) return a;
    a = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) a[r * cols + c] = shadowDb((c + 0.5) * res, (r + 0.5) * res, seed);
    }
    if (shadowCache.size > 64) shadowCache.clear();
    shadowCache.set(key, a);
    return a;
  }

  // Same calculation, but returns every step so the UI can show the breakdown
  function sectorBreakdown(ctx, s, x, y) {
    const dx = x - s.x, dy = y - s.y;
    const d = Math.max(Math.hypot(dx, dy), K.minDistance);
    const ld = log10(d / 1000);
    const pl = Math.max(s.plA + s.plB * ld, ctx.fsA + 20 * ld);
    const bearing = (Math.atan2(dx, -dy) * DEG + 360) % 360;
    const phi = wrap180(bearing - s.az);
    const elev = Math.atan2(s.h - K.ueHeight, d) * DEG;
    const ant = antennaLoss(phi, elev, s.tilt);
    const sh = ctx.shadowing ? shadowDb(x, y, s.seed) : 0;
    const perRe = s.txPower - s.rsPower;
    const rsrp = s.rsPower + K.antennaGain - ant.total - K.cableLoss - pl - sh - ctx.indoor;
    return {
      sector: s, distance: d, bearing, phi, elev,
      txPower: s.txPower, perRe, rsPower: s.rsPower,
      gain: K.antennaGain, antLoss: ant.total, aH: ant.aH, aV: ant.aV,
      cable: K.cableLoss, pathLoss: pl, shadow: sh, indoor: ctx.indoor, rsrp,
    };
  }

  /* ---------- Quality metrics from all sector RSRPs at one point ---------- */

  const scratchMw = { arr: new Float64Array(64) };

  // rs: RSRP (dBm) per sector. serv: sector the phone is attached to (-1 = strongest).
  function metrics(ctx, rs, serv) {
    const n = ctx.n;
    if (n === 0) return null;
    if (scratchMw.arr.length < n) scratchMw.arr = new Float64Array(n * 2);
    const mw = scratchMw.arr;
    let best = -1, second = -1, sumAll = 0;
    for (let i = 0; i < n; i++) {
      mw[i] = Math.exp(rs[i] * LN10_10);
      sumAll += mw[i];
      if (best < 0 || rs[i] > rs[best]) { second = best; best = i; }
      else if (second < 0 || rs[i] > rs[second]) second = i;
    }
    if (serv < 0) serv = best;
    const rho = ctx.load;
    const sv = ctx.sectors[serv];
    const mod = sv.pci % 3;
    let I = 0;
    for (let i = 0; i < n; i++) {
      if (i === serv) continue;
      // Same PCI mod 3 = reference signals land on the same subcarriers -> full collision
      I += mw[i] * (ctx.sectors[i].pci % 3 === mod ? 1 : rho);
    }
    const S = mw[serv];
    const sinr = 10 * log10(S / (I + ctx.noiseMw));
    // RSSI per resource block: 2 reference-signal REs always on + 10 data REs at load
    const rssiRb = sumAll * (2 + 10 * rho) + 12 * ctx.noiseMw;
    const rsrq = 10 * log10(S / rssiRb);
    let near = 0;
    const thr = rs[best] - 5;
    if (rs[best] > -105) for (let i = 0; i < n; i++) if (rs[i] >= thr) near++;
    return {
      best, second, serv, rsrp: rs[serv], bestRsrp: rs[best],
      secondRsrp: second >= 0 ? rs[second] : -Infinity,
      sinr, rsrq, near,
      rssi: mwToDbm(rssiRb * ctx.band.nRB),
    };
  }

  function evaluatePoint(ctx, x, y, serv) {
    const rs = new Float64Array(ctx.n);
    for (let i = 0; i < ctx.n; i++) rs[i] = sectorRsrp(ctx, ctx.sectors[i], x, y);
    const m = metrics(ctx, rs, serv === undefined ? -1 : serv);
    if (!m) return null;
    m.rs = rs;
    m.throughput = throughput(m.sinr, ctx.band);
    m.modulation = modulation(m.sinr);
    return m;
  }

  /* ---------- Whole-map computation ---------- */

  function computeGrid(ctx, W, H, res) {
    const cols = Math.ceil(W / res), rows = Math.ceil(H / res), N = cols * rows, n = ctx.n;
    const g = {
      cols, rows, res, W, H, n,
      rsrp: new Float32Array(N), sinr: new Float32Array(N), rsrq: new Float32Array(N),
      thr: new Float32Array(N), best: new Int16Array(N), second: new Int16Array(N),
      gap: new Float32Array(N), near: new Uint8Array(N),
      pairs: new Uint32Array(Math.max(1, n * n)),
    };
    const rs = new Float64Array(Math.max(1, n));
    const shadows = ctx.sectors.map((s) => (ctx.shadowing ? shadowGrid(s.seed, cols, rows, res) : null));
    for (let r = 0; r < rows; r++) {
      const y = (r + 0.5) * res;
      for (let c = 0; c < cols; c++) {
        const x = (c + 0.5) * res;
        const idx = r * cols + c;
        if (n === 0) {
          g.rsrp[idx] = -140; g.sinr[idx] = -20; g.rsrq[idx] = -30; g.best[idx] = -1; g.second[idx] = -1;
          continue;
        }
        for (let i = 0; i < n; i++) {
          rs[i] = sectorRsrpBase(ctx, ctx.sectors[i], x, y) - ctx.indoor - (shadows[i] ? shadows[i][idx] : 0);
        }
        const m = metrics(ctx, rs, -1);
        g.rsrp[idx] = m.rsrp; g.sinr[idx] = m.sinr; g.rsrq[idx] = m.rsrq;
        g.thr[idx] = throughput(m.sinr, ctx.band);
        g.best[idx] = m.best; g.second[idx] = m.second; g.near[idx] = m.near;
        g.gap[idx] = m.second >= 0 ? m.bestRsrp - m.secondRsrp : 99;
        // Sectors that overlap within 6 dB are neighbours (handover candidates)
        if (m.second >= 0 && g.gap[idx] < 6 && m.secondRsrp > -115) g.pairs[m.best * n + m.second]++;
      }
    }
    return g;
  }

  // Neighbour pairs with same PCI (collision) or same PCI mod 3
  function pciIssues(ctx, g) {
    const n = ctx.n, collisions = [], mod3 = [];
    const minCells = Math.max(2, Math.round(20000 / (g.res * g.res))); // ~0.02 km2 of overlap
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        const overlap = g.pairs[a * n + b] + g.pairs[b * n + a];
        if (overlap < minCells) continue;
        const sa = ctx.sectors[a], sb = ctx.sectors[b];
        if (sa.pci === sb.pci) collisions.push([a, b, overlap]);
        else if (sa.pci % 3 === sb.pci % 3 && sa.site !== sb.site) mod3.push([a, b, overlap]);
      }
    }
    return { collisions, mod3 };
  }

  // KPIs over the whole map, or only inside a zone {x, y, w, h}
  function areaStats(g, zone) {
    let c0 = 0, c1 = g.cols, r0 = 0, r1 = g.rows;
    if (zone) {
      c0 = Math.max(0, Math.floor(zone.x / g.res)); c1 = Math.min(g.cols, Math.ceil((zone.x + zone.w) / g.res));
      r0 = Math.max(0, Math.floor(zone.y / g.res)); r1 = Math.min(g.rows, Math.ceil((zone.y + zone.h) / g.res));
    }
    let count = 0, cov95 = 0, cov100 = 0, cov110 = 0, cov90 = 0, sumRsrp = 0, sumSinr = 0, badSinr = 0, polluted = 0, sumThr = 0;
    const servedBy = {};
    for (let r = r0; r < r1; r++) {
      for (let c = c0; c < c1; c++) {
        const i = r * g.cols + c;
        count++;
        const p = g.rsrp[i], q = g.sinr[i];
        sumRsrp += p; sumSinr += q; sumThr += g.thr[i];
        if (p >= -90) cov90++;
        if (p >= -95) cov95++;
        if (p >= -100) cov100++;
        if (p >= -110) cov110++;
        if (q < 0) badSinr++;
        if (g.near[i] >= 4) polluted++;
        const b = g.best[i];
        servedBy[b] = (servedBy[b] || 0) + 1;
      }
    }
    const pct = (v) => (count ? (100 * v) / count : 0);
    return {
      count,
      cov90: pct(cov90), cov95: pct(cov95), cov100: pct(cov100), cov110: pct(cov110),
      avgRsrp: count ? sumRsrp / count : 0, avgSinr: count ? sumSinr / count : 0,
      badSinr: pct(badSinr), polluted: pct(polluted), avgThr: count ? sumThr / count : 0,
      servedBy, servedShare: (i) => pct(servedBy[i] || 0),
    };
  }

  /* ---------- Throughput / modulation estimates ---------- */

  function throughput(sinrDb, band) {
    if (sinrDb < K.rlfSinr) return 0;
    const se = Math.min(0.6 * Math.log2(1 + Math.pow(10, sinrDb / 10)), 5.5); // bits/s/Hz
    const layers = 1 + Math.min(Math.max((sinrDb - 8) / 10, 0), 1); // 2x2 MIMO when signal is clean
    return se * band.bw * layers; // Mbps
  }

  function modulation(sinrDb) {
    if (sinrDb < K.rlfSinr) return 'No service';
    if (sinrDb < 6) return 'QPSK';
    if (sinrDb < 12) return '16QAM';
    if (sinrDb < 20) return '64QAM';
    return '256QAM';
  }

  /* ---------- Quality classes (shared by map colours and text) ---------- */

  const CLASSES = {
    rsrp: [
      { min: -80, label: 'Excellent', range: '>= -80 dBm', color: '#1a9850' },
      { min: -90, label: 'Good', range: '-80 to -90', color: '#66bd63' },
      { min: -100, label: 'Fair', range: '-90 to -100', color: '#fee08b' },
      { min: -110, label: 'Poor', range: '-100 to -110', color: '#fc8d59' },
      { min: -Infinity, label: 'No coverage', range: '< -110 dBm', color: '#d73027' },
    ],
    sinr: [
      { min: 20, label: 'Excellent', range: '>= 20 dB', color: '#1a9850' },
      { min: 13, label: 'Good', range: '13 to 20', color: '#66bd63' },
      { min: 0, label: 'Fair', range: '0 to 13', color: '#fee08b' },
      { min: -3, label: 'Poor', range: '-3 to 0', color: '#fc8d59' },
      { min: -Infinity, label: 'Bad', range: '< -3 dB', color: '#d73027' },
    ],
    rsrq: [
      { min: -10, label: 'Good', range: '>= -10 dB', color: '#1a9850' },
      { min: -15, label: 'Fair', range: '-10 to -15', color: '#fee08b' },
      { min: -20, label: 'Poor', range: '-15 to -20', color: '#fc8d59' },
      { min: -Infinity, label: 'Bad', range: '< -20 dB', color: '#d73027' },
    ],
    thr: [
      { min: 100, label: 'Very fast', range: '>= 100 Mbps', color: '#1a9850' },
      { min: 50, label: 'Fast', range: '50 to 100', color: '#66bd63' },
      { min: 20, label: 'OK', range: '20 to 50', color: '#fee08b' },
      { min: 5, label: 'Slow', range: '5 to 20', color: '#fc8d59' },
      { min: -Infinity, label: 'Unusable', range: '< 5 Mbps', color: '#d73027' },
    ],
  };

  function classify(kind, v) {
    const list = CLASSES[kind];
    for (const c of list) if (v >= c.min) return c;
    return list[list.length - 1];
  }

  /* ---------- Formulas for the calculator tab ---------- */

  const calc = {
    dbmToW: (dbm) => Math.pow(10, dbm / 10) / 1000,
    wToDbm: (w) => 10 * log10(w * 1000),
    wavelength: (fMHz) => 299.792458 / fMHz, // metres
    fspl,
    vswrFromRl: (rl) => { const g = Math.pow(10, -rl / 20); return (1 + g) / (1 - g); },
    rlFromVswr: (v) => -20 * log10((v - 1) / (v + 1)),
    reflectedPct: (v) => 100 * Math.pow((v - 1) / (v + 1), 2),
    shannon: (bwMHz, snrDb) => bwMHz * Math.log2(1 + Math.pow(10, snrDb / 10)), // Mbps
    rsPower: (txDbm, nRB) => txDbm - 10 * log10(12 * nRB),
  };

  const RF = {
    BANDS, ENVIRONMENTS, K, CLASSES,
    dbmToMw, mwToDbm, wrap180, fspl, pathLoss, antennaLoss, shadowDb,
    prepare, sectorRsrp, sectorBreakdown, metrics, evaluatePoint,
    computeGrid, pciIssues, areaStats, throughput, modulation, classify, calc,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = RF;
  else root.RF = RF;
})(typeof window !== 'undefined' ? window : globalThis);
