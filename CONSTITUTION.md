# CONSTITUTION.md — Indian Railways 3D WebGPU Simulator (GCP Edition, v6)

> **Purpose:** Single source of truth for everything designed and built across v1–v6, the non-negotiable architectural principles ("Constitution"), and the asset/deployment workflow.

---

## 1. Project Identity & Vision

- **Project Name:** Indian Railways 3D WebGPU Simulator (GCP Cloud Edition)
- **Current Version:** v6 (Route-driven world: arc-length track paths with real turnouts/crossovers, a track for every platform face, free-platform entry selector, corrected Guntakal ROR flyover, biome environments, SkyMesh atmosphere + bloom, orbit/look cameras, audio engine). Previous: v5 (High-Graphics WebGPU PBR Upgrade + Physical Candela Night/Headlight Tuning + PMREM GPU Cleanup + Zero-Config Local `public/models/` Auto-Loader + Animated Platform Passengers + Detailed Multi-Part Indian Rolling Stock + DRACO/KTX2/Meshopt `.glb` Loader + HDRI Sky Support + Spring Boot 4.1.3 Liquibase/WebMVC Fix + Port 5438 Local Postgres)
- **Target Runtime:** High-graphics 3D Browser Application powered by **WebGPU** (Three.js `0.187.0` with automatic WebGL 2 fallback), backed by **Google Cloud Platform (GCP)** Cloud Run + Cloud SQL PostgreSQL 16 + Cloud Storage.
- **Core Goal:** Deliver a clear, crisp, authentic Indian Railways 3D simulator centered on **Guntakal Junction (`GTL`)** and spanning all major Indian trunk corridors, with real-world platform counts, single-line and double-line crossings, goods trains, local all-stop passenger trains, 4-aspect MACL signaling, animated people on platforms, dynamic weather/lighting, and a live Source-to-Destination Custom Route & Roster Builder.

---

## 2. Architectural Constitution (Non-Negotiable Rules)

1. **True 3D World Space for Landmarks:**
   - Every station yard, flyover, and landmark is anchored at fixed 3D world coordinates relative to the track spline.
   - **Guntakal Mandatory Geometry Rule (v6, corrected):** Departing `GTL` toward `DHNE`, the **Dhone line is on the LEFT** and the **Gooty (`GY`) / Bengaluru double line is on the RIGHT**. The Dhone line runs straight for ~1 km beside the Gooty line, then **curves LEFT through ~70°** (R ≈ 950 m with spiral transitions, continuing past the crest until ~2.4 km) while climbing `+8.5 m` on a viaduct (Rail-Over-Rail flyover) over the **Bellary / Hospet** double line, which passes underneath. **VV Nagar Colony** sits `+48 m` to the right of the Dhone line at ~1.78 km past the GTL throat — on the **RIGHT** departing `GTL -> DHNE` and on the **LEFT** arriving `DHNE -> GTL`. Recorded in Liquibase changeset `003-gtl-flyover-dhone-left`.
   - **Route-Driven World Rule (v6):** The 3D world is generated from the solved route (`POST /api/routes/solve`). The flyover and VV Nagar exist **only** when the route uses edge `GTL_TO_DHNE_FLYOVER`; every other route gets its own seeded alignment, stations and biome scenery.
   - **Curvature & Cant Rule (v6.1):** Open line is never dead straight: alternating left/right curves (R 750–1800 m, 480–1150 m in ghats) with spiral transitions fill every section; station zones stay straight and level. Curves carry superelevation (max 165 mm) and the train leans into them.
   - **Points & Crossings Rule (v6.1):** Every divergence is a real turnout — moving switch blades, cast crossing with check rails, long timbers, point machine and ground position light. Choosing a platform throws the points (animated); the home and starter signals stay RED until all points on the route have finished moving (interlocking).
   - **Signalling & Safety Rule (v6.2):** Double-line sections carry automatic Intermediate Block Signals; every stop signal's aspect is chained from block occupancy (RED → YELLOW → DOUBLE YELLOW → GREEN). **Kavach (ATP) is on by default** and brakes the train before red signals and for overspeed. Passing a red (SPAD) trips the train-stop emergency brake and is logged; with Kavach off it can end in a collision. Collisions and derailments (turnout/loop > 58 km/h, curve > 1.4× its limit) stop the run with *Resume from last station* / *Restart route*.
   - **Speed Limit Rule (v6.2):** Section limits (single 100, double 130, high-speed 160, ghat 80, capped by the rake), curve limits from V = 0.27·√((Ca+Cd)·R) with Ca ≤ 165 mm and Cd = 75 mm (trackside speed + T/P boards), 30 km/h over turnouts and on loop lines.
   - **Station & Dwell Rule (v6.2):** Small stations have platform loops plus a goods loop beside straight-through main lines; odd-platform stations get a goods loop. Scheduled dwell (in-game minutes): metros 10, big junctions such as Guntakal 5, others 1 — editable per station in the Stops panel. Trains ahead are looped at stations so faster trains can overtake.
   - **Guntakal Structures Rule (v6.2):** A Road-over-Bridge spans all lines ~450 m past the GTL throat; the whole flyover is a viaduct (no embankment walls) with a through-truss span over the Bellary line; VV Nagar sits 24 m from the line and its road passes under the viaduct (RUB) to houses on the far side.
   - **Platform Track Rule (v6):** Every platform face has its own track. Tracks fan out from the running lines through turnouts in the station throat (never through a platform); double-line stations carry crossovers so a train on the Up main can reach any free platform.
