/*
 * Map renderer: draws the city, the coverage heatmap, towers with their sector
 * beams, the drive route, the moving phone and the hover point.
 */
(function (root) {
  'use strict';

  const { W, H } = root.NET.WORLD;
  const SITE_HUES = [205, 25, 140, 285, 50, 330, 175, 95, 0, 240, 60, 310];

  const siteHue = (i) => SITE_HUES[i % SITE_HUES.length];
  const sectorColor = (si, k, a) => 'hsla(' + siteHue(si) + ', 75%, ' + [42, 56, 70][k % 3] + '%, ' + (a === undefined ? 1 : a) + ')';
  const siteColor = (si) => 'hsl(' + siteHue(si) + ', 75%, 56%)';

  function hslToRgb(h, s, l) {
    s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [Math.round(255 * f(0)), Math.round(255 * f(8)), Math.round(255 * f(4))];
  }

  function hexToRgb(hex) {
    const v = parseInt(hex.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }

  const CLASS_RGB = {};
  Object.keys(root.RF.CLASSES).forEach((k) => {
    CLASS_RGB[k] = root.RF.CLASSES[k].map((c) => ({ min: c.min, rgb: hexToRgb(c.color) }));
  });

  function classRgb(kind, v) {
    const list = CLASS_RGB[kind];
    for (let i = 0; i < list.length; i++) if (v >= list[i].min) return list[i].rgb;
    return list[list.length - 1].rgb;
  }

  const POLLUTION_RGB = { 4: [197, 27, 125], 3: [222, 119, 174], 2: [74, 94, 116], 1: [44, 60, 78], 0: [30, 40, 52] };

  class MapView {
    constructor(canvas, wrap, state) {
      this.canvas = canvas;
      this.wrap = wrap;
      this.S = state;
      this.c = canvas.getContext('2d');
      this.heat = document.createElement('canvas');
      this.heatCols = 0; this.heatRows = 0; this.heatRes = 20;
      this.dirty = true;
      new ResizeObserver(() => this.resize()).observe(wrap);
      this.resize();
      const loop = () => {
        if (this.dirty) { this.dirty = false; this.draw(); }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }

    resize() {
      const r = this.wrap.getBoundingClientRect();
      this.dpr = window.devicePixelRatio || 1;
      this.cssW = r.width; this.cssH = r.height;
      this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
      this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
      this.s = r.width / W;
      this.dirty = true;
    }

    toWorld(px, py) { return [px / this.s, py / this.s]; }

    siteAt(px, py) {
      const sites = this.S.sites;
      for (let i = sites.length - 1; i >= 0; i--) {
        const dx = sites[i].x * this.s - px, dy = sites[i].y * this.s - py;
        if (dx * dx + dy * dy < 15 * 15) return sites[i];
      }
      return null;
    }

    updateHeat(g, layer, ctx) {
      const { cols, rows } = g;
      this.heat.width = cols; this.heat.height = rows;
      this.heatCols = cols; this.heatRows = rows; this.heatRes = g.res;
      const hc = this.heat.getContext('2d');
      const img = hc.createImageData(cols, rows);
      const d = img.data;
      const sectorRgb = ctx.sectors.map((s) => hslToRgb(siteHue(s.siteIndex), 75, [42, 56, 70][s.k % 3]));
      for (let i = 0; i < cols * rows; i++) {
        let rgb;
        if (g.best[i] < 0) rgb = [30, 40, 52];
        else if (layer === 'rsrp') rgb = classRgb('rsrp', g.rsrp[i]);
        else if (layer === 'sinr') rgb = classRgb('sinr', g.sinr[i]);
        else if (layer === 'rsrq') rgb = classRgb('rsrq', g.rsrq[i]);
        else if (layer === 'thr') rgb = classRgb('thr', g.thr[i]);
        else if (layer === 'best') rgb = sectorRgb[g.best[i]];
        else rgb = POLLUTION_RGB[Math.min(g.near[i], 4)];
        d[i * 4] = rgb[0]; d[i * 4 + 1] = rgb[1]; d[i * 4 + 2] = rgb[2]; d[i * 4 + 3] = 255;
      }
      hc.putImageData(img, 0, 0);
      this.dirty = true;
    }

    draw() {
      const c = this.c, s = this.s, S = this.S;
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      c.clearRect(0, 0, this.cssW, this.cssH);
      c.fillStyle = '#0e1620';
      c.fillRect(0, 0, this.cssW, this.cssH);

      // Heatmap
      if (this.heatCols) {
        c.globalAlpha = 0.9;
        c.imageSmoothingEnabled = S.layer !== 'best' && S.layer !== 'pollution';
        c.drawImage(this.heat, 0, 0, this.heatCols * this.heatRes * s, this.heatRows * this.heatRes * s);
        c.globalAlpha = 1;
      }

      this.drawAreas();
      this.drawRoads();
      if (S.zone) this.drawZone(S.zone);
      this.drawRoute();
      this.drawTrail();
      this.drawSites();
      this.drawUE();
      this.drawHover();
      this.drawCompass();
    }

    drawAreas() {
      const c = this.c, s = this.s;
      c.font = '600 11px Segoe UI, system-ui, sans-serif';
      for (const a of root.NET.AREAS) {
        if (a.kind === 'water') {
          c.fillStyle = 'rgba(28, 92, 140, 0.72)';
          c.fillRect(a.x * s, a.y * s, a.w * s, a.h * s);
        }
        c.setLineDash([4, 4]);
        c.strokeStyle = 'rgba(255,255,255,0.32)';
        c.lineWidth = 1;
        c.strokeRect(a.x * s, a.y * s, a.w * s, a.h * s);
        c.setLineDash([]);
        this.label(a.name, a.x * s + 6, a.y * s + 14, 'rgba(255,255,255,0.85)');
      }
    }

    drawRoads() {
      const c = this.c, s = this.s;
      for (const r of root.NET.ROADS) {
        c.beginPath();
        r.pts.forEach(([x, y], i) => (i ? c.lineTo(x * s, y * s) : c.moveTo(x * s, y * s)));
        c.lineWidth = r.major ? 3.2 : 1.6;
        c.strokeStyle = r.major ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.3)';
        c.stroke();
      }
      c.font = '10px Segoe UI, system-ui, sans-serif';
      for (const r of root.NET.ROADS) {
        if (r.name === 'Ring Road') continue;
        const [[x0, y0], [x1, y1]] = r.pts;
        const vertical = x0 === x1;
        c.save();
        if (vertical) { c.translate(x0 * s - 4, (y0 + (y1 - y0) * 0.12) * s); c.rotate(-Math.PI / 2); c.textAlign = 'right'; }
        else c.translate((x0 + (x1 - x0) * 0.02) * s, y0 * s - 5);
        this.label(r.name, 0, 0, 'rgba(255,255,255,0.7)');
        c.restore();
      }
      c.textAlign = 'left';
    }

    drawZone(z) {
      const c = this.c, s = this.s;
      c.save();
      c.setLineDash([7, 5]);
      c.lineWidth = 2.5;
      c.strokeStyle = '#ffffff';
      c.shadowColor = 'rgba(0,0,0,0.8)'; c.shadowBlur = 4;
      c.strokeRect(z.x * s, z.y * s, z.w * s, z.h * s);
      c.restore();
      c.font = '700 12px Segoe UI, system-ui, sans-serif';
      this.label('Problem area: ' + z.label, z.x * s + 4, (z.y + z.h) * s + 15, '#fff');
    }

    drawRoute() {
      const c = this.c, s = this.s, S = this.S;
      const pts = S.drawing ? S.draft : (S.tab === 'drive' ? S.route : null);
      if (!pts || !pts.length) return;
      c.beginPath();
      pts.forEach(([x, y], i) => (i ? c.lineTo(x * s, y * s) : c.moveTo(x * s, y * s)));
      c.setLineDash([6, 5]);
      c.lineWidth = 2;
      c.strokeStyle = S.drawing ? '#3fb7ff' : 'rgba(255,255,255,0.85)';
      c.stroke();
      c.setLineDash([]);
      if (S.drawing) {
        c.fillStyle = '#3fb7ff';
        pts.forEach(([x, y]) => { c.beginPath(); c.arc(x * s, y * s, 4, 0, 7); c.fill(); });
      } else {
        const [x0, y0] = pts[0];
        c.fillStyle = '#3ccf7a';
        c.beginPath(); c.arc(x0 * s, y0 * s, 5, 0, 7); c.fill();
        this.label('START', x0 * s + 8, y0 * s - 6, '#3ccf7a');
      }
    }

    drawTrail() {
      const c = this.c, s = this.s, sim = this.S.sim;
      if (!sim || this.S.tab !== 'drive') return;
      for (const p of sim.samples) {
        c.fillStyle = p.connected ? root.RF.classify('rsrp', p.rsrp).color : '#555';
        c.beginPath(); c.arc(p.x * s, p.y * s, 3.4, 0, 7); c.fill();
      }
      for (const e of sim.events) {
        const x = e.x * s, y = e.y * s;
        if (e.kind === 'ho' || e.kind === 'pingpong') {
          c.save(); c.translate(x, y); c.rotate(Math.PI / 4);
          c.fillStyle = e.kind === 'ho' ? '#ffffff' : '#f5b942';
          c.strokeStyle = '#0b1118'; c.lineWidth = 1.5;
          c.fillRect(-4, -4, 8, 8); c.strokeRect(-4, -4, 8, 8);
          c.restore();
        } else if (e.kind === 'hofail' || e.kind === 'drop') {
          const r = e.kind === 'drop' ? 8 : 6;
          c.strokeStyle = '#0b1118'; c.lineWidth = 5;
          c.beginPath(); c.moveTo(x - r, y - r); c.lineTo(x + r, y + r); c.moveTo(x + r, y - r); c.lineTo(x - r, y + r); c.stroke();
          c.strokeStyle = e.kind === 'drop' ? '#ff5d5d' : '#ff9f43'; c.lineWidth = 2.6;
          c.stroke();
        } else {
          c.fillStyle = '#3ccf7a';
          c.beginPath(); c.arc(x, y, 5, 0, 7); c.fill();
        }
      }
    }

    drawSites() {
      const c = this.c, s = this.s, S = this.S;
      const R = 30;
      S.sites.forEach((site, si) => {
        const x = site.x * s, y = site.y * s;
        const selected = S.selected === site.id;
        site.sectors.forEach((sec, k) => {
          const a = ((sec.azimuth - 90) * Math.PI) / 180;
          const half = (32.5 * Math.PI) / 180;
          c.beginPath();
          c.moveTo(x, y);
          c.arc(x, y, R, a - half, a + half);
          c.closePath();
          c.fillStyle = sec.on ? sectorColor(si, k, selected ? 0.55 : 0.35) : 'rgba(120,120,120,0.15)';
          c.fill();
          c.strokeStyle = sec.on ? sectorColor(si, k, 0.95) : 'rgba(160,160,160,0.5)';
          c.lineWidth = 1;
          if (!sec.on) c.setLineDash([3, 3]);
          c.stroke();
          c.setLineDash([]);
          if (!sec.on) return;
          const ex = x + Math.cos(a) * (R + 9), ey = y + Math.sin(a) * (R + 9);
          c.beginPath(); c.moveTo(x, y); c.lineTo(ex, ey);
          c.strokeStyle = '#0b1118'; c.lineWidth = 3.5; c.stroke();
          c.strokeStyle = sectorColor(si, k, 1); c.lineWidth = 1.8; c.stroke();
          c.beginPath();
          c.moveTo(ex, ey);
          c.lineTo(ex - Math.cos(a - 0.45) * 7, ey - Math.sin(a - 0.45) * 7);
          c.lineTo(ex - Math.cos(a + 0.45) * 7, ey - Math.sin(a + 0.45) * 7);
          c.closePath();
          c.fillStyle = sectorColor(si, k, 1); c.fill();
          if (selected) {
            c.font = '600 10px Segoe UI, system-ui, sans-serif';
            const lx = x + Math.cos(a) * (R + 22), ly = y + Math.sin(a) * (R + 22);
            c.textAlign = 'center';
            this.label(site.id + (k + 1) + ' / ' + sec.pci, lx, ly + 3, '#fff');
            c.textAlign = 'left';
          }
        });
        if (selected) {
          c.beginPath(); c.arc(x, y, 14, 0, 7);
          c.strokeStyle = '#ffffff'; c.lineWidth = 2; c.stroke();
        }
        c.beginPath(); c.arc(x, y, 10, 0, 7);
        c.fillStyle = siteColor(si); c.fill();
        c.strokeStyle = '#0b1118'; c.lineWidth = 2; c.stroke();
        c.fillStyle = '#0b1118';
        c.font = '700 11px Segoe UI, system-ui, sans-serif';
        c.textAlign = 'center';
        c.fillText(site.id, x, y + 4);
        c.textAlign = 'left';
      });
    }

    drawUE() {
      const S = this.S, sim = S.sim;
      if (!sim || !sim.last || S.tab !== 'drive') return;
      const c = this.c, s = this.s, p = sim.last;
      const x = p.x * s, y = p.y * s;
      if (p.connected) {
        const sec = S.ctx.sectors[p.serv];
        if (sec) {
          c.beginPath(); c.moveTo(x, y); c.lineTo(sec.x * s, sec.y * s);
          c.strokeStyle = sectorColor(sec.siteIndex, sec.k, 0.95); c.lineWidth = 2.2;
          c.stroke();
        }
      }
      c.beginPath(); c.arc(x, y, 8, 0, 7);
      c.fillStyle = '#ffffff'; c.fill();
      c.lineWidth = 3; c.strokeStyle = p.connected ? '#3fb7ff' : '#ff5d5d'; c.stroke();
    }

    drawHover() {
      const S = this.S, h = S.hover;
      if (!h || !h.m || S.dragging) return;
      const c = this.c, s = this.s;
      const sec = S.ctx.sectors[h.m.serv];
      const x = h.x * s, y = h.y * s;
      if (sec) {
        c.beginPath(); c.moveTo(x, y); c.lineTo(sec.x * s, sec.y * s);
        c.setLineDash([5, 4]);
        c.strokeStyle = 'rgba(255,255,255,0.9)'; c.lineWidth = 1.5; c.stroke();
        c.setLineDash([]);
      }
      c.beginPath(); c.arc(x, y, 5, 0, 7);
      c.fillStyle = '#fff'; c.fill();
      c.strokeStyle = '#0b1118'; c.lineWidth = 2; c.stroke();
    }

    drawCompass() {
      const c = this.c, s = this.s;
      // Scale bar
      const len = 500 * s, x0 = 14, y0 = this.cssH - 16;
      c.fillStyle = 'rgba(10,16,24,0.75)';
      c.fillRect(x0 - 6, y0 - 18, len + 56, 26);
      c.strokeStyle = '#fff'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(x0, y0 - 4); c.lineTo(x0, y0); c.lineTo(x0 + len, y0); c.lineTo(x0 + len, y0 - 4); c.stroke();
      c.font = '11px Segoe UI, system-ui, sans-serif';
      c.fillStyle = '#fff'; c.fillText('500 m', x0 + len + 6, y0 + 1);
      // North arrow
      const nx = this.cssW - 24, ny = 26;
      c.fillStyle = 'rgba(10,16,24,0.75)';
      c.beginPath(); c.arc(nx, ny, 15, 0, 7); c.fill();
      c.fillStyle = '#fff';
      c.beginPath(); c.moveTo(nx, ny - 11); c.lineTo(nx + 5, ny + 3); c.lineTo(nx - 5, ny + 3); c.closePath(); c.fill();
      c.font = '700 10px Segoe UI, system-ui, sans-serif'; c.textAlign = 'center';
      c.fillText('N', nx, ny + 12); c.textAlign = 'left';
    }

    label(text, x, y, color) {
      const c = this.c;
      c.lineWidth = 3; c.strokeStyle = 'rgba(8,12,18,0.85)'; c.lineJoin = 'round';
      c.strokeText(text, x, y);
      c.fillStyle = color; c.fillText(text, x, y);
    }
  }

  root.MAP = { MapView, sectorColor, siteColor, siteHue };
})(window);
