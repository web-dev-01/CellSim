/*
 * RF Calculators + Learn page. Pure helper content, no map involved.
 */
(function (root) {
  'use strict';

  const RF = root.RF;
  const f = (v, d) => (Number.isFinite(v) ? v.toFixed(d === undefined ? 2 : d) : '-');

  const CALCS = [
    {
      title: 'dBm <-> Watts',
      formula: 'P(dBm) = 10 x log10( P(mW) )',
      inputs: [{ id: 'dbm', label: 'Power (dBm)', value: 46 }, { id: 'w', label: 'Power (W)', value: 1 }],
      compute: (v) => {
        const w = RF.calc.dbmToW(v.dbm);
        return '<div class="result">' + v.dbm + ' dBm = ' + (w >= 1 ? f(w, 2) + ' W' : f(w * 1000, 3) + ' mW') + '</div>' +
          '<div class="result">' + v.w + ' W = ' + f(RF.calc.wToDbm(v.w), 2) + ' dBm</div>';
      },
      tip: '<b>Remember:</b> 0 dBm = 1 mW, 30 dBm = 1 W, 43 dBm = 20 W, 46 dBm = 40 W. +3 dB means double the power, +10 dB means 10 times.',
    },
    {
      title: 'Wavelength',
      formula: 'lambda = c / f     (c = 3 x 10^8 m/s)',
      inputs: [{ id: 'f', label: 'Frequency (MHz)', value: 2400 }],
      compute: (v) => {
        const l = RF.calc.wavelength(v.f);
        return '<div class="result">lambda = ' + f(l * 100, 2) + ' cm</div>' +
          '<div class="muted">Half-wave dipole: ' + f(l * 50, 2) + ' cm, quarter-wave: ' + f(l * 25, 2) + ' cm</div>';
      },
      tip: '<b>Interview:</b> 2.4 GHz WiFi (ESP32) = 12.5 cm, 1800 MHz = 16.7 cm, 3.5 GHz = 8.6 cm. Higher frequency means smaller wavelength, more path loss and weaker wall penetration.',
    },
    {
      title: 'Free Space Path Loss',
      formula: 'FSPL(dB) = 32.44 + 20 log10(d km) + 20 log10(f MHz)',
      inputs: [{ id: 'f', label: 'Frequency (MHz)', value: 1800 }, { id: 'd', label: 'Distance (km)', value: 1, step: 0.1 }],
      compute: (v) => '<div class="result">FSPL = ' + f(RF.calc.fspl(v.f, v.d), 1) + ' dB</div>' +
        '<div class="muted">Urban (Hata, 30 m tower): ' + f(RF.pathLoss('hata', v.f, 30, 1.5, v.d, 0), 1) + ' dB</div>',
      tip: '<b>Remember:</b> double the distance = +6 dB loss in free space. Real cities lose more (about +10 dB per doubling) because of buildings, which is why the Hata model is used.',
    },
    {
      title: 'Link budget',
      formula: 'Rx = Pt + Gt - Lcable - PathLoss + Gr',
      inputs: [
        { id: 'pt', label: 'Tx power (dBm)', value: 46 }, { id: 'gt', label: 'Tx antenna gain (dBi)', value: 18 },
        { id: 'lc', label: 'Cable loss (dB)', value: 1 }, { id: 'pl', label: 'Path loss (dB)', value: 130 },
        { id: 'gr', label: 'Phone antenna gain (dBi)', value: 0 }, { id: 'sens', label: 'Rx sensitivity (dBm)', value: -100 },
      ],
      compute: (v) => {
        const rx = v.pt + v.gt - v.lc - v.pl + v.gr;
        const margin = rx - v.sens;
        return '<div class="result">Received = ' + f(rx, 1) + ' dBm</div>' +
          '<div class="result" style="color:' + (margin >= 0 ? 'var(--good)' : 'var(--bad)') + '">Margin = ' + f(margin, 1) + ' dB <small>' + (margin >= 0 ? 'link works' : 'link fails') + '</small></div>' +
          '<div class="muted">Max allowed path loss = ' + f(v.pt + v.gt - v.lc + v.gr - v.sens, 1) + ' dB</div>';
      },
      tip: '<b>Interview:</b> a link budget adds all gains and subtracts all losses between transmitter and receiver. The maximum allowed path loss tells you the cell radius.',
    },
    {
      title: 'VSWR / Return loss',
      formula: 'Gamma = (VSWR - 1)/(VSWR + 1),  RL = -20 log10(Gamma)',
      inputs: [{ id: 'v', label: 'VSWR', value: 1.5, step: 0.1 }, { id: 'rl', label: 'Return loss (dB)', value: 20 }],
      compute: (v) => '<div class="result">VSWR ' + v.v + ' -> RL ' + f(RF.calc.rlFromVswr(v.v), 1) + ' dB, ' + f(RF.calc.reflectedPct(v.v), 1) + '% power reflected</div>' +
        '<div class="result">RL ' + v.rl + ' dB -> VSWR ' + f(RF.calc.vswrFromRl(v.rl), 2) + '</div>',
      tip: '<b>Site acceptance:</b> VSWR below 1.5 (return loss above 14 dB) is normally accepted. High VSWR means a bad connector, water in the cable or a damaged feeder.',
    },
    {
      title: 'Shannon capacity',
      formula: 'C = B x log2(1 + SNR)',
      inputs: [{ id: 'b', label: 'Bandwidth (MHz)', value: 20 }, { id: 'snr', label: 'SNR / SINR (dB)', value: 15 }],
      compute: (v) => {
        const c = RF.calc.shannon(v.b, v.snr);
        return '<div class="result">C = ' + f(c, 1) + ' Mbps</div><div class="muted">Spectral efficiency ' + f(c / v.b, 2) + ' bit/s/Hz (theoretical max, one antenna)</div>';
      },
      tip: '<b>Interview:</b> capacity grows linearly with bandwidth but only logarithmically with SNR. That is why 5G uses wide bands (100 MHz in n78) and MIMO.',
    },
    {
      title: 'RS power (per subcarrier)',
      formula: 'RS power = Ptotal - 10 log10(12 x N_RB)',
      inputs: [{ id: 'p', label: 'Total Tx power (dBm)', value: 46 }, { id: 'rb', label: 'Resource blocks (20 MHz = 100)', value: 100 }],
      compute: (v) => '<div class="result">RS power = ' + f(RF.calc.rsPower(v.p, v.rb), 1) + ' dBm</div><div class="muted">' + 12 * v.rb + ' subcarriers share the power</div>',
      tip: '<b>Why RSRP looks so small:</b> RSRP is the power of ONE reference-signal subcarrier, not the whole channel. So -80 dBm RSRP is already a strong signal.',
    },
    {
      title: 'EIRP',
      formula: 'EIRP = Pt + G - Lcable',
      inputs: [{ id: 'pt', label: 'Tx power (dBm)', value: 46 }, { id: 'g', label: 'Antenna gain (dBi)', value: 18 }, { id: 'l', label: 'Cable loss (dB)', value: 1 }],
      compute: (v) => {
        const e = v.pt + v.g - v.l;
        return '<div class="result">EIRP = ' + f(e, 1) + ' dBm = ' + f(RF.calc.dbmToW(e), 0) + ' W</div>';
      },
      tip: '<b>Remember:</b> EIRP is the power the antenna effectively radiates in its main direction. Regulators set EIRP limits for safety (EMF).',
    },
  ];

  const LEARN = [
    { t: 'RSRP', tag: 'Signal strength', d: 'Reference Signal Received Power: how strong the signal from one cell is, measured on one reference subcarrier.', v: 'Excellent >= -80 | Good -80 to -90 | Fair -90 to -100 | Poor -100 to -110 | No coverage < -110 dBm', tr: 'Planner -> RSRP layer. Hover to see how it is calculated.', i: 'RSRP tells me coverage. It is like the loudness of a speaker.' },
    { t: 'SINR', tag: 'Signal quality', d: 'Signal to Interference plus Noise Ratio: how clean the signal is. The wanted cell divided by all other cells plus noise.', v: 'Excellent >= 20 | Good 13 to 20 | Fair 0 to 13 | Poor < 0 dB', tr: 'Planner -> SINR layer. Increase network load and see SINR drop.', i: 'Good RSRP with bad SINR means interference, not a coverage problem.' },
    { t: 'RSRQ', tag: 'Quality', d: 'Reference Signal Received Quality = RSRP / RSSI (per resource block). Drops when the cell is loaded or there is interference.', v: 'Good >= -10 | Fair -10 to -15 | Poor < -15 dB', tr: 'Planner -> RSRQ layer, change load from 0% to 100%.', i: 'RSRQ includes load and interference, so it is used for handover decisions in some networks.' },
    { t: 'Path loss', tag: 'Propagation', d: 'Signal lost between tower and phone. Grows with distance and frequency. Cities use empirical models like Okumura-Hata / COST-231.', v: '1 km at 1800 MHz: free space about 98 dB, urban Hata (30 m tower) about 136 dB', tr: 'Planner -> change band from 700 MHz to 3500 MHz and watch coverage shrink.', i: 'Low bands (700 MHz) give coverage, high bands (3.5 GHz) give capacity.' },
    { t: 'Azimuth & tilt', tag: 'Antenna', d: 'Azimuth is the horizontal direction an antenna faces (0 = north, clockwise). Tilt is how much it points down. More tilt = smaller, cleaner cell.', v: 'Typical: 3 sectors at 120 degrees apart, tilt 2 to 8 degrees, beamwidth 65 degrees', tr: 'Click a tower and move the tilt slider. See coverage and SINR change.', i: 'Tilt is the main tool to control coverage and interference.' },
    { t: 'Handover (A3 event)', tag: 'Mobility', d: 'When a neighbour becomes stronger than the serving cell by an offset (here 3 dB) for a time-to-trigger (320 ms), the phone moves to it.', v: 'HO success rate target > 98%', tr: 'Drive Test tab. Watch the white diamonds on the route.', i: 'Hysteresis and time-to-trigger stop ping-pong handovers.' },
    { t: 'PCI & mod 3', tag: 'Planning', d: 'Physical Cell ID (0 to 503) lets the phone tell cells apart. Neighbours must not share a PCI. Same PCI mod 3 means the reference signals collide.', v: 'Plan PCIs so sectors of one site use mod 0, 1, 2', tr: 'Fix the Network -> PCI conflict case.', i: 'PCI collision causes handover failures; mod-3 clash lowers SINR.' },
    { t: 'Pilot pollution', tag: 'Optimization', d: 'Too many cells with similar strength at one place (4+ within 5 dB). No cell dominates, so SINR is poor even though RSRP is good.', v: 'Fix: make one cell dominant using tilt / azimuth / power', tr: 'Fix the Network -> Pilot pollution case. Use the Pilot pollution layer.', i: 'Good RSRP + bad SINR + many cells close together = pilot pollution.' },
    { t: 'Overshooting', tag: 'Optimization', d: 'A cell serves areas far beyond its planned area, usually because it is too tall or has too little tilt. It creates islands and interference.', v: 'Fix: more downtilt, lower height or less power', tr: 'Fix the Network -> Overshooting case. Use the Best server layer.', i: 'Overshooting shows as islands of a far cell in the best-server plot.' },
    { t: 'Drive test & KPIs', tag: 'Field work', d: 'An engineer drives with a phone running a tool (like TEMS) that logs RSRP, SINR, PCI and events. KPIs show how the network is doing.', v: 'Call drop rate < 1-2%, HO success > 98%, CSSR > 98%', tr: 'Drive Test tab -> export the CSV log, like a TEMS log file.', i: 'I simulated drive tests and analysed handovers, failures and drops.' },
    { t: 'Indian bands', tag: 'Spectrum', d: 'Common bands: n28 700 MHz (coverage), B3 1800 MHz (main LTE), B40 2300 MHz TDD (capacity), n78 3.5 GHz (5G capacity).', v: 'Jio: n28 + n78 (5G SA), Airtel: n78 (5G NSA, anchored on LTE)', tr: 'Planner -> band selector.', i: '5G n78 needs more sites because of higher path loss.' },
    { t: 'Modulation & MIMO', tag: 'Throughput', d: 'Higher SINR allows higher-order modulation: QPSK (2 bits), 16QAM (4), 64QAM (6), 256QAM (8 bits per symbol). MIMO sends parallel streams.', v: 'QPSK < 6 dB < 16QAM < 12 dB < 64QAM < 20 dB < 256QAM', tr: 'Hover the map and look at the modulation in the box.', i: 'Throughput depends on SINR, bandwidth and MIMO layers.' },
  ];

  function renderCalcs(el) {
    el.innerHTML = '<div class="page-head"><h2>RF Calculators</h2><p class="muted">The formulas behind every RF interview question. Change any value to see the result.</p></div>';
    const grid = document.createElement('div');
    grid.className = 'grid-cards';
    CALCS.forEach((cd) => {
      const card = document.createElement('div');
      card.className = 'card calc-card';
      const h = document.createElement('h3'); h.textContent = cd.title; card.appendChild(h);
      const fm = document.createElement('div'); fm.className = 'formula'; fm.textContent = cd.formula; card.appendChild(fm);
      const ins = document.createElement('div'); ins.className = 'inputs';
      const vals = {};
      const out = document.createElement('div');
      const update = () => { out.innerHTML = cd.compute(vals); };
      cd.inputs.forEach((inp) => {
        const lab = document.createElement('label'); lab.className = 'field'; lab.textContent = inp.label;
        const box = document.createElement('input'); box.type = 'number'; box.value = inp.value; box.step = inp.step || 1;
        vals[inp.id] = inp.value;
        box.addEventListener('input', () => { const n = parseFloat(box.value); if (Number.isFinite(n)) { vals[inp.id] = n; update(); } });
        lab.appendChild(box); ins.appendChild(lab);
      });
      card.appendChild(ins); card.appendChild(out);
      const tip = document.createElement('div'); tip.className = 'tip'; tip.innerHTML = cd.tip; card.appendChild(tip);
      update();
      grid.appendChild(card);
    });
    el.appendChild(grid);
  }

  function renderLearn(el) {
    el.innerHTML = '<div class="page-head"><h2>Learn: the concepts behind the simulator</h2><p class="muted">Each card is one interview topic. Read it, then try it in the simulator.</p></div>';
    const grid = document.createElement('div');
    grid.className = 'grid-cards';
    LEARN.forEach((c) => {
      const card = document.createElement('div');
      card.className = 'card learn-card';
      card.innerHTML = '<h3><span></span><span class="tag muted small"></span></h3><p class="d"></p><div class="values"></div><p class="try"></p><div class="tip"><b>Say it in the interview:</b> <span class="i"></span></div>';
      card.querySelector('h3 span').textContent = c.t;
      card.querySelector('.tag').textContent = c.tag;
      card.querySelector('.d').textContent = c.d;
      card.querySelector('.values').textContent = c.v;
      card.querySelector('.try').textContent = 'Try it: ' + c.tr;
      card.querySelector('.i').textContent = c.i;
      grid.appendChild(card);
    });
    el.appendChild(grid);
  }

  root.TOOLS = { renderCalcs, renderLearn };
})(window);
