# CellSim: RF Planning & Drive Test Simulator

A browser-based mini version of the tools RF engineers use every day, a **planning tool** (like Atoll) and a **drive test tool** (like TEMS). It needs no hardware and no install: pure HTML, CSS and JavaScript.

## The core idea

Every feature answers one question:

> **"At this location, how strong is the signal from every tower sector?"**

```
RSRP = RS power + antenna gain - direction loss - cable loss - path loss - shadowing - indoor loss
```

- **Coverage maps** run this calculation for about 13,000 points in the city.
- **The drive test** runs it at every step of a moving phone, and decides handovers and call drops.
- **Fix the Network** lets you change tilt, azimuth, power or PCI, then runs it again to check whether the problem is gone.

## Features

| Module | What it does |
|---|---|
| **Planner** | 8-tower virtual city (2.8 x 1.9 km). RSRP, SINR, RSRQ, throughput, best-server and pilot-pollution maps. Drag towers, change azimuth, tilt, power, height and PCI. Switch bands (700 / 1800 / 2300 / 3500 MHz), environment, load, shadowing and indoor loss. Hover anywhere to see the full link-budget calculation. |
| **Drive Test** | A virtual phone drives a route (preset or drawn by you). Live RSRP, SINR, RSRQ, PCI, modulation and throughput. A3 handover with offset and time-to-trigger, ping-pong detection, PCI-collision handover failure, radio-link-failure call drops. RSRP/SINR chart, drive-test report and CSV export. |
| **Fix the Network** | 5 real optimization cases: coverage hole (over-tilt), overshooting, pilot pollution, PCI conflict, wrong azimuth. Each has a customer complaint, a measurable goal, hints, the solution and an interview answer. |
| **RF Calculators** | dBm/W, wavelength, FSPL, link budget, VSWR/return loss, Shannon capacity, RS power, EIRP. |
| **Learn** | 12 concept cards (RSRP, SINR, RSRQ, path loss, tilt, handover, PCI, pilot pollution, overshooting, KPIs, Indian bands, modulation and MIMO). |

## Models used

- **Path loss:** Okumura-Hata (< 1500 MHz) and COST-231 Hata (> 1500 MHz), urban, dense-urban and suburban corrections, never below free-space loss
- **Antenna:** 3GPP TR 36.814 sector pattern (65 deg horizontal, 6.5 deg vertical beamwidth, 18 dBi, 25 dB front-to-back)
- **Shadowing:** spatially correlated log-normal-like fading, sigma 6 dB, capped at +-12 dB (repeatable)
- **SINR:** serving RS power vs. interference from other cells scaled by load, with full reference-signal collision for same PCI mod 3, plus thermal noise (-174 dBm/Hz + 7 dB noise figure)
- **RSRQ:** RSRP / RSSI per resource block (2 RS + 10 data REs at load)
- **Throughput:** attenuated Shannon (60% efficiency, max 5.5 bit/s/Hz), 2x2 MIMO when SINR is high
- **Mobility:** A3 event (3 dB, 320 ms TTT), RLF when SINR < -8 dB for 1 s (Qout / T310)

The default PCI plan was chosen by a small optimizer that minimises PCI mod-3 clashes between neighbouring sectors.

## Run it

Double-click `index.html`, or run a local server:

```bash
node serve.js
```

then open http://localhost:5178

## Project structure

```
index.html        page layout
css/style.css     styling
js/rf.js          RF engine: path loss, antenna pattern, RSRP/SINR/RSRQ, grid, KPIs
js/network.js     the virtual city: towers, roads, areas, routes
js/scenarios.js   the 5 "Fix the Network" cases
js/drive.js       drive test simulation (handover, failures, drops, CSV)
js/map.js         canvas map renderer
js/tools.js       calculators and learn cards
js/app.js         UI controller
```

## Resume line

**CellSim: RF Planning & Drive Test Simulator** (JavaScript, HTML5 Canvas)
- Built a browser-based LTE/5G RF planning tool with COST-231 Hata path loss and a 3GPP antenna model, generating RSRP, SINR, RSRQ and best-server coverage maps for an 8-site, 24-sector network.
- Simulated drive tests with A3 handover, PCI-collision handover failures and radio-link-failure call drops, with KPI reports and CSV log export.
- Created 5 optimization scenarios (overshooting, pilot pollution, PCI conflict, coverage hole, wrong azimuth) solved by tuning tilt, azimuth, power and PCI.
