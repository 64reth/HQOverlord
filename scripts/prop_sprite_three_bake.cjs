#!/usr/bin/env node
/* Generate review-only Three.js/WebGL-baked prop sprites.

   The script drives a headless browser, loads Three.js in the page, builds
   blocky 3D prop models through one locked orthographic camera, then exports
   transparent PNGs plus a comparison sheet. It does not integrate assets into
   runtime code.
*/
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_DIR = path.join(ROOT, 'frontend', 'assets', 'furniture');
const OUT_DIR = path.join(ROOT, 'docs', 'prop-sprite-review', 'three-webgl');
const VARIANT_DIR = path.join(OUT_DIR, 'variants');
const TEMPLATE_DIR = path.join(OUT_DIR, 'templates');
const THREE_URL = 'https://unpkg.com/three@0.165.0/build/three.module.js';

const SPECS = [
  { id: 'desk2', label: 'Legged workstation', kind: 'desk2', footprint: [2, 1], size: [96, 72] },
  { id: 'pixelrig', label: 'Pixel rig', kind: 'pixelrig', footprint: [2, 1], size: [96, 72] },
  { id: 'holotable', label: 'Hologram table', kind: 'holotable', footprint: [4, 2], size: [192, 96] },
  { id: 'crate', label: 'Long cargo crate', kind: 'crate', footprint: [2, 1], size: [96, 48] },
  { id: 'plant', label: 'Potted plant', kind: 'plant', footprint: [1, 1], size: [48, 56] },
  { id: 'arcade', label: 'Arcade cabinet', kind: 'arcade', footprint: [1, 2], size: [48, 104] },
  { id: 'vault', label: 'Vault door', kind: 'vault', footprint: [3, 2], size: [144, 108] },
  { id: 'whiteboard', label: 'Tactical board', kind: 'whiteboard', footprint: [4, 1], size: [192, 56] },
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function dataUrlFromFile(file) {
  if (!fs.existsSync(file)) return null;
  return 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
}

function pngFromDataUrl(dataUrl) {
  return Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
}

function writeText(file, value) {
  fs.writeFileSync(file, value, { encoding: 'utf8' });
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, '/');
}

