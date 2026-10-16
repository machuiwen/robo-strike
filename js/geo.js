import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const Y = new THREE.Vector3(0, 1, 0);

// Merge parts [{ g, c, p, r, s, dir }] into one vertex-colored geometry.
// c is a hex color or an [r, g, b] array (values above 1 glow through the bloom pass).
// dir points the part's Y axis along a direction instead of using the Euler angles r.
export function mergeColored(parts) {
  return mergeGeometries(parts.map(({ g, c, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1], dir }) => {
    let geo = g.index ? g.toNonIndexed() : g.clone();
    if (geo.attributes.uv) geo.deleteAttribute('uv');
    const q = dir
      ? new THREE.Quaternion().setFromUnitVectors(Y, new THREE.Vector3(...dir).normalize())
      : new THREE.Quaternion().setFromEuler(new THREE.Euler(...r));
    geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p), q, new THREE.Vector3(...s)));
    const col = new THREE.Color();
    if (Array.isArray(c)) col.setRGB(c[0], c[1], c[2]); else col.set(c);
    const arr = new Float32Array(geo.attributes.position.count * 3);
    for (let i = 0; i < arr.length; i += 3) { arr[i] = col.r; arr[i + 1] = col.g; arr[i + 2] = col.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return geo;
  }));
}
