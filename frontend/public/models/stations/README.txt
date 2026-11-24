Real station-building models (optional). Put .glb files here and list them in manifest.json:

{
  "GTL":  { "file": "guntakal.glb", "scale": 1, "rotY": 0, "offset": [0, 0, 0] },
  "CSMT": { "file": "csmt.glb" }
}

Convention: metres, ground at y = 0, origin at the centre of the building footprint,
long side along Z (parallel to the platforms), the side that faces the platforms toward -X.
offset = [metres further from the tracks, up, along the platform]. rotY in degrees.
The model replaces the procedural building for that station code; everything else
(platforms, sheds, FOBs, boards, town) stays. Sketchfab / Meshy AI / Blender exports work.