2. **Hybrid Distance Scaling:**
   - **1:1 Real-World Scale** inside station yards, multi-track junction throats, turnouts, and flyovers.
   - **~1:10 Compressed Open Mid-Sections** so a 200 km leg takes ~10–15 minutes at express speeds. The odometer and km posts show **real** kilometres (km posts appear every ~100 m of compressed track), and a 1× / 2× / 5× sim-rate selector speeds everything up further.
3. **Unified Connected Graph Architecture:**
   - All routes live in a single bidirectional PostgreSQL graph (`rail_hubs` + `corridor_edges`). Custom Source-to-Destination + "Via" routing always computes dynamically via Dijkstra on the graph.
4. **Authentic Indian Railways Signaling & Operations:**
   - **4-Aspect MACL** (`RED`, `YELLOW`, `DOUBLE_YELLOW`, `GREEN`) plus diverging **Route Indicator Feathers** (`15–30 km/h` turnout limits), synchronized between HUD and 3D hooded signal gantries.
   - Single-line sections (`SINGLE_LINE_WITH_LOOPS`, `MIXED_SINGLE_DOUBLE`) divert trains onto visible 3D station loop lines to wait for oncoming Express, Vande Bharat, or 58-wagon Goods trains.
   - Stub-end junctions like **Visakhapatnam (`VSKP`)** carry `mandatory_reversal = TRUE` metadata.
5. **Immutable Database Migrations (Spring Boot 4.1 Compliant):**
   - Uses `spring-boot-starter-liquibase` and `spring-boot-starter-webmvc`. All schema/seed updates are sequential Liquibase changesets (`001-...`, `002-...`); Hibernate `ddl-auto` remains `validate`.
6. **Zero-Code Photorealistic Asset Upgrades:**
   - `GLTFLoader` is pre-wired with **`DRACOLoader`**, **`KTX2Loader`**, and **`MeshoptDecoder`**, plus **`HDRLoader`** for sky domes.
   - Drop real `.glb` files into `frontend/public/models/` (locally) or `gs://<WEB_BUCKET>/models/` (on GCP) and `.hdr` skies into `env/sky.hdr` to instantly upgrade any train, passenger, or sky with zero code changes.
7. **24-Hour Compressed Natural Time Cycle:**
   - `1 real-world hour = 24 in-game hours` (`0.4` in-game minutes per real second).

---

## 3. What Is Done (Implemented Inventory — v5)

### Phase 1: Master Rail Database (PostgreSQL 16 + Liquibase) — **DONE**
- Local Docker Compose mapped to **`localhost:5438`** (`5438:5432`) to avoid conflicts with system PostgreSQL installs.
- **19 Seeded Hubs** with real platform counts (`GTL` 7, `SC` 10, `HYB` 6, `TPTY` 6, `RC` 3, `KRNT` 3, `GWD` 3, `DHNE` 4, `WADI` 4, `SBC` 10, `NDLS` 16, `CSMT` 18, `MAS` 17, `BZA` 10, `VSKP` 8 [mandatory reversal], `HWH` 23, `CBE` 6, `ADI` 12, `JP` 7).
- **20 Bidirectional Corridor Edges** covering:
  1. Bengaluru – Delhi (via Guntakal & Secunderabad)
  2. Bengaluru – Mumbai (via Guntakal)
  3. Chennai – Mumbai (via Guntakal)
  4. Chennai – Howrah (via Vijayawada & Visakhapatnam)
  5. Coimbatore – Secunderabad (via Bengaluru, Guntakal & Kurnool)
  6. Bengaluru – Howrah (via Guntakal, Vijayawada & Visakhapatnam)
  7. Tirupati – Hyderabad (via Raichur & Wadi, via Raichur & Gadwal, and via Kurnool)
  8. Guntakal – Kurnool City Passenger (`77414`, all 13 stops, 123 km)
  9. Mumbai – Ahmedabad – Jaipur – Delhi spine
