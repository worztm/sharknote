// HeroScene: a floating knowledge-graph in 3D — Sharknote's core feature as the
// site's visual. Inspired by the hero scenes on threejs.org, linear.app and
// vercel.com: one restrained object, slow drift, pointer parallax, no clutter.
import { useEffect, useRef } from "react";
import * as THREE from "three";

export default function HeroScene() {
  const mountRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, mount.clientWidth / mount.clientHeight, 0.1, 100);
    camera.position.set(0, 0, 11);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    // ---------- graph: nodes on a sphere + connections between near pairs ----------
    const group = new THREE.Group();
    scene.add(group);

    const NODE_COUNT = 42;
    const ACCENT = new THREE.Color(0x8b5cf6);
    const INK = new THREE.Color(0x2a2a31);

    const positions = [];
    // fibonacci sphere for even distribution
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < NODE_COUNT; i++) {
      const y = 1 - (i / (NODE_COUNT - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const theta = golden * i;
      positions.push(new THREE.Vector3(Math.cos(theta) * r * 3.4, y * 2.4, Math.sin(theta) * r * 3.4));
    }

    const nodeGeo = new THREE.SphereGeometry(0.09, 20, 20);
    const nodeMat = new THREE.MeshBasicMaterial({ color: INK });
    const accentMat = new THREE.MeshBasicMaterial({ color: ACCENT });
    const nodes = positions.map((p, i) => {
      // a few accent nodes catch the eye, like pinned notes
      const m = new THREE.Mesh(nodeGeo, i % 9 === 0 ? accentMat : nodeMat);
      m.position.copy(p);
      group.add(m);
      return m;
    });

    // connections: link each node to its 2 nearest neighbours
    const lineMat = new THREE.LineBasicMaterial({ color: 0x35353d, transparent: true, opacity: 0.55 });
    const linePositions = [];
    positions.forEach((p, i) => {
      const dists = positions
        .map((q, j) => ({ j, d: p.distanceTo(q) }))
        .filter((x) => x.j !== i)
        .sort((a, b) => a.d - b.d)
        .slice(0, 2);
      dists.forEach(({ j }) => {
        linePositions.push(p, positions[j]);
      });
    });
    const lineGeo = new THREE.BufferGeometry().setFromPoints(linePositions);
    group.add(new THREE.LineSegments(lineGeo, lineMat));

    // a slowly orbiting accent ring marks the "current" note
    const ringMat = new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.85 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.015, 12, 60), ringMat);
    ring.position.copy(positions[0]);
    group.add(ring);

    // pointer parallax: the whole graph leans toward the cursor
    const pointer = { x: 0, y: 0 };
    const onMove = (e) => {
      const rect = mount.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
      pointer.y = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
    };
    window.addEventListener("pointermove", onMove);

    const onResize = () => {
      if (!mount.clientWidth) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener("resize", onResize);

    let raf = 0;
    const clock = new THREE.Clock();
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const t = clock.getElapsedTime();

      group.rotation.y = t * 0.12 + pointer.x * 0.25;
      group.rotation.x = Math.sin(t * 0.18) * 0.08 - pointer.y * 0.18;

      // nodes breathe individually
      nodes.forEach((n, i) => {
        const s = 1 + Math.sin(t * 1.4 + i * 0.7) * 0.12;
        n.scale.setScalar(s);
      });

      // the accent ring hops between nodes every few seconds
      const active = Math.floor(t / 3) % NODE_COUNT;
      ring.position.lerp(positions[active], 0.06);
      ring.lookAt(camera.position);
      ring.rotation.z = t * 0.8;

      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      nodeGeo.dispose();
      lineGeo.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={mountRef} className="hero-3d" aria-hidden="true" />;
}