const PAGE_SOURCE = String.raw`
<html>
<head>
  <meta charset="utf-8">
  <style>
    html, body { margin: 0; background: #05080b; color: #d8ece6; font-family: monospace; }
  </style>
</head>
<body>
  <script type="module">
    import * as THREE from '${THREE_URL}';

    const TILE = 48;
    const RENDER_SCALE = 4;
    const palette = {
      ink: 0x07090d,
      outline: 0x0a0e13,
      metal0: 0x1b2530,
      metal1: 0x2d3f4c,
      metal2: 0x536c77,
      metal3: 0x8aa1a6,
      screen: 0x45f6d1,
      screen2: 0x5bbdff,
      amber: 0xffc65a,
      red: 0xff5a64,
      green: 0x63e47f,
      leaf0: 0x2f9d55,
      leaf1: 0x8cff8b,
      wood0: 0x5b3722,
      wood1: 0xb97942,
      wood2: 0xe4b372,
      paper: 0xe9ead0,
      tape: 0xffda61,
      purple: 0x462163,
      glass: 0x88fff0
    };

    function mat(color, opts = {}) {
      const m = new THREE.MeshStandardMaterial({
        color,
        roughness: opts.roughness ?? 0.78,
        metalness: opts.metalness ?? 0.08,
        flatShading: true,
        emissive: opts.emissive ?? 0x000000,
        emissiveIntensity: opts.emissiveIntensity ?? 0,
        transparent: !!opts.transparent,
        opacity: opts.opacity ?? 1
      });
      return m;
    }

    const mats = {
      ink: mat(palette.ink),
      outline: mat(palette.outline),
      metal0: mat(palette.metal0),
      metal1: mat(palette.metal1),
      metal2: mat(palette.metal2),
      metal3: mat(palette.metal3, { metalness: 0.18 }),
      screen: mat(palette.screen, { emissive: palette.screen, emissiveIntensity: 0.85 }),
      screen2: mat(palette.screen2, { emissive: palette.screen2, emissiveIntensity: 0.75 }),
      amber: mat(palette.amber, { emissive: palette.amber, emissiveIntensity: 0.45 }),
      red: mat(palette.red, { emissive: palette.red, emissiveIntensity: 0.45 }),
      green: mat(palette.green, { emissive: palette.green, emissiveIntensity: 0.25 }),
      leaf0: mat(palette.leaf0),
      leaf1: mat(palette.leaf1),
      wood0: mat(palette.wood0),
      wood1: mat(palette.wood1),
      wood2: mat(palette.wood2),
      paper: mat(palette.paper),
      tape: mat(palette.tape),
      purple: mat(palette.purple),
      glass: mat(palette.glass, { transparent: true, opacity: 0.42, emissive: palette.glass, emissiveIntensity: 0.6 })
    };

    function box(group, x, y, z, sx, sy, sz, material, rot = null) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
      mesh.position.set(x, y, z);
      if (rot) mesh.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      group.add(mesh);
      return mesh;
    }

    function cyl(group, x, y, z, r, h, material, segments = 24, rot = null) {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, segments), material);
      mesh.position.set(x, y, z);
      if (rot) mesh.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
      group.add(mesh);
      return mesh;
    }

    function torus(group, x, y, z, r, tube, material, rot = null) {
      const mesh = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, 36), material);
      mesh.position.set(x, y, z);
      if (rot) mesh.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
      group.add(mesh);
      return mesh;
    }

    function addDeskBase(g, opts = {}) {
      const w = opts.w || 1.75;
      const d = opts.d || 0.72;
      const y = opts.y || 0;
      box(g, 0, y + 0.58, 0.03, w, 0.16, d, mats.metal1);
      box(g, 0, y + 0.68, -0.17, w * 0.92, 0.08, 0.14, mats.metal2);
      box(g, 0, y + 0.50, 0.37, w * 0.92, 0.08, 0.10, mats.metal0);
      const lx = w / 2 - 0.16;
      const lz = d / 2 - 0.12;
      for (const x of [-lx, lx]) for (const z of [-lz, lz]) {
        box(g, x, y + 0.27, z, 0.10, 0.54, 0.10, mats.metal3);
        box(g, x, y + 0.04, z, 0.17, 0.06, 0.17, mats.ink);
      }
      box(g, -0.35, y + 0.71, 0.22, 0.42, 0.035, 0.13, mats.ink);
      box(g, 0.34, y + 0.71, 0.23, 0.24, 0.035, 0.12, mats.metal3);
    }

    function addMonitor(g, x, y, z, sx, sy, colorMat = mats.screen) {
      box(g, x, y + 0.29, z + 0.02, sx + 0.10, sy + 0.10, 0.08, mats.ink);
      box(g, x, y + 0.29, z + 0.065, sx, sy, 0.035, colorMat);
      box(g, x, y - 0.04, z, 0.08, 0.24, 0.07, mats.metal3);
      box(g, x, y - 0.18, z + 0.02, 0.30, 0.04, 0.18, mats.ink);
    }

    function buildDesk2(g) {
      addDeskBase(g);
      addMonitor(g, -0.37, 0.92, -0.19, 0.50, 0.30, mats.screen2);
      addMonitor(g, 0.36, 0.92, -0.19, 0.50, 0.30, mats.screen);
      box(g, -0.66, 0.77, 0.25, 0.06, 0.05, 0.06, mats.red);
      box(g, -0.54, 0.77, 0.25, 0.06, 0.05, 0.06, mats.amber);
      box(g, 0.72, 0.77, 0.20, 0.09, 0.09, 0.09, mats.metal2);
    }

    function buildPixelrig(g) {
      addDeskBase(g);
      addMonitor(g, 0, 0.95, -0.22, 0.78, 0.34, mats.screen2);
      box(g, -0.69, 0.90, -0.03, 0.24, 0.46, 0.26, mats.metal0);
      box(g, -0.69, 1.02, 0.115, 0.16, 0.14, 0.025, mats.screen);
      box(g, -0.69, 0.78, 0.115, 0.05, 0.05, 0.025, mats.red);
      box(g, 0.62, 0.76, 0.20, 0.30, 0.06, 0.16, mats.ink);
      for (let i = 0; i < 5; i++) box(g, -0.18 + i * 0.09, 0.79, 0.30, 0.04, 0.035, 0.04, i % 2 ? mats.screen : mats.amber);
      box(g, 0.70, 0.98, -0.04, 0.11, 0.30, 0.08, mats.metal3);
      box(g, 0.70, 1.14, -0.04, 0.16, 0.06, 0.10, mats.screen);
    }

    function buildHolotable(g) {
      box(g, 0, 0.48, 0, 3.45, 0.18, 1.30, mats.metal1);
      box(g, 0, 0.62, 0, 3.05, 0.06, 0.92, mats.glass);
      for (const x of [-1.35, 1.35]) for (const z of [-0.44, 0.44]) {
        box(g, x, 0.22, z, 0.13, 0.45, 0.13, mats.metal3);
      }
      box(g, 0, 0.35, 0, 2.70, 0.08, 0.16, mats.ink);
      box(g, 0, 0.35, -0.40, 2.30, 0.06, 0.10, mats.metal2);
      torus(g, 0, 0.88, 0, 0.42, 0.015, mats.screen, [Math.PI / 2, 0, 0]);
      torus(g, 0, 1.04, 0, 0.25, 0.012, mats.screen2, [Math.PI / 2, 0, 0]);
      box(g, 0, 1.03, 0, 0.24, 0.24, 0.24, mats.glass, [0.35, 0.6, 0.12]);
      for (let i = 0; i < 7; i++) box(g, -1.25 + i * 0.42, 0.69, 0.60, 0.06, 0.035, 0.05, i % 2 ? mats.screen : mats.amber);
    }

    function buildCrate(g) {
      box(g, 0, 0.34, 0, 1.75, 0.62, 0.70, mats.wood1);
      box(g, 0, 0.68, 0, 1.68, 0.07, 0.66, mats.wood2);
      for (let i = -2; i <= 2; i++) {
        box(g, i * 0.32, 0.71, 0, 0.035, 0.08, 0.70, mats.wood0);
      }
      box(g, 0, 0.34, -0.36, 1.78, 0.12, 0.06, mats.metal3);
      box(g, 0, 0.34, 0.36, 1.78, 0.12, 0.06, mats.metal2);
      for (const x of [-0.86, 0.86]) for (const z of [-0.36, 0.36]) {
        box(g, x, 0.36, z, 0.12, 0.66, 0.10, mats.metal3);
      }
      box(g, -0.32, 0.73, -0.36, 0.30, 0.04, 0.055, mats.tape);
      box(g, 0.32, 0.73, -0.36, 0.30, 0.04, 0.055, mats.tape);
    }

    function buildPlant(g) {
      cyl(g, 0, 0.18, 0, 0.27, 0.36, mats.wood1, 20);
      cyl(g, 0, 0.40, 0, 0.34, 0.13, mats.wood2, 20);
      cyl(g, 0, 0.50, 0, 0.23, 0.06, mats.wood0, 20);
      for (let i = 0; i < 13; i++) {
        const a = (Math.PI * 2 * i) / 13;
        const len = 0.50 + (i % 3) * 0.075;
        const x = Math.cos(a) * len * 0.40;
        const z = Math.sin(a) * len * 0.34;
        box(g, x, 0.76 + (i % 2) * 0.045, z, 0.15, 0.045, len, i % 2 ? mats.leaf1 : mats.leaf0, [0.40, a, 0.18 * Math.sin(a)]);
      }
      box(g, 0, 0.83, 0, 0.09, 0.44, 0.09, mats.leaf0, [0.08, 0.4, 0.18]);
    }

    function buildArcade(g) {
      box(g, 0, 0.56, 0.00, 0.70, 1.05, 0.70, mats.purple);
      box(g, 0, 1.17, -0.05, 0.74, 0.26, 0.74, mats.ink);
      box(g, 0, 1.19, 0.40, 0.60, 0.15, 0.065, mats.amber);
      box(g, 0, 0.89, 0.42, 0.57, 0.38, 0.07, mats.ink);
      box(g, 0, 0.89, 0.47, 0.45, 0.27, 0.035, mats.screen2);
      box(g, 0, 0.62, 0.43, 0.60, 0.12, 0.14, mats.metal1, [-0.20, 0, 0]);
      box(g, -0.17, 0.69, 0.53, 0.055, 0.05, 0.055, mats.red);
      box(g, 0.00, 0.69, 0.53, 0.055, 0.05, 0.055, mats.screen);
      box(g, 0.17, 0.69, 0.53, 0.055, 0.05, 0.055, mats.amber);
      box(g, -0.02, 0.75, 0.53, 0.05, 0.18, 0.05, mats.ink, [0.28, 0, -0.12]);
      box(g, -0.20, 0.37, 0.36, 0.12, 0.08, 0.05, mats.ink);
      box(g, 0.20, 0.37, 0.36, 0.12, 0.08, 0.05, mats.ink);
      box(g, 0, 0.07, 0.23, 0.62, 0.12, 0.36, mats.ink);
    }

    function buildVault(g) {
      box(g, 0, 0.55, -0.12, 2.20, 1.20, 0.34, mats.metal0);
      cyl(g, 0, 0.64, 0.08, 0.70, 0.22, mats.metal2, 48, [Math.PI / 2, 0, 0]);
      torus(g, 0, 0.64, 0.21, 0.58, 0.045, mats.metal3, [0, 0, 0]);
      torus(g, 0, 0.64, 0.235, 0.34, 0.028, mats.amber, [0, 0, 0]);
      cyl(g, 0, 0.64, 0.29, 0.16, 0.10, mats.screen, 32, [Math.PI / 2, 0, 0]);
      for (let i = 0; i < 10; i++) {
        const a = (Math.PI * 2 * i) / 10;
        box(g, Math.cos(a) * 0.58, 0.64 + Math.sin(a) * 0.58, 0.32, 0.055, 0.055, 0.055, i % 2 ? mats.amber : mats.metal3);
      }
      box(g, -0.38, 0.64, 0.36, 0.30, 0.06, 0.06, mats.ink);
      box(g, 0.38, 0.64, 0.36, 0.30, 0.06, 0.06, mats.ink);
    }

    function buildWhiteboard(g) {
      box(g, 0, 0.63, 0, 3.25, 0.72, 0.10, mats.metal3);
      box(g, 0, 0.63, 0.065, 3.02, 0.56, 0.035, mats.paper);
      box(g, 0, 0.25, 0.07, 3.35, 0.07, 0.08, mats.ink);
      for (let i = 0; i < 7; i++) {
        const x = -1.20 + i * 0.39;
        const m = i % 3 === 0 ? mats.tape : i % 3 === 1 ? mats.paper : mats.amber;
        box(g, x, 0.65 + (i % 2) * 0.10, 0.11, 0.23, 0.18, 0.018, m);
      }
      for (let i = 0; i < 5; i++) {
        box(g, -1.05 + i * 0.50, 0.43 + (i % 2) * 0.10, 0.13, 0.35, 0.025, 0.018, i % 2 ? mats.screen : mats.red);
      }
      box(g, 1.28, 0.80, 0.12, 0.12, 0.12, 0.025, mats.red);
      box(g, 1.10, 0.82, 0.12, 0.13, 0.13, 0.025, mats.amber);
    }

    function buildModel(spec) {
      const g = new THREE.Group();
      if (spec.kind === 'desk2') buildDesk2(g);
      else if (spec.kind === 'pixelrig') buildPixelrig(g);
      else if (spec.kind === 'holotable') buildHolotable(g);
      else if (spec.kind === 'crate') buildCrate(g);
      else if (spec.kind === 'plant') buildPlant(g);
      else if (spec.kind === 'arcade') buildArcade(g);
      else if (spec.kind === 'vault') buildVault(g);
      else if (spec.kind === 'whiteboard') buildWhiteboard(g);
      return g;
    }

    function makeScene(spec, width, height) {
      const scene = new THREE.Scene();
      scene.background = null;
      const group = buildModel(spec);
      scene.add(group);
      const ambient = new THREE.AmbientLight(0xffffff, 1.15);
      const key = new THREE.DirectionalLight(0xffffff, 2.0);
      key.position.set(-2.8, 5.0, 3.8);
      const rim = new THREE.DirectionalLight(0x9fffe8, 0.65);
      rim.position.set(3.0, 2.2, -3.0);
      scene.add(ambient, key, rim);

      const viewW = width / TILE;
      const viewH = height / TILE;
      const camera = new THREE.OrthographicCamera(-viewW / 2, viewW / 2, viewH / 2, -viewH / 2, 0.1, 100);
      camera.position.set(3.8, 4.8, 6.4);
      camera.lookAt(0, 0.56, 0);
      camera.updateProjectionMatrix();

      const box3 = new THREE.Box3().setFromObject(group);
      const center = box3.getCenter(new THREE.Vector3());
      group.position.sub(center);
      group.position.y += 0.58;
      group.position.z += 0.04;
      group.updateMatrixWorld(true);

      fitCamera(camera, group);
      return { scene, camera, group };
    }

    function fitCamera(camera, object) {
      object.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(object);
      const pts = [
        [b.min.x, b.min.y, b.min.z], [b.min.x, b.min.y, b.max.z],
        [b.min.x, b.max.y, b.min.z], [b.min.x, b.max.y, b.max.z],
        [b.max.x, b.min.y, b.min.z], [b.max.x, b.min.y, b.max.z],
        [b.max.x, b.max.y, b.min.z], [b.max.x, b.max.y, b.max.z]
      ].map(p => new THREE.Vector3(p[0], p[1], p[2]).project(camera));
      const minX = Math.min(...pts.map(p => p.x));
      const maxX = Math.max(...pts.map(p => p.x));
      const minY = Math.min(...pts.map(p => p.y));
      const maxY = Math.max(...pts.map(p => p.y));
      const sx = 1.70 / Math.max(0.001, maxX - minX);
      const sy = 1.70 / Math.max(0.001, maxY - minY);
      camera.zoom = Math.min(1.10, Math.max(0.70, Math.min(sx, sy)));
      camera.updateProjectionMatrix();
    }

    function alphaBounds(imageData) {
      let minX = imageData.width, minY = imageData.height, maxX = -1, maxY = -1;
      const d = imageData.data;
      for (let y = 0; y < imageData.height; y++) {
        for (let x = 0; x < imageData.width; x++) {
          if (d[(y * imageData.width + x) * 4 + 3] > 8) {
            minX = Math.min(minX, x); minY = Math.min(minY, y);
            maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
          }
        }
      }
      return maxX < 0 ? null : [minX, minY, maxX + 1, maxY + 1];
    }

    function postProcess(renderCanvas, width, height, spec) {
      const out = document.createElement('canvas');
      out.width = width;
      out.height = height;
      const ctx = out.getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingEnabled = false;

      const shadowW = Math.max(18, Math.min(width * 0.72, spec.footprint[0] * TILE * 0.84));
      const shadowH = Math.max(5, Math.min(16, spec.footprint[1] * TILE * 0.15 + 5));
      ctx.fillStyle = 'rgba(0,0,0,0.24)';
      ctx.beginPath();
      ctx.ellipse(width / 2, height - Math.max(7, shadowH * 0.65), shadowW / 2, shadowH / 2, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.drawImage(renderCanvas, 0, 0, renderCanvas.width, renderCanvas.height, 0, 0, width, height);
      let src = ctx.getImageData(0, 0, width, height);
      const base = src.data;
      for (let i = 0; i < base.length; i += 4) {
        const a = base[i + 3];
        if (a <= 0) continue;
        if (a < 80) {
          base[i] = 0; base[i + 1] = 0; base[i + 2] = 0;
          continue;
        }
        base[i] = Math.round(base[i] / 10) * 10;
        base[i + 1] = Math.round(base[i + 1] / 10) * 10;
        base[i + 2] = Math.round(base[i + 2] / 10) * 10;
      }
      ctx.putImageData(src, 0, 0);

      src = ctx.getImageData(0, 0, width, height);
      const outData = new ImageData(new Uint8ClampedArray(src.data), width, height);
      const d = src.data, o = outData.data;
      const getA = (x, y) => (x < 0 || y < 0 || x >= width || y >= height) ? 0 : d[(y * width + x) * 4 + 3];
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4;
          if (d[idx + 3] > 18) continue;
          let near = false;
          for (let yy = -1; yy <= 1 && !near; yy++) for (let xx = -1; xx <= 1 && !near; xx++) {
            if (xx || yy) near = getA(x + xx, y + yy) > 55;
          }
          if (near) {
            o[idx] = 6; o[idx + 1] = 9; o[idx + 2] = 12; o[idx + 3] = 230;
          }
        }
      }
      ctx.putImageData(outData, 0, 0);
      return out;
    }

    function makeTemplateCanvas(spec, imageCanvas) {
      const [width, height] = spec.size;
      const c = document.createElement('canvas');
      c.width = width;
      c.height = height;
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = 'rgba(62,235,178,0.55)';
      ctx.lineWidth = 1;
      for (let x = 0; x <= width; x += TILE) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, height); ctx.stroke(); }
      for (let y = 0; y <= height; y += TILE) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(width, y + 0.5); ctx.stroke(); }
      ctx.strokeStyle = 'rgba(255,205,70,0.95)';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, spec.footprint[0] * TILE - 2, spec.footprint[1] * TILE - 2);
      ctx.drawImage(imageCanvas, 0, 0);
      ctx.strokeStyle = 'rgba(255,255,255,0.65)';
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
      return c;
    }

    async function loadImage(dataUrl) {
      if (!dataUrl) return null;
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      return img;
    }

    function checker(ctx, x, y, w, h, cell = 10) {
      ctx.fillStyle = '#141a20';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#1e2730';
      for (let yy = 0; yy < h; yy += cell) for (let xx = 0; xx < w; xx += cell) {
        if (((xx / cell) + (yy / cell)) % 2 === 0) ctx.fillRect(x + xx, y + yy, cell, cell);
      }
    }

    function drawCard(ctx, img, x, y, w, h, title) {
      ctx.fillStyle = '#090d12';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#d7ede7';
      ctx.font = '12px monospace';
      ctx.fillText(title, x + 8, y + 15);
      checker(ctx, x + 8, y + 24, w - 16, h - 32, 10);
      if (img) {
        const maxW = w - 30;
        const maxH = h - 46;
        const scale = Math.max(1, Math.floor(Math.min(maxW / img.width, maxH / img.height, 4)));
        const dw = img.width * scale;
        const dh = img.height * scale;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, x + 8 + Math.floor((w - 16 - dw) / 2), y + 24 + Math.floor((h - 32 - dh) / 2), dw, dh);
      }
      ctx.strokeStyle = '#40525d';
      ctx.strokeRect(x + 8.5, y + 24.5, w - 17, h - 33);
    }

    async function makeSheet(results) {
      const rowH = 172;
      const leftW = 178;
      const colW = 238;
      const W = leftW + colW * 3 + 28;
      const H = 54 + rowH * results.length;
      const sheet = document.createElement('canvas');
      sheet.width = W;
      sheet.height = H;
      const ctx = sheet.getContext('2d');
      ctx.fillStyle = '#05080b';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#e8f4ef';
      ctx.font = '14px monospace';
      ctx.fillText('Three.js/WebGL prop bake - locked 1/3 topdown camera, pixel-art post pass', 14, 20);
      ctx.fillStyle = '#8da5ad';
      ctx.font = '12px monospace';
      ctx.fillText('Source reference', leftW + 12, 42);
      ctx.fillText('WebGL bake', leftW + colW + 12, 42);
      ctx.fillText('Grid fit preview', leftW + colW * 2 + 12, 42);

      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const y = 54 + i * rowH;
        ctx.fillStyle = '#f2df9b';
        ctx.font = '12px monospace';
        ctx.fillText(r.spec.id, 14, y + 20);
        ctx.fillStyle = '#a9bdc3';
        ctx.fillText(r.spec.size[0] + 'x' + r.spec.size[1] + ' px', 14, y + 38);
        ctx.fillText(r.spec.footprint[0] + 'x' + r.spec.footprint[1] + ' footprint', 14, y + 54);
        ctx.fillStyle = '#6f8c96';
        ctx.fillText(r.spec.label.slice(0, 22), 14, y + 72);

        const srcImg = await loadImage(r.spec.sourceDataUrl);
        const webglImg = await loadImage(r.variant);
        const templateImg = await loadImage(r.template);
        drawCard(ctx, srcImg, leftW, y, colW - 10, 150, 'old reference');
        drawCard(ctx, webglImg, leftW + colW, y, colW - 10, 150, 'webgl/pixel bake');
        drawCard(ctx, templateImg, leftW + colW * 2, y, colW - 10, 150, 'template overlay');
      }
      return sheet.toDataURL('image/png');
    }

    window.bakeProps = async function(specs) {
      const renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: true
      });
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      document.body.appendChild(renderer.domElement);

      const results = [];
      for (const spec of specs) {
        const [width, height] = spec.size;
        renderer.setSize(width * RENDER_SCALE, height * RENDER_SCALE, false);
        const { scene, camera } = makeScene(spec, width, height);
        renderer.render(scene, camera);
        const finalCanvas = postProcess(renderer.domElement, width, height, spec);
        const templateCanvas = makeTemplateCanvas(spec, finalCanvas);
        const imageData = finalCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height);
        results.push({
          spec,
          variant: finalCanvas.toDataURL('image/png'),
          template: templateCanvas.toDataURL('image/png'),
          alphaBounds: alphaBounds(imageData)
        });
      }
      const sheet = await makeSheet(results);
      renderer.dispose();
      return { results, sheet };
    };

    window.bakerReady = true;
  </script>
</body>
</html>
`;