- **3 Pre-Seeded Rosters:** `77414` GTL–KRNT DEMU Passenger, `12793` TPTY–HYB Rayalaseema SF (via Raichur & Wadi), and `12798` TPTY–HYB Express (via Kurnool).

### Phase 2: Cloud Run Backend (Java 21 + Spring Boot 4.1.3) — **DONE (v4 Fixed)**
- Fixed `pom.xml` for Spring Boot 4.1.3 using `spring-boot-starter-webmvc` and `spring-boot-starter-liquibase`.
- Updated `Dockerfile` to use `-Dmaven.test.skip=true`.
- Endpoints: `GET /api/hubs`, `POST /api/routes/solve`, `GET /api/rosters`, `POST /api/rosters`.

### Phase 3: High-Graphics 3D WebGPU Client (Three.js `0.187.0` + Vite) — **DONE (v5 Upgraded)**
- **Rendering & Lighting:**
  - `THREE.ACESFilmicToneMapping` + `THREE.PCFShadowMap` (`2048x2048` sun shadow camera dynamically tracking the player train).
  - `PMREMGenerator` + `RoomEnvironment` PBR reflections out of the box, plus automatic `HDRLoader` hook for custom `env/sky.hdr` sky domes.
  - `await renderer.compileAsync(scene, camera)` shader pre-compilation before first frame to eliminate stutter.
- **Procedural PBR Materials & Trackwork:**
  - High-resolution procedural PBR textures (`color`, `roughness`, `bump`) for crushed granite track ballast, PSC concrete sleepers, granite platform tiles with yellow tactile safety lines, corrugated blue-grey Indian Railways canopies, coach windows/liveries (with warm interior glow at night), and Deccan red-earth terrain.
  - Broad-gauge steel rails, concrete viaduct piers on the Guntakal ROR flyover, 25 kV AC OHE masts + cantilever arms + overhead contact/catenary wires, and visible 3D Pendekallu loop-line siding.
- **Detailed Multi-Part 3D Rolling Stock (Zero-Box Upgrade):**
  - Sculpted cabs with sloped dark-tinted windshields, buffer beams, cattle guards, roof equipment, diamond pantographs, rotating wheel bogies, twin volumetric headlights, red tail lamps, and inter-coach vestibules across all 5 rakes (`VANDE_BHARAT`, `LHB`, `ICF`, `DEMU_PASSENGER`, `BOXN_GOODS`).
  - Full `GLTFLoader` + `DRACOLoader` + `KTX2Loader` + `MeshoptDecoder` pipeline ready for custom `.glb` train models.
- **Actual Multi-Platform Stations & Animated People:**
  - Multi-platform hubs with steel canopy pillars, glowing platform tube lights at night, **Foot-Over Bridges (FOB)** spanning all platforms, concrete benches, hanging LED coach-position boards, and yellow station nameboards.
  - **Animated 3D Passengers & Red-Shirt Porters** walking and waiting on platforms (with `THREE.AnimationMixer` support for rigged Mixamo/Renderpeople `models/passenger.glb`).
- **Deccan Environment & Landmarks:**
  - Instanced rocky hills, boulders, trees, and multi-story **VV Nagar Colony** buildings with windows, rooftop water tanks, and street lights.

### Phase 4: GCP Deployment (`deploy-gcp.sh`) — **DONE**
- Provisions Cloud SQL PostgreSQL 16 (`asia-south1`), IAM Service Account, Artifact Registry, Cloud Build, Cloud Run, and Cloud Storage hosting.

---

