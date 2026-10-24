/*
 * Virtual drive test: a phone moves along a route and, at every step, asks the
 * RF engine "how strong is every sector here?". From that it decides:
 *   - handover   (A3 event: a neighbour is 3 dB stronger for 320 ms)
 *   - HO failure (target has the same PCI as the serving cell)
 *   - call drop  (SINR below -8 dB for 1 s = radio link failure)
 */
(function (root) {
  'use strict';

  const RF = root.RF || (typeof require !== 'undefined' ? require('./rf.js') : null);
  const K = RF.K;

  function routeLength(pts) {
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return L;
  }

  function pointAt(pts, dist) {
    let left = dist;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      const seg = Math.hypot(x1 - x0, y1 - y0);
      if (left <= seg) {
        const f = seg ? left / seg : 0;
        return { x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, done: false };
      }
      left -= seg;
    }
    const last = pts[pts.length - 1];
    return { x: last[0], y: last[1], done: true };
  }

  class DriveSim {
    constructor(ctx, route, speedKmh) {
      this.ctx = ctx;
      this.route = route;
      this.length = routeLength(route);
      this.speed = speedKmh / 3.6; // m/s
      this.reset();
    }

    reset() {
      this.t = 0;
      this.dist = 0;
      this.serv = -1;
      this.prevServ = -1;
      this.lastHoTime = -99;
      this.cand = -1;
      this.candTimer = 0;
      this.blockUntil = 0;
      this.blockTarget = -1;
      this.rlfTimer = 0;
      this.everConnected = false;
      this.done = false;
      this.samples = [];
      this.events = [];
      this.last = null;
      this.nextSample = 0;
      this.counters = { hoAttempts: 0, ho: 0, hoFail: 0, pingPong: 0, drops: 0 };
    }

    label(i) {
      const s = this.ctx.sectors[i];
      return s.label + ' (PCI ' + s.pci + ')';
    }

    event(kind, text, x, y) {
      const e = { t: this.t, kind, text, x, y };
      this.events.push(e);
      return e;
    }

    step(dt) {
      if (this.done) return;
      const ctx = this.ctx;
      this.t += dt;
      this.dist = Math.min(this.dist + this.speed * dt, this.length);
      const p = pointAt(this.route, this.dist);
      if (p.done || this.dist >= this.length) this.done = true;
      let m = RF.evaluatePoint(ctx, p.x, p.y, this.serv);
      if (!m) { this.done = true; return; }
      let ev = null;

      if (this.serv < 0) {
        // Idle / after a drop: camp on the strongest cell if it is usable
        const mb = RF.evaluatePoint(ctx, p.x, p.y, m.best);
        if (mb.rsrp > -120 && mb.sinr > K.rlfSinr) {
          this.serv = m.best;
          m = mb;
          ev = this.event(this.everConnected ? 'reest' : 'connect',
            (this.everConnected ? 'Re-connected to ' : 'Connected to ') + this.label(this.serv), p.x, p.y);
          this.everConnected = true;
          this.rlfTimer = 0;
        }
      } else {
        // A3 event: neighbour stronger than serving by the offset, for time-to-trigger
        const servRsrp = m.rs[this.serv];
        const b = m.best;
        if (b !== this.serv && m.rs[b] > servRsrp + K.a3Offset && !(b === this.blockTarget && this.t < this.blockUntil)) {
          if (this.cand === b) this.candTimer += dt;
          else { this.cand = b; this.candTimer = dt; }
          if (this.candTimer >= K.ttt) {
            this.counters.hoAttempts++;
            const src = ctx.sectors[this.serv], dst = ctx.sectors[b];
            if (src.pci === dst.pci) {
              this.counters.hoFail++;
              ev = this.event('hofail', 'Handover FAILED ' + this.label(this.serv) + ' -> ' + this.label(b) +
                ': same PCI, phone cannot tell the cells apart', p.x, p.y);
              this.blockTarget = b;
              this.blockUntil = this.t + 2;
            } else {
              const pingPong = b === this.prevServ && this.t - this.lastHoTime < 5;
              if (pingPong) this.counters.pingPong++;
              this.counters.ho++;
              ev = this.event(pingPong ? 'pingpong' : 'ho',
                (pingPong ? 'Ping-pong handover ' : 'Handover ') + this.label(this.serv) + ' -> ' + this.label(b), p.x, p.y);
              this.prevServ = this.serv;
              this.serv = b;
              this.lastHoTime = this.t;
              m = RF.evaluatePoint(ctx, p.x, p.y, this.serv);
            }
            this.cand = -1;
            this.candTimer = 0;
          }
        } else {
          this.cand = -1;
          this.candTimer = 0;
        }

        // Radio link failure: quality too low for too long -> call drop
        if (m.sinr < K.rlfSinr) {
          this.rlfTimer += dt;
          if (this.rlfTimer >= K.t310) {
            this.counters.drops++;
            ev = this.event('drop', 'CALL DROP on ' + this.label(this.serv) + ' (SINR ' + m.sinr.toFixed(1) + ' dB for 1 s)', p.x, p.y);
            this.serv = -1;
            this.rlfTimer = 0;
          }
        } else {
          this.rlfTimer = 0;
        }
      }

      const connected = this.serv >= 0;
      this.last = {
        t: this.t, x: p.x, y: p.y, connected,
        serv: this.serv,
        label: connected ? ctx.sectors[this.serv].label : '-',
        pci: connected ? ctx.sectors[this.serv].pci : null,
        rsrp: connected ? m.rsrp : m.bestRsrp,
        rsrq: m.rsrq, sinr: connected ? m.sinr : null,
        thr: connected ? m.throughput : 0,
        mod: connected ? m.modulation : 'No service',
        best: m.best, top: topCells(ctx, m.rs, 3),
        event: ev,
      };
      if (this.t >= this.nextSample || ev || this.done) {
        this.samples.push(this.last);
        this.nextSample = this.t + 0.5;
      }
    }

    summary() {
      const s = this.samples.filter((x) => x.connected);
      const avg = (k) => (s.length ? s.reduce((t, x) => t + x[k], 0) / s.length : 0);
      const c = this.counters;
      return {
        time: this.t, distance: this.dist, samples: this.samples.length,
        avgRsrp: avg('rsrp'), avgSinr: avg('sinr'), avgThr: avg('thr'),
        goodRsrp: s.length ? (100 * s.filter((x) => x.rsrp >= -100).length) / s.length : 0,
        noService: this.samples.length ? (100 * this.samples.filter((x) => !x.connected).length) / this.samples.length : 0,
        hoSuccessRate: c.hoAttempts ? (100 * c.ho) / c.hoAttempts : 100,
        ...c,
      };
    }

    toCSV() {
      const head = 'time_s,x_m,y_m,serving_cell,pci,rsrp_dbm,rsrq_db,sinr_db,throughput_mbps,modulation,event';
      const rows = this.samples.map((x) => [
        x.t.toFixed(1), x.x.toFixed(0), x.y.toFixed(0), x.label, x.pci === null ? '' : x.pci,
        x.rsrp.toFixed(1), x.rsrq.toFixed(1), x.sinr === null ? '' : x.sinr.toFixed(1),
        x.thr.toFixed(1), x.mod, x.event ? '"' + x.event.text.replace(/"/g, "'") + '"' : '',
      ].join(','));
      return [head].concat(rows).join('\n');
    }
  }

  function topCells(ctx, rs, k) {
    const idx = Array.from(rs.keys()).sort((a, b) => rs[b] - rs[a]).slice(0, k);
    return idx.map((i) => ({ i, label: ctx.sectors[i].label, pci: ctx.sectors[i].pci, rsrp: rs[i] }));
  }

  const DRIVE = { DriveSim, routeLength, pointAt };
  if (typeof module !== 'undefined' && module.exports) module.exports = DRIVE;
  else root.DRIVE = DRIVE;
})(typeof window !== 'undefined' ? window : globalThis);
