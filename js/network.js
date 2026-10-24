/*
 * The virtual city: size, roads, areas, the default tower network and drive routes.
 * World coordinates are metres. x grows east, y grows south. Azimuth 0 = north.
 */
(function (root) {
  'use strict';

  const WORLD = { W: 2800, H: 1870 };

  let seedCounter = 11;

  function makeSite(id, name, x, y, opts) {
    const o = Object.assign({ height: 30, azimuths: [0, 120, 240], tilt: 4, power: 46, pciGroup: 0 }, opts || {});
    return {
      id, name, x, y, height: o.height, seed: o.seed || (seedCounter += 17),
      sectors: o.azimuths.map((az, k) => ({
        on: true, azimuth: az, tilt: Array.isArray(o.tilt) ? o.tilt[k] : o.tilt,
        power: Array.isArray(o.power) ? o.power[k] : o.power,
        pci: o.pcis ? o.pcis[k] : o.pciGroup * 3 + k,
      })),
    };
  }

  // PCIs were chosen by a small optimizer so that neighbouring sectors
  // avoid the same PCI mod 3 (reference-signal collision) wherever possible.
  function defaultSites() {
    return [
      makeSite('A', 'Station Road', 490, 445, { azimuths: [20, 140, 260], pcis: [30, 32, 31], seed: 31 }),
      makeSite('B', 'City Centre', 1400, 420, { azimuths: [0, 120, 240], pcis: [47, 46, 45], seed: 47 }),
      makeSite('C', 'Tech Park', 2310, 465, { azimuths: [40, 160, 280], pcis: [65, 63, 64], seed: 63 }),
      makeSite('D', 'Old Town', 465, 1425, { azimuths: [0, 110, 230], pcis: [101, 99, 100], seed: 79 }),
      makeSite('E', 'Market', 1375, 1355, { azimuths: [30, 150, 270], pcis: [120, 121, 122], seed: 95 }),
      makeSite('F', 'Lake View', 2335, 1425, { azimuths: [60, 180, 300], pcis: [157, 158, 156], seed: 111 }),
      makeSite('G', 'Ring Road', 935, 910, { azimuths: [60, 180, 300], pcis: [185, 184, 183], seed: 127 }),
      makeSite('H', 'Hospital', 1865, 935, { azimuths: [0, 120, 240], pcis: [210, 211, 212], seed: 143 }),
    ];
  }

  function defaultEnv() {
    return { band: 'B3', environment: 'urban', load: 50, shadowing: true, indoor: false };
  }

  // Roads are drawn on the map and used by the preset drive routes
  const ROADS = [
    { name: 'NH-44 Highway', major: true, pts: [[0, 955], [2800, 955]] },
    { name: 'MG Road', major: true, pts: [[1425, 0], [1425, 1870]] },
    { name: 'Station Road', pts: [[0, 280], [2800, 280]] },
    { name: 'Lake Road', pts: [[0, 1610], [2800, 1610]] },
    { name: 'College Road', pts: [[700, 0], [700, 1870]] },
    { name: 'Park Street', pts: [[2100, 0], [2100, 1870]] },
    { name: 'Ring Road', pts: [[325, 605], [1120, 585], [1725, 605], [2475, 630], [2495, 1260], [1725, 1285], [1120, 1285], [325, 1260], [325, 605]] },
  ];

  const AREAS = [
    { name: 'Old Town', x: 100, y: 1300, w: 465, h: 500, kind: 'res' },
    { name: 'Green Park Colony', x: 765, y: 1435, w: 535, h: 365, kind: 'res' },
    { name: 'Tech Park', x: 2200, y: 100, w: 535, h: 400, kind: 'ind' },
    { name: 'Bus Stand', x: 1235, y: 765, w: 335, h: 265, kind: 'com' },
    { name: 'Lake', x: 2165, y: 1655, w: 600, h: 175, kind: 'water' },
    { name: 'University', x: 765, y: 65, w: 500, h: 400, kind: 'res' },
    { name: 'City Hospital', x: 1965, y: 665, w: 300, h: 220, kind: 'com' },
  ];

  const ROUTES = {
    loop: { name: 'City loop (Ring Road)', pts: ROADS[6].pts },
    highway: { name: 'NH-44 Highway (west to east)', pts: [[25, 955], [2775, 955]] },
    mg: { name: 'MG Road (north to south)', pts: [[1425, 25], [1425, 1840]] },
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  const NET = { WORLD, ROADS, AREAS, ROUTES, makeSite, defaultSites, defaultEnv, clone };

  if (typeof module !== 'undefined' && module.exports) module.exports = NET;
  else root.NET = NET;
})(typeof window !== 'undefined' ? window : globalThis);