### Phase 5: v6 Route-Driven World & Operations — **DONE**
- **Track engine:** arc-length route path (integrated curvature with spiral transitions + elevation profile); `Lane` lateral functions model turnouts, crossovers and platform fans exactly, so rails, OHE wires and the train always agree. Swept 52 kg rail profiles, ballast, instanced PSC sleepers with Pandrol clips, catenary with sag and droppers, portal gantries in stations.
- **Formation:** earth embankment (stone pitching) or walled embankment, box-girder viaduct on hammer-head piers where the track rises above ground; no geometry under the deck except piers.
- **Stations:** side + island platforms with tactile strips and ramps, gable canopies on steel columns with trusses, purlins, gutters and tube lights, LED coach-position boards, FOBs with stair flights to every platform, colonial station building, name boards, tea stalls, water booths, town, passengers, parked AI trains.
- **Operations:** platform occupancy per station, **free-platform entry selector** (locks at the home signal), 4-aspect MACL distant/home/starter signals with left/right junction route indicators, 30 km/h turnout limits, halts with dwell, single-line crossings on reserved loops, oncoming double-line traffic that holds short of our route, SPAD emergency brake, auto-driver.
- **Environment:** streamed world-space terrain (flat formation, biome relief), 13 biomes (Deccan granite tors + wind turbines + solar, Eastern/Western Ghats, coastal palms + paddy, Gangetic wheat/mustard, Rajasthan khejri, urban), villages, fields, level crossings, HT lines, km posts.
- **Rendering:** SkyMesh atmosphere with clouds, sun-baked PMREM reflections, stars/moon, weather (clear/haze/monsoon/fog), bloom + MSAA post pipeline, quality presets (`?q=ultra|high|medium`).
- **Cameras:** cab & passenger-window mouse look; chase / bogie / drone / free modes on OrbitControls that ride with the moving train (360° drag, wheel zoom, right-drag pan).
- **Audio:** real `audio/*.mp3` when present, else synthesised dual-tone reed air horn (hold H), traction whine / diesel rumble, rail-joint clatter, brake hiss, station chime + spoken announcement.

