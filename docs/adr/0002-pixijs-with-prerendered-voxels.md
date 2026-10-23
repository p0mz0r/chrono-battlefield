# PixiJS, with Rhino voxels prerendered to sprites

The game renders with PixiJS v8 (WebGL), and tanks are not drawn as 3D: at import, each Rhino voxel model (`htnk`, `htnktur`, `htnkbarl`) is prerendered into 32 hull facings plus 32 turret facings, and the battlefield's tiles are baked into chunk textures. That turns the whole scene into 2D sprites sorted by screen Y, which is how RA2 itself draws voxels (cached by facing). The [#5 prototype](https://github.com/p0mz0r/chrono-battlefield/issues/5) held 60 fps with 2,000 moving Rhinos in Edge and in an OBS Local-file browser source, and the prerender takes under 0.4 s.

## Considered Options

- **three.js with live voxels**: only pays off if tanks need free 3D rotation or lighting, which a race doesn't; mixing a 3D scene with isometric tile art adds depth-sorting work for no visible gain.
- **Raw WebGL**: the same scene for more code; PixiJS already batches sprites well past the tank counts a race needs.
