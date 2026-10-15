import * as THREE from "three";

/*
 * Extra detail on the detailed robot model (see GlbArm.tsx). The model's big surfaces are smooth: the three black joint drums
 * and the white forearm and wrist read as empty areas. Everything here is measured from the model itself in each joint's own
 * frame, is a child of that joint (so it turns with it) and is our simplification, not a measured part.
 */

/**
 * The model's three big dark joint drums (shoulder, elbow, wrist) are smooth cylinders: from the side they read as empty black
 * areas on either side of the white arm. This adds the details a real joint housing has, all measured from the drum itself:
 * a satin band and parting grooves round the circumference, rows of cooling slots, a cable-gland boss and a name plate. Our
 * simplification, not a measured part. Everything is a child of the drum's own parent, so it turns with the joint.
 */
type Kit = { groove: THREE.Material; satin: THREE.Material; plate: THREE.Material; slot: THREE.Material; rubber: THREE.Material };

function detailDrum(root: THREE.Object3D, name: string, kit: Kit) {
  const hub = root.getObjectByName(name) as THREE.Mesh | undefined;
  if (!hub || !hub.parent) return;
  // measured in the joint's own frame (the drum's matrix is relative to its joint node), so it does not depend on where the robot stands
  hub.updateMatrix();
  hub.geometry.computeBoundingBox();
  const box = hub.geometry.boundingBox!.clone().applyMatrix4(hub.matrix);
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  const R = Math.min(size.y, size.z) / 2; // drum radius
  const L = size.x / 2; // half length along the joint axis (x)
  const g = new THREE.Group();
  g.position.copy(c);
  g.name = `${name}_detail`;
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, pos: [number, number, number], rot?: [number, number, number]) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...pos);
    if (rot) m.rotation.set(...rot);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  };
  // rings round the drum: a satin band either side of the arm and dark parting grooves outside them
  for (const sx of [-1, 1]) {
    add(new THREE.TorusGeometry(R + 0.0015, 0.0055, 10, 64), kit.satin, [sx * L * 0.58, 0, 0], [0, Math.PI / 2, 0]);
    add(new THREE.TorusGeometry(R + 0.001, 0.0032, 8, 64), kit.groove, [sx * L * 0.76, 0, 0], [0, Math.PI / 2, 0]);
    add(new THREE.TorusGeometry(R + 0.001, 0.0032, 8, 64), kit.groove, [sx * L * 0.4, 0, 0], [0, Math.PI / 2, 0]);
  }
  // cooling slots in rows round the drum on both sides (the ones behind the arm are simply hidden by it)
  const slotCount = 14;
  for (const sx of [-1, 1]) {
    for (let i = 0; i < slotCount; i++) {
      const a = (i / slotCount) * Math.PI * 2 + (sx > 0 ? 0.11 : 0);
      for (const dx of [0.66, 0.7]) {
        add(new THREE.BoxGeometry(0.012, 0.0035, 0.034), kit.slot, [sx * L * dx, Math.sin(a) * (R + 0.0005), Math.cos(a) * (R + 0.0005)], [Math.PI / 2 - a, 0, 0]);
      }
    }
  }
  // a cable-gland boss and a name plate on the back of the drum, on the side where the arm does not reach
  const backA = Math.PI; // -z
  const nx = L * 0.5;
  add(new THREE.CylinderGeometry(0.014, 0.016, 0.026, 18), kit.satin, [-nx, Math.sin(backA) * (R + 0.01), Math.cos(backA) * (R + 0.01)], [Math.PI / 2 - backA, 0, 0]);
  add(new THREE.BoxGeometry(0.05, 0.003, 0.03), kit.plate, [nx, Math.sin(backA) * (R + 0.0015), Math.cos(backA) * (R + 0.0015)], [Math.PI / 2 - backA, 0, 0]);
  hub.parent.add(g);
}


/** Mirror an existing mesh across the arm's centre plane (x = 0 in its joint frame) and add it next to the original: the model has the cover plate and gasket on one side of the forearm only. */
function mirrorMesh(root: THREE.Object3D, name: string) {
  const m = root.getObjectByName(name) as THREE.Mesh | undefined;
  if (!m || !m.parent || root.getObjectByName(`${name}_mirror`)) return;
  const c = m.clone();
  c.name = `${name}_mirror`;
  m.updateMatrix();
  c.matrix.copy(m.matrix).premultiply(new THREE.Matrix4().makeScale(-1, 1, 1));
  c.matrix.decompose(c.position, c.quaternion, c.scale);
  m.parent.add(c);
}

/** A ring round a part whose axis is z in its joint's frame: a dark groove or a satin band at height z. */
function ringZ(g: THREE.Group, mat: THREE.Material, r: number, tube: number, z: number) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, 64), mat);
  m.position.set(0, 0, z);
  m.castShadow = true;
  g.add(m);
}

/** The wrist housing (white, along z): parting grooves, a satin band and a connector with its cap on top. */
function detailWristHousing(root: THREE.Object3D, kit: Kit) {
  const hs = root.getObjectByName("roll_housing") as THREE.Mesh | undefined;
  if (!hs || !hs.parent || root.getObjectByName("roll_housing_detail")) return;
  hs.updateMatrix();
  hs.geometry.computeBoundingBox();
  const box = hs.geometry.boundingBox!.clone().applyMatrix4(hs.matrix);
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  const R = Math.min(size.x, size.y) / 2;
  const L = size.z / 2;
  const g = new THREE.Group();
  g.name = "roll_housing_detail";
  g.position.copy(c);
  ringZ(g, kit.groove, R + 0.0008, 0.0032, -L * 0.55);
  ringZ(g, kit.satin, R + 0.0012, 0.0052, -L * 0.3);
  ringZ(g, kit.groove, R + 0.0008, 0.0032, L * 0.2);
  ringZ(g, kit.satin, R + 0.0012, 0.0052, L * 0.62);
  // connector on top: boss, threaded nut and a dust cap,
  const top = new THREE.Group();
  top.position.set(0, R, -L * 0.05);
  const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.024, 0.018, 20), kit.satin);
  boss.position.y = 0.004;
  top.add(boss);
  const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.014, 6), kit.plate);
  nut.position.y = 0.019;
  top.add(nut);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.014, 0.012, 18), kit.rubber);
  cap.position.y = 0.032;
  top.add(cap);
  g.add(top);
  hs.parent.add(g);
}

/** Detail for the detailed robot: the three black drums, the other side of the forearm and the wrist housing. Safe to call once per cloned model. */
export function detailRobot(root: THREE.Object3D) {
  const kit: Kit = {
    groove: new THREE.MeshStandardMaterial({ color: "#07090a", roughness: 0.95, metalness: 0.05 }),
    satin: new THREE.MeshStandardMaterial({ color: "#b4bcc0", roughness: 0.38, metalness: 0.85 }),
    plate: new THREE.MeshStandardMaterial({ color: "#d3d8da", roughness: 0.3, metalness: 0.9 }),
    slot: new THREE.MeshStandardMaterial({ color: "#050607", roughness: 0.9, metalness: 0.1 }),
    rubber: new THREE.MeshStandardMaterial({ color: "#121516", roughness: 0.85, metalness: 0.05 }),
  };
  for (const name of ["shoulder_hub", "elbow_hub", "wrist_hub"]) if (!root.getObjectByName(`${name}_detail`)) detailDrum(root, name, kit);
  for (const name of ["forearm_cover", "forearm_gasket", "forearm_cover_screws", "forearm_cover_screws_sockets"]) mirrorMesh(root, name);
  detailWristHousing(root, kit);
}