### Phase 6: v6.3 Operations, Timetables & Guntakal Detail — **DONE**
- **Journey clock (supersedes the old fixed "1 h = 24 h" rule):** game time advances at the local distance compression while moving (real-km-equivalent) and 8× while standing; the **dynamic timetable** (`timetable.js`) derives running times from real km, section/curve/turnout limits and the chosen halts, rebuilds when halts change, tracks delay/ETA and shifts with time jumps.
- **Dwell:** metro 10 min, junction 5 min, other halts 1 min; GTL reversal (e.g. ATP→KRNT via GTL) forces a halt with an **engine change / cab change**.
- **Traffic:** truthful station arrivals/departures (announced trains really arrive and leave on the announced platform), busy stations (hold outside home), **precedence** (a higher-priority Rajdhani/Duranto/Vande Bharat behind gets our train looped, double-line sections only), overtaking slow trains ahead, single-line crossings. Traffic mix: LHB, ICF, DEMU, Rajdhani, Duranto, Vande Bharat, goods.
- **Safety:** IBS block signals, Kavach ATP, SPAD → only a collision ends the run, derailment only on sustained gross overspeed over turnouts/curves.
- **Scoring:** comfort/jerk, overspeed, halts, SPADs, whistle boards; speed recorder and cab DMI.
- **Guntakal (GTL):** facing Gooty, PF7 leftmost / PF1 rightmost; the Dhone line leaves **at grade** (no flyover, no line passes under it); the station's Gooty-side tracks run straight on into Gooty Down/Up and a goods line merging into Gooty Up (no single-point funnel), the Dhone-side tracks into the Dhone line; a foot over bridge spans the Dhone and Gooty tracks on the curve (u≈1150 m); ROB 450 m out; DRM office on the left just before the foot over bridge; **manned level crossing** on the VV Nagar road; VV Nagar railway colony in cream with maroon bands and a few autos/bikes; reservation complex (PF1 side) and S.C. Railway High School (PF7 side) at the Gooty end. GTL–DHNE is single line (Liquibase 004), ATP hub (005).
- **Stations:** landmark buildings modelled on CSMT, Chennai Central, Howrah, New Delhi, KSR Bengaluru, Secunderabad, Hyderabad and Guntakal; other junctions/metros get a seeded procedural style. Trilingual boards (local, Hindi, English). Varied track beyond throats (quadrupled lines at metros, extra running lines at junctions, sidings at small stations). Towns and railway colonies scale with station importance.
- **Line types:** only the Guntakal → Dhone diversion is single line; every other section is double (Liquibase 006 + frontend override). Wayside halts have just the two mains, small stations sometimes one loop, big stations extra goods loops for stabled goods trains; varied extra tracks beyond throats.
- **Default journey:** GTL → SC (LHB) via Dhone, Kurnool, Gadwal, Mahbubnagar, Jadcherla, Kacheguda with only those halts. Train names/numbers are generated per route (no fixed Guntakal trains).
- **Cameras:** 1 front (driver's eye + gauges), 8 guard's compartment with guard and green flag, 9 cab interior with loco pilot and assistant; V swaps 1 ↔ 9.
- **Distances:** exact 1:1 by default (the route is as long as the real line); "Compact 1:10" option compresses open line. Journey clock follows.
- **Throats:** ladder throats at every station — the outermost track joins its neighbour first, then that one the next, so tracks merge progressively (no single funnel point). Guntakal's Gooty-side platforms reach the Dhone line over a crossover ladder just beyond the throat.
- **Speed limits:** loops/turnouts 90 km/h (derail only if enabled and >140), double line 140, single 120, ghat 100, curves V = 0.27√((Ca+140)R).
- **Interlocking:** the home signal stays RED while another train is on or about to cross our route through the throat.
- **Signal replacement:** every signal returns to RED the moment our engine passes it and stays RED while any part of our train is in the block it protects (rear view shows RED → YELLOW → DOUBLE YELLOW behind us).
- **Busy stations (~40% of halts/junctions):** a real train stands on the platform we are booked for; the home signal is held RED outside until it departs ahead of us over our route (or we pick another free line).
- **Cab:** lights (Auto/On/Off, key L) and wipers (Auto/On/Off, key I) with visible blades in the front view.
- **Cloud TTS:** `POST /api/tts` (Google Cloud Text-to-Speech, en-IN Neural2 voices, ADC credentials, in-memory cache); `GET /api/tts/status`. Frontend "Voice" button switches Cloud / Browser; both play as a distant background PA (cloud audio through a loudspeaker band-pass, slap-back echo and hall reverb).
- **Derailment:** off by default (button "Derail"): gross overspeed over points/curves gives a heavy lurch and −150 instead; Kavach brakes for the most restrictive limit ahead (e.g. 30 km/h loop turnouts) with margin.
- **Station models:** `public/models/stations/manifest.json` maps a station code to a .glb that replaces the procedural building.
- **PA:** announcements are tied to their station (dropped/cut once we leave), played as a quiet background voice; the chime is band-limited and reverberant.
- **AI safety:** AI trains brake for any train ahead on the same track (no passing through each other); station arrivals only spawn on a clear approach.
- **Audio:** female (and occasional male) natural en-IN announcer, no "Jn", no caution messages (welcome + real train movements only), reset on route change; twin-trumpet air horn (electric higher, diesel lower) with reed/bell/chorus model; brakes: valve exhaust on application, shoe scrape pulsing per wheel revolution, intermittent squeal near the stop; natural crowd ambience.

---

## 4. Drop-In Photorealistic Asset Paths (Optional Upgrade)

Place optimized `.glb` or `.hdr` files locally in `frontend/public/` (or on GCP in `gs://<WEB_BUCKET>/`):
- `models/<rake>_loco.glb` + `models/<rake>_coach.glb` — per-vehicle models, `<rake>` = `lhb`, `vande_bharat`, `icf`, `demu_passenger`, `boxn_goods` (legacy `models/<rake>.glb` replaces the lead vehicle)
- `models/passenger.glb` — Rigged Mixamo / Renderpeople animated passenger
- `env/sky.hdr` — 2K Poly Haven `.hdr` used for reflections
- `audio/horn.mp3`, `audio/engine.mp3`, `audio/clatter.mp3`, `audio/chime.mp3` — real recordings replace the synthesised sounds

---

## 5. Quick Start Commands

```bash
# 1. Start local PostgreSQL 16 on port 5438
docker compose up -d

# 2. Start Spring Boot 4.1.3 Backend (Liquibase auto-migrates & seeds all data)
cd backend
mvn clean spring-boot:run

# 3. Start High-Graphics 3D WebGPU Frontend (new terminal)
cd frontend
npm install
npm run dev
```
