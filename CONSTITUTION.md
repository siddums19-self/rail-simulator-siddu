# CONSTITUTION.md — Indian Railways 3D WebGPU Simulator (GCP Edition, v5 High-Graphics)

> **Purpose:** Single source of truth for everything designed and built across v1–v4, the non-negotiable architectural principles ("Constitution"), and the asset/deployment workflow.

---

## 1. Project Identity & Vision

- **Project Name:** Indian Railways 3D WebGPU Simulator (GCP Cloud Edition)
- **Current Version:** v5 (High-Graphics WebGPU PBR Upgrade + Physical Candela Night/Headlight Tuning + PMREM GPU Cleanup + Zero-Config Local `public/models/` Auto-Loader + Animated Platform Passengers + Detailed Multi-Part Indian Rolling Stock + DRACO/KTX2/Meshopt `.glb` Loader + HDRI Sky Support + Spring Boot 4.1.3 Liquibase/WebMVC Fix + Port 5438 Local Postgres)
- **Target Runtime:** High-graphics 3D Browser Application powered by **WebGPU** (Three.js `0.187.0` with automatic WebGL 2 fallback), backed by **Google Cloud Platform (GCP)** Cloud Run + Cloud SQL PostgreSQL 16 + Cloud Storage.
- **Core Goal:** Deliver a clear, crisp, authentic Indian Railways 3D simulator centered on **Guntakal Junction (`GTL`)** and spanning all major Indian trunk corridors, with real-world platform counts, single-line and double-line crossings, goods trains, local all-stop passenger trains, 4-aspect MACL signaling, animated people on platforms, dynamic weather/lighting, and a live Source-to-Destination Custom Route & Roster Builder.

---

## 2. Architectural Constitution (Non-Negotiable Rules)

1. **True 3D World Space for Landmarks:**
   - Every station yard, flyover, and landmark is anchored at fixed 3D world coordinates relative to the track spline.
   - **Guntakal Mandatory Geometry Rule:** Exiting `GTL` toward `DHNE` (Kurnool / Secunderabad), tracks run straight across a multi-track exit throat for ~1 km alongside the lower straight double-line to Gooty (`GY`), then curve full right and climb `+8.5 m` via a Rail-Over-Rail (ROR) flyover. **VV Nagar Colony** is anchored in 3D world space at `+45 m` lateral offset along this curve—automatically appearing on the **RIGHT** when departing `GTL -> DHNE` and on the **LEFT** when arriving `DHNE -> GTL`.
2. **Hybrid Distance Scaling:**
   - **1:1 Real-World Scale** inside station yards, multi-track junction throats, turnouts, and flyovers.
   - **~1:10 Compressed Open Mid-Sections** so a 200 km leg takes ~10–15 minutes at express speeds.
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

## 4. Drop-In Photorealistic Asset Paths (Optional Upgrade)

Place optimized `.glb` or `.hdr` files locally in `frontend/public/` (or on GCP in `gs://<WEB_BUCKET>/`):
- `models/lhb.glb` — WAP-7 + LHB rake
- `models/vande_bharat.glb` — Vande Bharat EMU
- `models/icf.glb` — WDP-4D + ICF rake
- `models/demu_passenger.glb` — 77414 DEMU Passenger
- `models/boxn_goods.glb` — WAG-12B + BOXN Goods
- `models/passenger.glb` — Rigged Mixamo / Renderpeople animated passenger
- `env/sky.hdr` — 2K Poly Haven `.hdr` sky dome

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
