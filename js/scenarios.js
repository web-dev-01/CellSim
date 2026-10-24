/*
 * "Fix the Network" scenarios. Each one starts from the healthy default city,
 * breaks it in one realistic way, and defines a goal that the player must reach
 * by changing tilt / azimuth / power / PCI, exactly like an optimization engineer.
 */
(function (root) {
  'use strict';

  const NET = root.NET || (typeof require !== 'undefined' ? require('./network.js') : null);

  const site = (sites, id) => sites.find((s) => s.id === id);
  const sec = (sites, id, n) => site(sites, id).sectors[n - 1];
  const fmt = (v, d) => (Number.isFinite(v) ? v.toFixed(d === undefined ? 1 : d) : '-');

  function servedShare(stats, ctx, siteId, k) {
    const i = ctx.sectors.findIndex((s) => s.site.id === siteId && s.k === k - 1);
    return i < 0 ? 0 : stats.servedShare(i);
  }

  const SCENARIOS = [
    {
      id: 'hole',
      title: 'Coverage hole',
      tag: 'Tilt',
      complaint: '"Since last week there is no signal inside our houses in Green Park Colony." (230+ customer complaints)',
      story: 'A maintenance team visited Site D and Site G last week. Since then, Green Park Colony has weak signal.',
      task: 'Find which antennas are causing the hole and bring the coverage back.',
      layer: 'rsrp',
      zone: { x: 765, y: 1435, w: 535, h: 365, label: 'Green Park Colony' },
      route: [[785, 1615], [1280, 1615]],
      build(sites) {
        sec(sites, 'D', 2).tilt = 13;
        sec(sites, 'G', 2).tilt = 12;
      },
      goal: {
        text: 'At least 90% of Green Park Colony with RSRP >= -100 dBm',
        check(st) { return { pass: st.cov100 >= 90, now: fmt(st.cov100, 0) + '% of the zone is >= -100 dBm' }; },
      },
      hints: [
        'Switch to the RSRP layer and hover over the colony. Which sectors are supposed to serve it?',
        'Click Site D and Site G. Compare their tilt values with the other sectors (normally 3 to 5 degrees).',
        'A very high downtilt points the beam at the ground close to the tower, so far areas lose signal.',
      ],
      solution: {
        text: 'Sector D2 and G2 were over-tilted (13 and 12 degrees). Reducing the tilt back to about 4 degrees lifts the beam and the colony is covered again.',
        apply(sites) { sec(sites, 'D', 2).tilt = 4; sec(sites, 'G', 2).tilt = 4; },
      },
      interview: 'I saw a coverage hole on the RSRP plot. The serving sectors had excessive downtilt (13 degrees), so the main beam was hitting the ground near the site. I reduced the tilt to 4 degrees and coverage above -100 dBm in that area went from about 35% to over 90%.',
    },
    {
      id: 'overshoot',
      title: 'Overshooting',
      tag: 'Tilt / height',
      complaint: '"Full signal bars, but internet is slow and calls drop", from many areas far away from Tech Park.',
      story: 'Site C (Tech Park) was moved to a 70 m tower on a hill, and its power was boosted to 49 dBm. Its antennas were left at 0 degree tilt.',
      task: 'Stop Site C from reaching deep into other cells, so the quality (SINR) of the whole city comes back.',
      layer: 'best',
      zone: null,
      route: [[2310, 465], [1865, 935], [1425, 1300], [1425, 1840]],
      build(sites) {
        const c = site(sites, 'C');
        c.height = 70;
        c.sectors.forEach((s) => { s.tilt = 0; s.power = 49; });
      },
      goal: {
        text: 'City-wide: area with bad quality (SINR < 0 dB) below 11.5% and average SINR at least 5.7 dB',
        check(st) {
          return { pass: st.badSinr < 11.5 && st.avgSinr >= 5.7, now: fmt(st.badSinr) + '% of the city has SINR < 0, avg SINR ' + fmt(st.avgSinr, 2) + ' dB' };
        },
      },
      hints: [
        'Use the Best Server layer. Look for Site C colours (its sectors) far away from Site C, inside other cells.',
        'A tall site with 0 degree tilt sends its beam towards the horizon. It reaches far cells and becomes interference there. That is overshooting.',
        'Increase the downtilt of all Site C sectors (try 8 degrees) and bring the power back to the normal 46 dBm.',
      ],
      solution: {
        text: 'Site C was 70 m high with 0 degree tilt and boosted power, so its signal reached far into other cells as interference. Downtilting it to 8 degrees and returning power to 46 dBm keeps Site C inside its own area.',
        apply(sites) { site(sites, 'C').sectors.forEach((s) => { s.tilt = 8; s.power = 46; }); },
      },
      interview: 'Users had full bars but poor throughput, which means good RSRP but bad SINR. The best-server plot showed one tall site serving islands far away from it. That is overshooting, from a high site with zero tilt. I increased the downtilt to 8 degrees, the far islands disappeared and the bad-SINR area went from about 16% to about 10%.',
    },
    {
      id: 'pollution',
      title: 'Pilot pollution',
      tag: 'Azimuth / tilt',
      complaint: '"Signal is strong at the Bus Stand but calls keep dropping and videos buffer." (Bus Stand)',
      story: 'To "boost" the Bus Stand, four sectors from four different sites were all pointed at it with low tilt.',
      task: 'Make one cell clearly dominant at the Bus Stand instead of four equal ones.',
      layer: 'pollution',
      zone: { x: 1235, y: 765, w: 335, h: 265, label: 'Bus Stand' },
      route: [[1000, 955], [1800, 955]],
      build(sites) {
        sec(sites, 'B', 2).azimuth = 180; sec(sites, 'B', 2).tilt = 1;
        sec(sites, 'G', 1).azimuth = 90; sec(sites, 'G', 1).tilt = 1;
        sec(sites, 'H', 3).azimuth = 270; sec(sites, 'H', 3).tilt = 1;
        sec(sites, 'E', 1).azimuth = 0; sec(sites, 'E', 1).tilt = 1;
      },
      goal: {
        text: 'Pilot-polluted area below 5% and average SINR at least 3 dB at the Bus Stand',
        check(st) { return { pass: st.polluted < 5 && st.avgSinr >= 3, now: fmt(st.polluted, 0) + '% polluted, avg SINR ' + fmt(st.avgSinr) + ' dB' }; },
      },
      hints: [
        'Use the Pilot Pollution layer. Purple means 4 or more cells are within 5 dB of each other.',
        'Hover at the Bus Stand: RSRP is fine, but look at how close the top cells are. The phone cannot settle on one.',
        'Choose ONE sector to own the Bus Stand (B2 is closest to pointing at it). Turn the other three back to their normal direction and tilt them down a lot.',
      ],
      solution: {
        text: 'Four sectors (B2, G1, H3, E1) were all pointed at the Bus Stand with 1 degree tilt, so no cell was dominant. Keep B2 as the dominant server (azimuth 180, tilt 4). Turn G1, H3 and E1 back to their original azimuth and downtilt them to 10 degrees.',
        apply(sites) {
          const d = NET.defaultSites();
          sec(sites, 'B', 2).tilt = 4;
          [['G', 1], ['H', 3], ['E', 1]].forEach(([id, k]) => {
            const s = sec(sites, id, k);
            s.azimuth = sec(d, id, k).azimuth; s.tilt = 10;
          });
        },
      },
      interview: 'RSRP was good but SINR was poor, and 4 or more cells were within 5 dB of each other. That is pilot pollution: no dominant server. I re-oriented the extra sectors and increased their tilt so one cell dominates, which improved SINR and stopped the drops.',
    },
    {
      id: 'pci',
      title: 'PCI conflict',
      tag: 'PCI',
      complaint: '"Every time I drive on the NH-44 highway near the Bus Stand my call drops." (highway users)',
      story: 'A new configuration was loaded on Site H last night. Sector H3 may have got the same PCI as a neighbour.',
      task: 'Find the two neighbouring sectors with the same PCI and give one of them a unique PCI.',
      layer: 'best',
      zone: { x: 1000, y: 835, w: 835, h: 255, label: 'NH-44 near Bus Stand' },
      route: [[25, 955], [2775, 955]],
      build(sites) { sec(sites, 'H', 3).pci = sec(sites, 'E', 1).pci; },
      goal: {
        text: 'No two neighbouring sectors share the same PCI',
        check(st, ctx, g, RF) {
          const is = RF.pciIssues(ctx, g);
          const list = is.collisions.map(([a, b]) => ctx.sectors[a].label + ' & ' + ctx.sectors[b].label + ' (PCI ' + ctx.sectors[a].pci + ')');
          return { pass: is.collisions.length === 0, now: list.length ? 'Collision: ' + list.join(', ') : 'No PCI collisions' };
        },
      },
      hints: [
        'Run the Drive Test on the highway route and watch the event log. Where does the handover fail?',
        'The phone identifies cells by PCI. If two neighbours have the same PCI, it cannot tell them apart and the handover fails.',
        'Compare the PCI of sector E1 and H3. Change one of them to an unused number (best: a different PCI mod 3 too).',
      ],
      solution: {
        text: 'H3 had PCI 120, the same as its neighbour E1. The phone could not hand over between them, so calls dropped. Giving H3 back its own PCI 212 removes the collision.',
        apply(sites) { sec(sites, 'H', 3).pci = 212; },
      },
      interview: 'Drive test showed handover failures and drops at the same spot. Two neighbouring sectors had the same PCI, a PCI collision, so the UE could not distinguish the target cell. I changed the PCI of one sector to a unique value, also checking mod 3, and the handovers succeeded.',
    },
    {
      id: 'azimuth',
      title: 'Wrong azimuth',
      tag: 'Azimuth',
      complaint: '"New tower was installed near the lake, but Lake Side apartments still have poor signal."',
      story: 'Site F was installed last week. The installation team may have mounted one antenna facing the wrong way.',
      task: 'Check where each Site F antenna is pointing and correct the wrong one.',
      layer: 'best',
      zone: { x: 2065, y: 1500, w: 535, h: 300, label: 'Lake Side Apartments' },
      route: [[1800, 1610], [2775, 1610]],
      build(sites) { sec(sites, 'F', 2).azimuth = 330; },
      goal: {
        text: 'At least 85% of Lake Side Apartments with RSRP >= -100 dBm',
        check(st) { return { pass: st.cov100 >= 85, now: fmt(st.cov100, 0) + '% of the zone is >= -100 dBm' }; },
      },
      hints: [
        'Look at the arrows drawn on Site F. Each arrow is the direction (azimuth) of a sector.',
        'Two arrows of Site F point almost the same way and nothing points south towards the apartments.',
        'Azimuth is measured clockwise from north: 0 = north, 90 = east, 180 = south, 270 = west.',
      ],
      solution: {
        text: 'Sector F2 was installed at 330 degrees instead of the planned 180 degrees, so it overlapped F3 and left the south side empty. Rotating it to 180 degrees covers the apartments.',
        apply(sites) { sec(sites, 'F', 2).azimuth = 180; },
      },
      interview: 'After a new site went live the area it was planned for still had poor RSRP. The best-server plot showed that one sector was pointing the wrong way, an installation azimuth error. We corrected the azimuth from 330 to 180 degrees and the area got good coverage.',
    },
  ];

  function buildScenario(sc) {
    const sites = NET.defaultSites();
    sc.build(sites);
    return { sites, env: NET.defaultEnv() };
  }

  const SC = { SCENARIOS, buildScenario };
  if (typeof module !== 'undefined' && module.exports) module.exports = SC;
  else root.SC = SC;
})(typeof window !== 'undefined' ? window : globalThis);
