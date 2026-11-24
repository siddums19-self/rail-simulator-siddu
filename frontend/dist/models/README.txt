Drop game-ready .glb models here (or upload to gs://<WEB_BUCKET>/models/ on GCP).
They replace the procedural rolling stock automatically - no code changes needed.

Per-vehicle models (recommended; metres, nose pointing -Z, rail top at y = 0):
  lhb_loco.glb              WAP-7 locomotive        lhb_coach.glb             LHB coach (23.5 m)
  vande_bharat_loco.glb     Vande Bharat end car    vande_bharat_coach.glb    Vande Bharat trailer car
  icf_loco.glb              WDP-4D locomotive       icf_coach.glb             ICF coach (21.3 m)
  demu_passenger_loco.glb   DEMU driving power car  demu_passenger_coach.glb  DEMU trailer
  boxn_goods_loco.glb       WAG-12B unit            boxn_goods_coach.glb      BOXN wagon (10.7 m)

Legacy single-file names (lhb.glb, vande_bharat.glb, ...) still work and replace the lead vehicle.
The procedural bogies stay in place and keep steering through curves and turnouts.
Draco, KTX2 and Meshopt compressed .glb files are supported.
Free sources: Sketchfab (filter "downloadable", CC-BY), Poly Haven, Meshy AI.
