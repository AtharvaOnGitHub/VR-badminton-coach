// The hall. A full virtual badminton hall, because the player is at home and a
// passthrough living room gives no spatial reference for where a shot is going.
// Real furniture is faded in separately (see safety.js) only as you approach it.
import * as THREE from '../vendor/three.module.js';

// Real badminton singles court, metres.
export const COURT = { len: 13.4, wid: 5.18, netH: 1.524, netPostH: 1.55 };

const line = (w, h, x, z, rotY = 0, col = 0xdfe6ee) => {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85 }));
  m.rotation.x = -Math.PI / 2; m.rotation.z = rotY;
  m.position.set(x, 0.02, z);
  return m;
};

export function buildHall(scene) {
  scene.background = new THREE.Color(0x0e1418);
  scene.fog = new THREE.Fog(0x0e1418, 18, 40);

  // floor
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(26, 44),
    new THREE.MeshStandardMaterial({ color: 0x2f6b52, roughness: 0.92 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const g = new THREE.Group();
  const { len, wid } = COURT;
  const lw = 0.04;
  // sidelines + baselines
  g.add(line(lw, len, -wid / 2, 0));
  g.add(line(lw, len,  wid / 2, 0));
  g.add(line(wid, lw, 0, -len / 2));
  g.add(line(wid, lw, 0,  len / 2));
  // short service lines (1.98 m from net) and centre line
  g.add(line(wid, lw, 0, -1.98));
  g.add(line(wid, lw, 0,  1.98));
  g.add(line(lw, len / 2 - 1.98, 0, -(len / 4 + 0.99)));
  g.add(line(lw, len / 2 - 1.98, 0,  (len / 4 + 0.99)));
  // long service line for doubles
  g.add(line(wid, lw, 0, -(len / 2 - 0.76), 0, 0x9fb3c8));
  g.add(line(wid, lw, 0,  (len / 2 - 0.76), 0, 0x9fb3c8));
  scene.add(g);

  // net
  const net = new THREE.Mesh(
    new THREE.PlaneGeometry(wid + 0.1, COURT.netH - 0.75),
    new THREE.MeshBasicMaterial({ color: 0xcfd8e3, transparent: true, opacity: 0.16,
                                  side: THREE.DoubleSide, depthWrite: false }));
  net.position.set(0, 0.75 + (COURT.netH - 0.75) / 2, 0);
  scene.add(net);
  const tape = new THREE.Mesh(
    new THREE.BoxGeometry(wid + 0.1, 0.05, 0.02),
    new THREE.MeshBasicMaterial({ color: 0xffffff }));
  tape.position.set(0, COURT.netH, 0);
  scene.add(tape);
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, COURT.netPostH, 10),
      new THREE.MeshStandardMaterial({ color: 0x8e9aa6 }));
    post.position.set(s * (wid / 2 + 0.05), COURT.netPostH / 2, 0);
    scene.add(post);
  }

  // hall walls, kept dim so the court reads as the lit object
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x1b262e, roughness: 1,
                                                   side: THREE.BackSide });
  const walls = new THREE.Mesh(new THREE.BoxGeometry(26, 9, 44), wallMat);
  walls.position.y = 4.5 - 0.15;   // drop the box so its floor face sits below the court
  scene.add(walls);

  scene.add(new THREE.HemisphereLight(0xcfe4f5, 0x24503c, 1.15));
  const key = new THREE.DirectionalLight(0xffffff, 1.35);
  key.position.set(4, 11, 6);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xbfd8ee, 0.5);
  fill.position.set(-6, 7, -8);
  scene.add(fill);
  return g;
}

/** Target zone the player is aiming at, drawn on the far court. */
export function buildTarget(scene, { x = 0, z = -4.6, w = 1.7, d = 2.2 } = {}) {
  const grp = new THREE.Group();
  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshBasicMaterial({ color: 0x3fd08a, transparent: true, opacity: 0.17 }));
  fill.rotation.x = -Math.PI / 2; fill.position.y = 0.02;
  grp.add(fill);
  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(w, d)),
    new THREE.LineBasicMaterial({ color: 0x3fd08a }));
  edge.rotation.x = -Math.PI / 2; edge.position.y = 0.025;
  grp.add(edge);
  grp.position.set(x, 0, z);
  grp.userData = { x, z, w, d };
  scene.add(grp);
  return grp;
}