async function main() {
  ensureDir(VARIANT_DIR);
  ensureDir(TEMPLATE_DIR);

  const specs = SPECS.map(spec => ({
    ...spec,
    sourceDataUrl: dataUrlFromFile(path.join(SOURCE_DIR, `${spec.id}.png`)),
  }));

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', err => console.error('[pageerror]', err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') console.error('[browser]', msg.text());
  });
  await page.setContent(PAGE_SOURCE, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.bakerReady === true', null, { timeout: 60000 });
  const baked = await page.evaluate(async input => window.bakeProps(input), specs);
  await browser.close();

  const manifest = {
    kind: 'three-webgl-prop-sprite-review',
    renderer: 'Three.js WebGLRenderer via Playwright',
    threeUrl: THREE_URL,
    camera: {
      type: 'orthographic',
      position: [3.8, 4.8, 6.4],
      lookAt: [0, 0.56, 0],
      note: 'locked 1/3 topdown camera; per-prop fit only prevents crop',
    },
    pixelsPerTile: 48,
    integrated: false,
    samples: [],
  };

  for (const result of baked.results) {
    const id = result.spec.id;
    const variantPath = path.join(VARIANT_DIR, `${id}-webgl.png`);
    const templatePath = path.join(TEMPLATE_DIR, `${id}-webgl-template.png`);
    fs.writeFileSync(variantPath, pngFromDataUrl(result.variant));
    fs.writeFileSync(templatePath, pngFromDataUrl(result.template));
    manifest.samples.push({
      id,
      label: result.spec.label,
      footprint: { width: result.spec.footprint[0], height: result.spec.footprint[1] },
      size: { width: result.spec.size[0], height: result.spec.size[1] },
      sourceReference: rel(path.join(SOURCE_DIR, `${id}.png`)),
      webgl: rel(variantPath),
      template: rel(templatePath),
      alphaBounds: result.alphaBounds,
      notes: result.spec.id === 'crate'
        ? ['uses catalog-correct 2x1 canvas instead of old 48x48 reference']
        : result.spec.id === 'arcade'
          ? ['uses tighter 1x2 cabinet canvas to match the builder footprint']
          : [],
    });
  }

  fs.writeFileSync(path.join(OUT_DIR, 'review-sheet.png'), pngFromDataUrl(baked.sheet));
  writeText(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  writeText(path.join(OUT_DIR, 'README.md'), [
    '# Three.js WebGL Prop Bake',
    '',
    'Review-only prop samples generated by `scripts/prop_sprite_three_bake.cjs`.',
    '',
    'This pass uses a real Three.js WebGL canvas with one locked orthographic',
    'camera and a pixel-art post process. The models are simple 3D/block props,',
    'so the angle, lighting direction, and footprint stay consistent across the set.',
    '',
    'Output:',
    '',
    '- `review-sheet.png` - source reference, WebGL bake, and grid-fit preview',
    '- `variants/*-webgl.png` - transparent candidate sprites',
    '- `templates/*-webgl-template.png` - transparent candidates over the 48 px grid',
    '- `manifest.json` - dimensions, footprints, and notes',
    '',
    'To regenerate in this Codex desktop environment:',
    '',
    '```powershell',
    'powershell -ExecutionPolicy Bypass -File scripts/run_prop_sprite_three_bake.ps1',
    '```',
    ''
  ].join('\n'));
  console.log(`Wrote ${manifest.samples.length} WebGL-baked prop samples to ${rel(OUT_DIR)}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
