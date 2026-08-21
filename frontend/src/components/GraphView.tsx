import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  Loader2,
  Maximize2,
  RefreshCw,
  Search,
  Waypoints,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationNodeDatum,
} from "d3-force";
import { NoteService } from "../../bindings/sharknote";
import type { GraphData, GraphEdge, GraphNode } from "../../bindings/sharknote";
import type { AppSettings } from "../lib/settings";
import { graphPalette, type GraphPalette } from "../lib/graphThemes";

interface GNode extends SimulationNodeDatum {
  id: number;
  title: string;
  linkCount: number;
  x: number;
  y: number;
}

interface GLink {
  source: number | GNode;
  target: number | GNode;
}

interface Transform {
  x: number;
  y: number;
  k: number;
}

/** A drifting, twinkling dust mote in screen space. */
interface Dust {
  fx: number; // 0..1 fraction of width
  fy: number; // 0..1 fraction of height
  r: number;
  phase: number;
}

const NODE_BASE = 3.6;
const NODE_GROWTH = 0.7;
const EDGE_CURVE = 0.09;

function nodeRadius(n: Pick<GNode, "linkCount">): number {
  return NODE_BASE + Math.min(n.linkCount, 12) * NODE_GROWTH;
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/** Gentle perpendicular control point so edges bow like organic fibers. */
function edgeCurve(s: GNode, t: GNode, amount: number): { cx: number; cy: number } {
  const dx = t.x - s.x;
  const dy = t.y - s.y;
  const len = Math.hypot(dx, dy) || 1;
  const dir = ((s.id + t.id) % 2) * 2 - 1; // deterministic bow direction per pair
  const off = len * amount * dir;
  return { cx: (s.x + t.x) / 2 - (dy / len) * off, cy: (s.y + t.y) / 2 + (dx / len) * off };
}

/** Point on the same quadratic curve at parameter u ∈ [0,1]. */
function quadPoint(s: GNode, c: { cx: number; cy: number }, t: GNode, u: number) {
  const i = 1 - u;
  return {
    x: i * i * s.x + 2 * i * u * c.cx + u * u * t.x,
    y: i * i * s.y + 2 * i * u * c.cy + u * u * t.y,
  };
}

export function GraphView({
  activeId,
  onOpenNote,
  onBack,
  theme,
  graphTheme,
}: {
  activeId: number | null;
  onOpenNote: (id: number) => void;
  onBack: () => void;
  theme: AppSettings["theme"];
  graphTheme: AppSettings["graphTheme"];
}) {
  const palette: GraphPalette = useMemo(
    () => graphPalette(graphTheme, theme === "light"),
    [graphTheme, theme]
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chipRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<Simulation<GNode, undefined> | null>(null);
  const nodesRef = useRef<GNode[]>([]);
  const linksRef = useRef<GLink[]>([]);
  const adjacencyRef = useRef<Map<number, Set<number>>>(new Map());
  const transformRef = useRef<Transform>({ x: 0, y: 0, k: 1 });
  const fittedRef = useRef(false);
  // Entrance choreography: when the scene fades in and nodes "birth" in.
  const sceneStartRef = useRef(performance.now());
  const birthRef = useRef<Map<number, number>>(new Map());
  const fitAnimRef = useRef<{ from: Transform; to: Transform; start: number } | null>(null);
  const dustRef = useRef<Dust[]>([]);
  const draggingRef = useRef<{ node: GNode | null; moved: boolean; lastX: number; lastY: number }>({
    node: null,
    moved: false,
    lastX: 0,
    lastY: 0,
  });
  const hoveredRef = useRef<number | null>(null);
  const activeIdRef = useRef<number | null>(activeId);
  activeIdRef.current = activeId;

  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Ambient dust particles (golden-ratio spread so they never clump)
  useEffect(() => {
    dustRef.current = Array.from({ length: 42 }, (_, i) => ({
      fx: (i * 0.6180339887) % 1,
      fy: (i * 0.52786) % 1,
      r: 0.5 + ((i * 37) % 10) / 10,
      phase: i / 42,
    }));
  }, []);

  // Load graph data
  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(false);
    NoteService.GetGraph()
      .then((g) => {
        if (!cancelled) setData(g);
      })
      .catch((err) => {
        console.error("GetGraph failed", err);
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // Build the simulation whenever data arrives
  useEffect(() => {
    if (!data) return;

    const nodes: GNode[] = (data.nodes ?? []).map((n: GraphNode) => ({
      id: n.id,
      title: n.title,
      linkCount: n.linkCount,
      x: 0,
      y: 0,
    }));
    const links: GLink[] = (data.edges ?? []).map((e: GraphEdge) => ({
      source: e.source,
      target: e.target,
    }));

    // Adjacency map for neighbor highlighting
    const adj = new Map<number, Set<number>>();
    for (const n of nodes) adj.set(n.id, new Set());
    for (const l of links) {
      const s = l.source as number;
      const t = l.target as number;
      adj.get(s)?.add(t);
      adj.get(t)?.add(s);
    }

    const sim = forceSimulation<GNode>(nodes)
      .force(
        "link",
        forceLink<GNode, GLink>(links)
          .id((d) => d.id)
          .distance(92)
          .strength(0.5)
      )
      .force("charge", forceManyBody<GNode>().strength(-360).distanceMax(900))
      .force("center", forceCenter<GNode>(0, 0))
      .force("collide", forceCollide<GNode>().radius((d) => nodeRadius(d) + 14))
      .force("x", forceX<GNode>(0).strength(0.04))
      .force("y", forceY<GNode>(0).strength(0.04))
      .alpha(1)
      .alphaDecay(0.024)
      .velocityDecay(0.33);

    simRef.current = sim;
    nodesRef.current = nodes;
    linksRef.current = links;
    adjacencyRef.current = adj;
    fittedRef.current = false;
    fitAnimRef.current = null;

    // Entrance: stagger each node's birth a little, then fade the scene in.
    sceneStartRef.current = performance.now() + 100;
    const step = nodes.length > 80 ? 6 : 16;
    const births = new Map<number, number>();
    nodes.forEach((n, i) => births.set(n.id, sceneStartRef.current + i * step));
    birthRef.current = births;

    return () => {
      sim.stop();
      simRef.current = null;
    };
  }, [data]);

  // Draw loop
  useEffect(() => {
    let raf = 0;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const drawBackground = (w: number, h: number, now: number) => {
      // Breathing aurora nebulas
      const t = now / 9000;
      const g1 = ctx.createRadialGradient(w * 0.22, h * 0.26, 0, w * 0.22, h * 0.26, Math.max(w, h) * 0.95);
      g1.addColorStop(0, `${palette.auroraA} / ${(0.16 + 0.05 * Math.sin(t)).toFixed(3)})`);
      g1.addColorStop(1, `${palette.auroraA} / 0)`);
      const g2 = ctx.createRadialGradient(w * 0.85, h * 0.78, 0, w * 0.85, h * 0.78, Math.max(w, h) * 0.9);
      g2.addColorStop(0, `${palette.auroraB} / ${(0.12 + 0.04 * Math.sin(t * 0.8 + 2)).toFixed(3)})`);
      g2.addColorStop(1, `${palette.auroraB} / 0)`);
      ctx.fillStyle = g1;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, w, h);

      // Twinkling dust motes
      for (const d of dustRef.current) {
        const tw = 0.5 + 0.5 * Math.sin(now / (1600 + d.phase * 900) + d.phase * 6.28);
        ctx.beginPath();
        ctx.arc(d.fx * w, d.fy * h + Math.sin(now / 5000 + d.phase) * 8, d.r, 0, Math.PI * 2);
        ctx.fillStyle = `${palette.dust} / ${(0.04 + 0.09 * tw).toFixed(3)})`;
        ctx.fill();
      }
    };

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const now = performance.now();

      // Smooth camera fit animation
      const fa = fitAnimRef.current;
      if (fa) {
        const p = Math.min(1, (now - fa.start) / 750);
        const e = easeOutCubic(p);
        const tr = transformRef.current;
        tr.x = fa.from.x + (fa.to.x - fa.from.x) * e;
        tr.y = fa.from.y + (fa.to.y - fa.from.y) * e;
        tr.k = fa.from.k + (fa.to.k - fa.from.k) * e;
        if (p >= 1) fitAnimRef.current = null;
      }

      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
      }
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, rect.width, rect.height);
      drawBackground(rect.width, rect.height, now);

      const t = transformRef.current;
      const k = t.k;
      const sceneAlpha = Math.min(1, (now - sceneStartRef.current) / 700);
      if (sceneAlpha > 0) {
        ctx.globalAlpha = sceneAlpha;
        ctx.save();
        ctx.translate(t.x, t.y);
        ctx.scale(k, k);
        ctx.lineCap = "round";

        const nodes = nodesRef.current;
        const links = linksRef.current;
        const adj = adjacencyRef.current;
        const hovered = hoveredRef.current;
        const active = activeIdRef.current;
        const rich = nodes.length <= 350;

        // Neighbor set for highlighting
        const hot = new Set<number>();
        if (hovered != null) {
          for (const n of adj.get(hovered) ?? []) hot.add(n);
          hot.add(hovered);
        }
        if (active != null) {
          for (const n of adj.get(active) ?? []) hot.add(n);
          hot.add(active);
        }
        const dimmed = hovered != null || active != null;

        // ---- Edges: soft glow underlay + crisp core, gently curved ----
        ctx.beginPath();
        for (const l of links) {
          const s = l.source as GNode;
          const t2 = l.target as GNode;
          if (!s || !t2) continue;
          const c = edgeCurve(s, t2, EDGE_CURVE);
          ctx.moveTo(s.x, s.y);
          ctx.quadraticCurveTo(c.cx, c.cy, t2.x, t2.y);
        }
        ctx.strokeStyle = dimmed ? palette.edgeGlowDim : palette.edgeGlow;
        ctx.lineWidth = 3 / k;
        ctx.stroke();

        ctx.beginPath();
        for (const l of links) {
          const s = l.source as GNode;
          const t2 = l.target as GNode;
          if (!s || !t2) continue;
          const c = edgeCurve(s, t2, EDGE_CURVE);
          ctx.moveTo(s.x, s.y);
          ctx.quadraticCurveTo(c.cx, c.cy, t2.x, t2.y);
        }
        ctx.strokeStyle = dimmed ? palette.edgeCoreDim : palette.edgeCore;
        ctx.lineWidth = 1.1 / k;
        ctx.stroke();

        // ---- Hot edges: crimson glow + traveling energy pulses ----
        const hotEdges: { s: GNode; t: GNode; c: { cx: number; cy: number } }[] = [];
        if (hovered != null || active != null) {
          ctx.beginPath();
          for (const l of links) {
            const s = l.source as GNode;
            const t2 = l.target as GNode;
            if (!s || !t2) continue;
            if (hot.has(s.id) && hot.has(t2.id)) {
              const c = edgeCurve(s, t2, EDGE_CURVE);
              hotEdges.push({ s, t: t2, c });
              ctx.moveTo(s.x, s.y);
              ctx.quadraticCurveTo(c.cx, c.cy, t2.x, t2.y);
            }
          }
          ctx.strokeStyle = hovered != null ? palette.hotEdge : palette.hotEdgeSoft;
          ctx.lineWidth = 3.2 / k;
          ctx.stroke();

          ctx.beginPath();
          for (const he of hotEdges) {
            ctx.moveTo(he.s.x, he.s.y);
            ctx.quadraticCurveTo(he.c.cx, he.c.cy, he.t.x, he.t.y);
          }
          ctx.strokeStyle = hovered != null ? palette.hotEdgeCore : palette.hotEdgeCoreSoft;
          ctx.lineWidth = 1.4 / k;
          ctx.stroke();

          // Pulses only when hovering — the network "lights up" around a node
          if (hovered != null) {
            for (const he of hotEdges) {
              const offset = ((he.s.id + he.t.id) % 7) * 0.045;
              for (let i = 0; i < 2; i++) {
                const u = ((now / 1600 + i * 0.5 + offset) % 1);
                const p = quadPoint(he.s, he.c, he.t, u);
                const fade = Math.sin(u * Math.PI);
                ctx.beginPath();
                ctx.arc(p.x, p.y, (1.8 * fade + 0.6) / k, 0, Math.PI * 2);
                ctx.fillStyle = `${palette.pulse} / ${(0.75 * fade).toFixed(3)})`;
                ctx.fill();
              }
            }
          }
        }

        // ---- Nodes: glossy orbs with halos and rings ----
        const showLabels = k > 0.55;
        const labelFont = `500 11px "Inter Variable", ui-sans-serif, sans-serif`;
        const births = birthRef.current;

        for (const n of nodes) {
          const r0 = nodeRadius(n);
          const bp = Math.min(1, (now - (births.get(n.id) ?? sceneStartRef.current)) / 550);
          const r = r0 * easeOutCubic(bp);
          if (r <= 0.01) continue;

          const isHover = hovered === n.id;
          const isActive = active === n.id;
          const connected = hot.has(n.id);
          const dimmedNode = dimmed && !connected;
          const hotNode = isActive || isHover || (dimmed && connected);

          // Cull off-screen nodes (world → screen check)
          const sx = n.x * k + t.x;
          const sy = n.y * k + t.y;
          if (sx < -60 || sx > rect.width + 60 || sy < -60 || sy > rect.height + 60) continue;

          // Halo bloom
          if (hotNode) {
            const haloColor = isActive
              ? palette.haloActive
              : isHover
                ? palette.haloHover
                : palette.haloConnected;
            const halo = ctx.createRadialGradient(n.x, n.y, r * 0.4, n.x, n.y, r * 2.9);
            halo.addColorStop(0, `${haloColor} / ${isHover ? 0.4 : 0.3})`);
            halo.addColorStop(1, `${haloColor} / 0)`);
            ctx.beginPath();
            ctx.arc(n.x, n.y, r * 2.9, 0, Math.PI * 2);
            ctx.fillStyle = halo;
            ctx.fill();
          }

          // Orb body
          if (dimmedNode) {
            ctx.beginPath();
            ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
            ctx.fillStyle = palette.dimNode;
            ctx.fill();
          } else {
            const [top, main, rim] = isActive ? palette.orbActive : isHover ? palette.orbHover : palette.orbIdle;
            if (rich) {
              const g = ctx.createRadialGradient(n.x - r * 0.4, n.y - r * 0.45, r * 0.15, n.x, n.y, r * 1.15);
              g.addColorStop(0, top);
              g.addColorStop(0.5, main);
              g.addColorStop(1, rim);
              ctx.fillStyle = g;
            } else {
              ctx.fillStyle = main;
            }
            ctx.beginPath();
            ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
            ctx.fill();
          }

          // Glossy rim light (top-left arc)
          if (r >= 3.4 && !dimmedNode) {
            ctx.beginPath();
            ctx.arc(n.x, n.y, r - 0.4 / k, -2.35, -0.75);
            ctx.strokeStyle = "oklch(1 0 0 / 0.25)";
            ctx.lineWidth = 1 / k;
            ctx.stroke();
          }

          // Rings: active note breathes, hovered note glows
          if (isActive) {
            const pulse = (now / 1800) % 1;
            const pr = r + 3 + pulse * 13;
            ctx.beginPath();
            ctx.arc(n.x, n.y, pr, 0, Math.PI * 2);
            ctx.strokeStyle = `${palette.ringPulse} / ${((1 - pulse) * 0.55).toFixed(3)})`;
            ctx.lineWidth = 1.5 / k;
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(n.x, n.y, r + 2.5, 0, Math.PI * 2);
            ctx.strokeStyle = palette.ringStatic;
            ctx.lineWidth = 1.4 / k;
            ctx.stroke();
          } else if (isHover) {
            ctx.beginPath();
            ctx.arc(n.x, n.y, r + 2.5, 0, Math.PI * 2);
            ctx.strokeStyle = palette.ringHover;
            ctx.lineWidth = 1.5 / k;
            ctx.stroke();
          }

          // Label — on large zoomed-out graphs only label well-connected
          // nodes up front; hovering still reveals any label.
          const labelMe =
            (isHover ||
              isActive ||
              (showLabels && (nodes.length <= 60 || n.linkCount >= 2))) &&
            bp > 0.45;
          if (labelMe) {
            const labelDim = dimmed && !connected;
            ctx.font = labelFont;
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.fillStyle = labelDim
              ? palette.labelDim
              : isActive || isHover
                ? palette.labelBright
                : palette.label;
            const tx = n.x + r + 5;
            if (isActive || isHover) {
              ctx.lineWidth = 3 / k;
              ctx.strokeStyle = palette.labelStroke;
              ctx.strokeText(n.title, tx, n.y);
            }
            ctx.fillText(n.title, tx, n.y);
          }
        }

        ctx.restore();
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    };
    draw();
    return () => cancelAnimationFrame(raf);
    // Restart the loop when the palette changes so the canvas recolors
    // immediately (theme / graph-theme switch in settings).
  }, [palette]);

  // Fit camera to the graph once it has spread out, focusing the active note.
  /** Computes a camera transform that frames the whole graph, biased toward
   *  the active note when one exists. */
  const computeFit = useCallback((): Transform | null => {
    const nodes = nodesRef.current;
    if (nodes.length === 0) return null;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y);
      maxY = Math.max(maxY, n.y);
    }
    const w = Math.max(maxX - minX, 10);
    const h = Math.max(maxY - minY, 10);
    const k = Math.max(0.12, Math.min(rect.width / (w + 160), rect.height / (h + 160), 1.6));
    const focus = activeIdRef.current;
    const target = focus != null ? nodes.find((n) => n.id === focus) ?? null : null;
    const cx = target ? target.x : (minX + maxX) / 2;
    const cy = target ? target.y : (minY + maxY) / 2;
    return { k, x: rect.width / 2 - cx * k, y: rect.height / 2 - cy * k };
  }, []);

  /** Animates the camera to frame the whole graph. */
  const fitView = useCallback(() => {
    const to = computeFit();
    if (!to) return;
    fitAnimRef.current = {
      from: { ...transformRef.current },
      to,
      start: performance.now(),
    };
  }, [computeFit]);

  /** Zooms around the canvas centre by a multiplicative factor. */
  const zoomBy = useCallback((factor: number) => {
    fitAnimRef.current = null;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const t = transformRef.current;
    const px = rect.width / 2;
    const py = rect.height / 2;
    const k2 = Math.min(4, Math.max(0.12, t.k * factor));
    t.x = px - ((px - t.x) * k2) / t.k;
    t.y = py - ((py - t.y) * k2) / t.k;
    t.k = k2;
  }, []);

  /** Glides the camera so the given node sits centred and legible. */
  const focusNode = useCallback((id: number) => {
    const n = nodesRef.current.find((m) => m.id === id);
    if (!n) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const k = Math.max(transformRef.current.k, 1.15);
    fitAnimRef.current = {
      from: { ...transformRef.current },
      to: { k, x: rect.width / 2 - n.x * k, y: rect.height / 2 - n.y * k },
      start: performance.now(),
    };
  }, []);

  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;
    const tryFit = () => {
      if (fittedRef.current) return;
      if (sim.alpha() > 0.35) return;
      const nodes = nodesRef.current;
      if (nodes.length === 0) return;
      const to = computeFit();
      if (!to) return;
      // Animate the camera rather than snapping
      fitAnimRef.current = {
        from: { ...transformRef.current },
        to,
        start: performance.now(),
      };
      fittedRef.current = true;
    };
    sim.on("tick", tryFit);
    return () => {
      sim.on("tick", null);
    };
  }, [data, computeFit]);

  // --- Pointer interactions ------------------------------------------------

  const toWorld = useCallback((px: number, py: number) => {
    const t = transformRef.current;
    return { x: (px - t.x) / t.k, y: (py - t.y) / t.k };
  }, []);

  const hitTest = useCallback(
    (wx: number, wy: number): GNode | null => {
      let best: GNode | null = null;
      let bestDist = 14;
      for (const n of nodesRef.current) {
        const dx = n.x - wx;
        const dy = n.y - wy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < bestDist) {
          bestDist = d;
          best = n;
        }
      }
      return best;
    },
    []
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const w = toWorld(px, py);
      const node = hitTest(w.x, w.y);
      const sim = simRef.current;
      e.currentTarget.setPointerCapture(e.pointerId);
      draggingRef.current = { node, moved: false, lastX: px, lastY: py };
      if (node && sim) {
        node.fx = node.x;
        node.fy = node.y;
        sim.alphaTarget(0.35).alpha(0.35).restart();
      }
    },
    [toWorld, hitTest]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const drag = draggingRef.current;
      const t = transformRef.current;

      if (drag.node) {
        const w = toWorld(px, py);
        drag.node.fx = w.x;
        drag.node.fy = w.y;
        if (Math.abs(px - drag.lastX) + Math.abs(py - drag.lastY) > 2) {
          drag.moved = true;
        }
        return;
      }

      if (e.buttons > 0) {
        // Pan
        t.x += px - drag.lastX;
        t.y += py - drag.lastY;
        drag.lastX = px;
        drag.lastY = py;
        return;
      }

      // Hover
      const w = toWorld(px, py);
      const node = hitTest(w.x, w.y);
      hoveredRef.current = node ? node.id : null;
      e.currentTarget.style.cursor = node ? "pointer" : "grab";
      // Floating chip — clamped on both axes so it never leaves the canvas
      const chip = chipRef.current;
      if (chip) {
        if (node) {
          chip.style.opacity = "1";
          const cw = chip.offsetWidth || 190;
          const ch = chip.offsetHeight || 44;
          const cx = Math.max(8, Math.min(px + 14, rect.width - cw - 8));
          const cy = py - ch - 10 > 8 ? py - ch - 10 : py + 18;
          chip.style.transform = `translate(${cx}px, ${cy}px)`;
          chip.querySelector("[data-chip-title]")!.textContent = node.title;
          chip.querySelector("[data-chip-meta]")!.textContent =
            `${node.linkCount} link${node.linkCount === 1 ? "" : "s"}`;
        } else {
          chip.style.opacity = "0";
        }
      }
    },
    [toWorld, hitTest]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = draggingRef.current;
      const sim = simRef.current;
      if (drag.node) {
        if (sim) sim.alphaTarget(0);
        drag.node.fx = null;
        drag.node.fy = null;
        if (!drag.moved) onOpenNote(drag.node.id);
      }
      draggingRef.current = { node: null, moved: false, lastX: 0, lastY: 0 };
    },
    [onOpenNote]
  );

  const onWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    // User takes over — cancel any camera animation
    fitAnimRef.current = null;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const t = transformRef.current;
    const factor = Math.exp(-e.deltaY * 0.0012);
    const k2 = Math.min(4, Math.max(0.12, t.k * factor));
    t.x = px - ((px - t.x) * k2) / t.k;
    t.y = py - ((py - t.y) * k2) / t.k;
    t.k = k2;
  }, []);

  // Double-click on empty canvas reframes the whole graph.
  const onDoubleClickCanvas = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const w = toWorld(e.clientX - rect.left, e.clientY - rect.top);
      if (!hitTest(w.x, w.y)) fitView();
    },
    [toWorld, hitTest, fitView]
  );

  // --- Node search ---------------------------------------------------------

  const [search, setSearch] = useState("");
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !data) return [];
    return (data.nodes ?? [])
      .filter((n: GraphNode) => n.title.toLowerCase().includes(q))
      .slice(0, 7);
  }, [search, data]);

  const selectSearchResult = useCallback(
    (id: number) => {
      hoveredRef.current = id;
      focusNode(id);
      setSearch("");
    },
    [focusNode]
  );

  const nodeCount = data?.nodes?.length ?? 0;
  const edgeCount = data?.edges?.length ?? 0;

  return (
    <div ref={containerRef} className="relative h-full min-w-0 flex-1 overflow-hidden bg-background">
      <canvas
        ref={canvasRef}
        className="graph-canvas absolute inset-0 h-full w-full"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          hoveredRef.current = null;
          if (chipRef.current) chipRef.current.style.opacity = "0";
        }}
        onWheel={onWheel}
        onDoubleClick={onDoubleClickCanvas}
      />

      {/* Subtle vignette for depth */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(ellipse 80% 70% at 50% 40%, transparent 50%, ${palette.vignette} 100%)`,
        }}
      />

      {/* Floating chip (hovered note) */}
      <div
        ref={chipRef}
        className="pointer-events-none absolute left-0 top-0 z-20 rounded-lg border bg-popover/90 px-3 py-1.5 opacity-0 shadow-xl shadow-black/40 backdrop-blur transition-opacity duration-100"
        style={{ borderColor: palette.accentSoft }}
      >
        <div data-chip-title className="max-w-[180px] truncate text-[12.5px] font-semibold text-foreground" />
        <div data-chip-meta className="text-[10.5px]" style={{ color: palette.accentText }} />
      </div>

      {/* Toolbar */}
      <div className="absolute left-4 top-4 z-20 flex items-center gap-2">
        <button
          onClick={onBack}
          title="Back to notes"
          className="flex size-9 items-center justify-center rounded-xl border border-border bg-card/80 text-muted-foreground shadow-lg shadow-black/30 backdrop-blur transition hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
        </button>
        <div className="flex items-center gap-2.5 rounded-xl border border-border bg-card/80 px-3.5 py-2 shadow-lg shadow-black/30 backdrop-blur">
          <Waypoints className="size-4" style={{ color: palette.accent }} />
          <div className="leading-tight">
            <div className="text-[12.5px] font-semibold tracking-tight text-foreground">
              Knowledge graph
            </div>
            <div className="text-[10.5px] tabular-nums text-muted-foreground">
              {data ? `${nodeCount} notes · ${edgeCount} links` : "loading…"}
            </div>
          </div>
        </div>
        <button
          onClick={() => setReloadKey((k) => k + 1)}
          title="Reload graph"
          className="flex size-9 items-center justify-center rounded-xl border border-border bg-card/80 text-muted-foreground shadow-lg shadow-black/30 backdrop-blur transition hover:bg-accent hover:text-foreground"
        >
          <RefreshCw className="size-4" />
        </button>
      </div>

      {/* Node search */}
      <div className="absolute right-4 top-4 z-20 w-60">
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card/80 px-3 py-2 shadow-lg shadow-black/30 backdrop-blur">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setSearch("");
              if (e.key === "Enter" && searchResults.length > 0) {
                selectSearchResult(searchResults[0].id);
              }
            }}
            placeholder="Find a note…"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground/70"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              title="Clear"
              className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground transition hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        {searchResults.length > 0 && (
          <div className="mt-1 overflow-hidden rounded-xl border border-border bg-popover/95 p-1 shadow-xl shadow-black/40 backdrop-blur">
            {searchResults.map((n) => (
              <button
                key={n.id}
                onClick={() => selectSearchResult(n.id)}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-accent"
              >
                <Waypoints className="size-3 shrink-0" style={{ color: palette.accent }} />
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">
                  {n.title}
                </span>
                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                  {n.linkCount}
                </span>
              </button>
            ))}
          </div>
        )}
        {search.trim() && searchResults.length === 0 && data && (
          <div className="mt-1 rounded-xl border border-border bg-popover/95 px-3 py-2 text-[12px] text-muted-foreground shadow-xl backdrop-blur">
            No notes match “{search.trim()}”.
          </div>
        )}
      </div>

      {/* Zoom controls */}
      <div className="absolute bottom-12 right-4 z-20 flex flex-col overflow-hidden rounded-xl border border-border bg-card/80 shadow-lg shadow-black/30 backdrop-blur">
        <button
          onClick={() => zoomBy(1.25)}
          title="Zoom in"
          className="flex size-9 items-center justify-center text-muted-foreground transition hover:bg-accent hover:text-foreground"
        >
          <ZoomIn className="size-4" />
        </button>
        <button
          onClick={() => zoomBy(0.8)}
          title="Zoom out"
          className="flex size-9 items-center justify-center border-t border-border text-muted-foreground transition hover:bg-accent hover:text-foreground"
        >
          <ZoomOut className="size-4" />
        </button>
        <button
          onClick={fitView}
          title="Fit graph to view (double-click canvas)"
          className="flex size-9 items-center justify-center border-t border-border text-muted-foreground transition hover:bg-accent hover:text-foreground"
        >
          <Maximize2 className="size-4" />
        </button>
      </div>

      {/* Hint */}
      <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full border border-border bg-card/70 px-4 py-1.5 text-[11px] text-muted-foreground backdrop-blur">
        Drag to pan · Scroll to zoom · Drag a node to rearrange · Click to open · Double-click to fit
      </div>

      {/* Loading / empty / error states */}
      {!data && !error && (
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      )}
      {error && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2">
          <p className="text-sm text-muted-foreground">Could not load the graph.</p>
          <button
            onClick={() => setReloadKey((k) => k + 1)}
            className="text-sm font-medium"
            style={{ color: palette.accent }}
          >
            Try again
          </button>
        </div>
      )}
      {data && nodeCount === 0 && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 text-center">
          <Waypoints className="size-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            Nothing to map yet — create a note and link it with [[wiki links]].
          </p>
        </div>
      )}
    </div>
  );
}
