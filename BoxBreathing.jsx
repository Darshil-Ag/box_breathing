import { useState, useEffect, useRef, useCallback } from "react";
import Counter from "./Counter";
import BlurText from "./BlurText";
import Galaxy from "./Galaxy";
import CircularText from "./CircularText";

// ── Inline Ballpit (Three.js) ─────────────────────────────────────────────────
import {
  Vector3, MeshPhysicalMaterial, InstancedMesh, Clock, AmbientLight,
  SphereGeometry, ShaderChunk, Scene, Color, Object3D, SRGBColorSpace,
  MathUtils, PMREMGenerator, Vector2, WebGLRenderer, PerspectiveCamera,
  PointLight, ACESFilmicToneMapping, Plane, Raycaster
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

// ── Constants ─────────────────────────────────────────────────────────────────
const PHASES = [
  { label: "inhale", edge: "top", duration: 4 },
  { label: "hold", edge: "right", duration: 4 },
  { label: "exhale", edge: "bottom", duration: 4 },
  { label: "hold", edge: "left", duration: 4 },
];
const TOTAL_CYCLES = 4;
const ACCENT = "#7DF9AA";  // electric mint

// ── Per-phase hint text ────────────────────────────────────────────────────────
const HINTS = {
  inhale: { main: "breathe in", sub: "fill every corner of your lungs" },
  exhale: { main: "breathe out", sub: "slowly" },
  hold: { main: "hold your breath", sub: "wait a few seconds" },
};

// Ball colors: purple / white / grey like the reference screenshot
const BALL_COLORS = [0x5533FF, 0x9988FF, 0xffffff, 0xaaaaaa, 0x444455, 0x8866FF];

// ── Ballpit Three.js core (condensed) ─────────────────────────────────────────
const { randFloat: kk, randFloatSpread: EE } = MathUtils;

class SubMaterial extends MeshPhysicalMaterial {
  constructor(p) {
    super(p);
    this.uniforms = {
      thicknessDistortion: { value: 0.1 }, thicknessAmbient: { value: 0 },
      thicknessAttenuation: { value: 0.1 }, thicknessPower: { value: 2 }, thicknessScale: { value: 10 }
    };
    this.defines.USE_UV = "";
    this.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, this.uniforms);
      s.fragmentShader = `uniform float thicknessPower,thicknessScale,thicknessDistortion,thicknessAmbient,thicknessAttenuation;\n` + s.fragmentShader;
      s.fragmentShader = s.fragmentShader.replace("void main() {", `
        void RE_Direct_Scattering(const in IncidentLight dL,const in vec2 uv,const in vec3 gP,const in vec3 gN,const in vec3 gV,const in vec3 gC,inout ReflectedLight rL){
          vec3 sh=normalize(dL.direction+(gN*thicknessDistortion));
          float sd=pow(saturate(dot(gV,-sh)),thicknessPower)*thicknessScale;
          #ifdef USE_COLOR
            vec3 si=(sd+thicknessAmbient)*vColor;
          #else
            vec3 si=(sd+thicknessAmbient)*diffuse;
          #endif
          rL.directDiffuse+=si*thicknessAttenuation*dL.color;
        }
        void main() {`);
      const rep = ShaderChunk.lights_fragment_begin.replaceAll(
        "RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );",
        "RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );\nRE_Direct_Scattering(directLight, vUv, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, reflectedLight);"
      );
      s.fragmentShader = s.fragmentShader.replace("#include <lights_fragment_begin>", rep);
    };
  }
}

const tmpA = new Vector3(), tmpB = new Vector3(), tmpC = new Vector3(),
  tmpD = new Vector3(), tmpE = new Vector3(), tmpF = new Vector3(),
  tmpG = new Vector3(), tmpH = new Vector3(), tmpI = new Vector3(), tmpJ = new Vector3();

class BallPhysics {
  constructor(cfg) {
    this.config = cfg;
    this.positionData = new Float32Array(3 * cfg.count).fill(0);
    this.velocityData = new Float32Array(3 * cfg.count).fill(0);
    this.sizeData = new Float32Array(cfg.count).fill(1);
    this.center = new Vector3();
    this._initPos();
    this._initSizes();
  }
  _initPos() {
    const { config: c, positionData: p } = this;
    this.center.toArray(p, 0);
    for (let i = 1; i < c.count; i++) {
      const b = 3 * i;
      p[b] = EE(2 * c.maxX); p[b + 1] = EE(2 * c.maxY); p[b + 2] = EE(2 * c.maxZ);
    }
  }
  _initSizes() {
    const { config: c, sizeData: s } = this;
    s[0] = c.size0;
    for (let i = 1; i < c.count; i++) s[i] = kk(c.minSize, c.maxSize);
  }
  update(dt) {
    const { config: c, center: cen, positionData: pos, sizeData: sz, velocityData: vel } = this;
    let start = 0;
    if (c.controlSphere0) {
      start = 1;
      tmpA.fromArray(pos, 0); tmpA.lerp(cen, 0.1).toArray(pos, 0);
      tmpD.set(0, 0, 0).toArray(vel, 0);
    }
    for (let i = start; i < c.count; i++) {
      const b = 3 * i;
      tmpB.fromArray(pos, b); tmpE.fromArray(vel, b);
      tmpE.y -= dt.delta * c.gravity * sz[i];
      tmpE.multiplyScalar(c.friction); tmpE.clampLength(0, c.maxVelocity);
      tmpB.add(tmpE); tmpB.toArray(pos, b); tmpE.toArray(vel, b);
    }
    for (let i = start; i < c.count; i++) {
      const b = 3 * i;
      tmpB.fromArray(pos, b); tmpE.fromArray(vel, b);
      const ri = sz[i];
      for (let j = i + 1; j < c.count; j++) {
        const ob = 3 * j;
        tmpC.fromArray(pos, ob); tmpF.fromArray(vel, ob);
        const rj = sz[j];
        tmpG.copy(tmpC).sub(tmpB);
        const dist = tmpG.length(), sumR = ri + rj;
        if (dist < sumR) {
          const ov = sumR - dist;
          tmpH.copy(tmpG).normalize().multiplyScalar(0.5 * ov);
          tmpI.copy(tmpH).multiplyScalar(Math.max(tmpE.length(), 1));
          tmpJ.copy(tmpH).multiplyScalar(Math.max(tmpF.length(), 1));
          tmpB.sub(tmpH); tmpE.sub(tmpI); tmpB.toArray(pos, b); tmpE.toArray(vel, b);
          tmpC.add(tmpH); tmpF.add(tmpJ); tmpC.toArray(pos, ob); tmpF.toArray(vel, ob);
        }
      }
      if (c.controlSphere0) {
        tmpG.copy(tmpA).sub(tmpB);
        const d2 = tmpG.length(), sr0 = ri + sz[0];
        if (d2 < sr0) {
          const df = sr0 - d2;
          tmpH.copy(tmpG.normalize()).multiplyScalar(df);
          tmpI.copy(tmpH).multiplyScalar(Math.max(tmpE.length(), 2));
          tmpB.sub(tmpH); tmpE.sub(tmpI);
        }
      }
      if (Math.abs(tmpB.x) + ri > c.maxX) { tmpB.x = Math.sign(tmpB.x) * (c.maxX - ri); tmpE.x = -tmpE.x * c.wallBounce; }
      if (c.gravity === 0) {
        if (Math.abs(tmpB.y) + ri > c.maxY) { tmpB.y = Math.sign(tmpB.y) * (c.maxY - ri); tmpE.y = -tmpE.y * c.wallBounce; }
      } else if (tmpB.y - ri < -c.maxY) { tmpB.y = -c.maxY + ri; tmpE.y = -tmpE.y * c.wallBounce; }
      const mb = Math.max(c.maxZ, c.maxSize);
      if (Math.abs(tmpB.z) + ri > mb) { tmpB.z = Math.sign(tmpB.z) * (c.maxZ - ri); tmpE.z = -tmpE.z * c.wallBounce; }
      tmpB.toArray(pos, b); tmpE.toArray(vel, b);
    }
  }
}

class BallMesh extends InstancedMesh {
  constructor(renderer, cfg = {}) {
    const defaults = {
      count: 120, colors: BALL_COLORS,
      ambientColor: 0xffffff, ambientIntensity: 0.8, lightIntensity: 150,
      materialParams: { metalness: 0.4, roughness: 0.5, clearcoat: 1, clearcoatRoughness: 0.15 },
      minSize: 0.4, maxSize: 1.1, size0: 1, gravity: 0.03, friction: 0.9975,
      wallBounce: 0.95, maxVelocity: 0.15, maxX: 5, maxY: 5, maxZ: 2,
      controlSphere0: false, followCursor: false
    };
    const c = { ...defaults, ...cfg };
    const env = new PMREMGenerator(renderer, 0.04).fromScene(new RoomEnvironment()).texture;
    const mat = new SubMaterial({ envMap: env, ...c.materialParams });
    mat.envMapRotation.x = -Math.PI / 2;
    super(new SphereGeometry(), mat, c.count);
    this.config = c;
    this.physics = new BallPhysics(c);
    this.ambientLight = new AmbientLight(c.ambientColor, c.ambientIntensity);
    this.add(this.ambientLight);
    this.light = new PointLight(c.colors[0], c.lightIntensity);
    this.add(this.light);
    this._setColors(c.colors);
  }
  _setColors(colors) {
    if (!Array.isArray(colors) || colors.length < 2) return;
    const cols = colors.map(c => new Color(c));
    for (let i = 0; i < this.count; i++) {
      const t = i / (this.count - 1);
      const scaled = t * (cols.length - 1);
      const idx = Math.min(Math.floor(scaled), cols.length - 2);
      const alpha = scaled - idx;
      const col = new Color();
      col.r = cols[idx].r + alpha * (cols[idx + 1].r - cols[idx].r);
      col.g = cols[idx].g + alpha * (cols[idx + 1].g - cols[idx].g);
      col.b = cols[idx].b + alpha * (cols[idx + 1].b - cols[idx].b);
      this.setColorAt(i, col);
      if (i === 0) this.light.color.copy(col);
    }
    this.instanceColor.needsUpdate = true;
  }
  update(dt) {
    this.physics.update(dt);
    const dummy = new Object3D();
    for (let i = 0; i < this.count; i++) {
      dummy.position.fromArray(this.physics.positionData, 3 * i);
      dummy.scale.setScalar(this.physics.sizeData[i]);
      dummy.updateMatrix();
      this.setMatrixAt(i, dummy.matrix);
      if (i === 0) this.light.position.copy(dummy.position);
    }
    this.instanceMatrix.needsUpdate = true;
  }
}

// pointer registry
const ptrMap = new Map(); let ptrInit = false;
const ptrPos = new Vector2();
function registerPointer(cfg) {
  const state = { position: new Vector2(), nPosition: new Vector2(), hover: false, onMove() { }, onLeave() { }, ...cfg };
  if (!ptrMap.has(cfg.domElement)) {
    ptrMap.set(cfg.domElement, state);
    if (!ptrInit) {
      document.body.addEventListener("pointermove", onPtrMove);
      document.body.addEventListener("pointerleave", onPtrLeave);
      ptrInit = true;
    }
  }
  state.dispose = () => { ptrMap.delete(cfg.domElement); if (ptrMap.size === 0) { document.body.removeEventListener("pointermove", onPtrMove); document.body.removeEventListener("pointerleave", onPtrLeave); ptrInit = false; } };
  return state;
}
function onPtrMove(e) {
  ptrPos.x = e.clientX; ptrPos.y = e.clientY;
  for (const [el, s] of ptrMap) {
    const r = el.getBoundingClientRect();
    if (ptrPos.x >= r.left && ptrPos.x <= r.right && ptrPos.y >= r.top && ptrPos.y <= r.bottom) {
      s.position.x = ptrPos.x - r.left; s.position.y = ptrPos.y - r.top;
      s.nPosition.x = (s.position.x / r.width) * 2 - 1;
      s.nPosition.y = (-s.position.y / r.height) * 2 + 1;
      s.hover = true; s.onMove(s);
    } else if (s.hover) { s.hover = false; s.onLeave(s); }
  }
}
function onPtrLeave() { for (const s of ptrMap.values()) { if (s.hover) { s.hover = false; s.onLeave(s); } } }

function BallpitCanvas({ style, ...cfg }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const parent = canvas.parentElement;
    let paused = false;
    const clock = new Clock();
    const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const camera = new PerspectiveCamera(75, 1, 0.1, 100);
    camera.position.set(0, 0, 20);
    const scene = new Scene();
    const balls = new BallMesh(renderer, cfg);
    scene.add(balls);

    const raycaster = new Raycaster();
    const plane = new Plane(new Vector3(0, 0, 1), 0);
    const hitPt = new Vector3();
    const ptr = registerPointer({
      domElement: canvas,
      onMove(s) { raycaster.setFromCamera(s.nPosition, camera); camera.getWorldDirection(plane.normal); raycaster.ray.intersectPlane(plane, hitPt); balls.physics.center.copy(hitPt); balls.config.controlSphere0 = true; },
      onLeave() { balls.config.controlSphere0 = false; }
    });

    function resize() {
      const w = parent.offsetWidth, h = parent.offsetHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      const fov = (camera.fov * Math.PI) / 180;
      const wH = 2 * Math.tan(fov / 2) * camera.position.length();
      balls.config.maxX = (wH * camera.aspect) / 2;
      balls.config.maxY = wH / 2;
    }
    resize();
    const ro = new ResizeObserver(resize); ro.observe(parent);

    const dt = { delta: 0, elapsed: 0 };
    let raf;
    function animate() {
      raf = requestAnimationFrame(animate);
      dt.delta = clock.getDelta(); dt.elapsed += dt.delta;
      if (!paused) balls.update(dt);
      renderer.render(scene, camera);
    }
    animate();

    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); ptr.dispose();
      renderer.dispose(); renderer.forceContextLoss();
    };
  }, []);
  return <canvas ref={ref} style={{ width: "100%", height: "100%", display: "block", ...style }} />;
}

// ── SVG Square with edge trace ────────────────────────────────────────────────
function BreathingSquare({ phaseIdx, cycle, phaseProgress, size = 220 }) {
  const stroke = ACCENT;
  const dim = size;
  const pad = 2;
  const s = dim - pad * 2;
  // perimeter = 4*s, each edge = s
  const perim = 4 * s;

  // calculate total progress for continuous animation
  const totalEdgeIdx = cycle * 4 + phaseIdx;
  const traceLen = (totalEdgeIdx + phaseProgress) * s;
  const dashoffset = perim - traceLen;

  // which edge is active (for labels)
  const edgeIdx = phaseIdx % 4;

  // corner radius
  const r = 8;

  // label positions for each edge
  const labelStyle = {
    position: "absolute", fontFamily: "'JetBrains Mono', monospace",
    fontSize: "10px", color: "rgba(255,255,255,0.35)", letterSpacing: "0.12em",
    textTransform: "uppercase", pointerEvents: "none"
  };

  return (
    <div style={{ position: "relative", width: dim, height: dim }}>
      {/* edge labels */}
      <div style={{ ...labelStyle, top: -18, left: 0, right: 0, textAlign: "center", color: edgeIdx === 0 ? ACCENT : "rgba(255,255,255,0.25)" }}>inhale</div>
      <div style={{ ...labelStyle, right: -44, top: 0, bottom: 0, display: "flex", alignItems: "center", color: edgeIdx === 1 ? ACCENT : "rgba(255,255,255,0.25)" }}>hold</div>
      <div style={{ ...labelStyle, bottom: -18, left: 0, right: 0, textAlign: "center", color: edgeIdx === 2 ? ACCENT : "rgba(255,255,255,0.25)" }}>exhale</div>
      <div style={{ ...labelStyle, left: -38, top: 0, bottom: 0, display: "flex", alignItems: "center", color: edgeIdx === 3 ? ACCENT : "rgba(255,255,255,0.25)" }}>hold</div>

      <svg width={dim} height={dim} viewBox={`0 0 ${dim} ${dim}`} style={{ overflow: "visible" }}>
        {/* background square */}
        <rect x={pad} y={pad} width={s} height={s} rx={r} ry={r}
          fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1.5" />
        {/* animated trace — clockwise starting top-left */}
        <rect x={pad} y={pad} width={s} height={s} rx={r} ry={r}
          fill="none"
          stroke={stroke}
          strokeWidth="2.5"
          strokeDasharray={`${perim}`}
          strokeDashoffset={dashoffset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.05s linear", filter: `drop-shadow(0 0 6px ${stroke}88)` }}
          pathLength={perim}
        />
        {/* corner dots */}
        {[[pad, pad], [dim - pad, pad], [dim - pad, dim - pad], [pad, dim - pad]].map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r="3" fill="rgba(255,255,255,0.15)" />
        ))}
      </svg>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function BoxBreathing() {
  const [screen, setScreen] = useState("intro"); // intro | countdown | breathing | done
  const [name, setName] = useState("");
  const [inputVal, setInputVal] = useState("");
  const [preCount, setPreCount] = useState(3);

  // breathing state
  const [cycle, setCycle] = useState(0);
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [countdown, setCountdown] = useState(4);
  const [phaseProgress, setPhaseProgress] = useState(0);

  const intervalRef = useRef(null);
  const tickRef = useRef(null);

  const startBreathing = useCallback(() => {
    const n = inputVal.trim() || "friend";
    setName(n);
    setPreCount(3);
    setScreen("countdown");
  }, [inputVal]);

  // 3-2-1 pre-session countdown
  useEffect(() => {
    if (screen !== "countdown") return;
    if (preCount <= 0) {
      setCycle(0); setPhaseIdx(0); setCountdown(4); setPhaseProgress(0);
      setScreen("breathing");
      return;
    }
    const t = setTimeout(() => setPreCount(p => p - 1), 1000);
    return () => clearTimeout(t);
  }, [screen, preCount]);

  // tick engine
  useEffect(() => {
    if (screen !== "breathing") return;
    const TICK = 50; // ms
    const phaseDur = PHASES[phaseIdx].duration * 1000;
    let elapsed = 0;
    let lastCountdown = PHASES[phaseIdx].duration;

    tickRef.current = setInterval(() => {
      elapsed += TICK;
      const prog = Math.min(elapsed / phaseDur, 1);
      setPhaseProgress(prog);
      const cd = Math.max(1, Math.ceil(PHASES[phaseIdx].duration - (elapsed / 1000)));
      setCountdown(cd);

      if (elapsed >= phaseDur) {
        clearInterval(tickRef.current);
        const nextPhase = phaseIdx + 1;
        if (nextPhase >= PHASES.length) {
          const nextCycle = cycle + 1;
          if (nextCycle >= TOTAL_CYCLES) {
            setScreen("done");
            return;
          }
          setCycle(nextCycle);
          setPhaseIdx(0);
        } else {
          setPhaseIdx(nextPhase);
        }
        setPhaseProgress(0);
        setCountdown(4);
      }
    }, TICK);

    return () => clearInterval(tickRef.current);
  }, [screen, phaseIdx, cycle]);

  const currentPhase = PHASES[phaseIdx];

  return (
    <div className="box-breathing-app" style={{
      width: "100vw", height: "100dvh",
      background: "#07071a", color: "#fff",
      display: "flex", flexDirection: "column",
      overflow: "hidden", position: "relative"
    }}>
      {/* ── COMPANY LOGO ── */}
      <div style={{
        position: "fixed", top: 30, left: 30, zIndex: 1000,
        pointerEvents: "auto", opacity: 0.8
      }}>
        <CircularText
          text="AIMAN HEALTH * AIMAN HEALTH * "
          onHover="goBonkers"
          spinDuration={15}
        />
      </div>
      {/* Google Font */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::selection { background: ${ACCENT}44; }

        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes scalein {
          from { opacity: 0; transform: scale(0.85); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes pulse-ring {
          0%   { transform: scale(1);   opacity: 0.5; }
          100% { transform: scale(1.18); opacity: 0; }
        }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }

        .intro-card {
          animation: scalein 0.5s cubic-bezier(0.34,1.56,0.64,1) both;
        }
        .breathe-ui {
          animation: fadeUp 0.6s ease both;
        }
        .input-name {
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 10px;
          color: #fff;
          font-family: 'JetBrains Mono', monospace;
          font-size: 14px;
          padding: 12px 16px;
          width: 100%;
          outline: none;
          transition: border-color 0.2s;
        }
        .input-name::placeholder { color: rgba(255,255,255,0.25); }
        .input-name:focus { border-color: ${ACCENT}88; }
        .btn-primary {
          background: ${ACCENT};
          color: #07071a;
          border: none;
          border-radius: 10px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 13px;
          font-weight: 600;
          padding: 12px 24px;
          cursor: pointer;
          width: 100%;
          letter-spacing: 0.06em;
          transition: opacity 0.15s, transform 0.15s;
        }
        .btn-primary:hover { opacity: 0.88; transform: translateY(-1px); }
        .btn-primary:active { transform: scale(0.98); }
        .btn-ghost {
          background: transparent;
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 10px;
          color: rgba(255,255,255,0.4);
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          padding: 10px 24px;
          cursor: pointer;
          width: 100%;
          transition: border-color 0.2s, color 0.2s;
        }
        .btn-ghost:hover { border-color: rgba(255,255,255,0.3); color: rgba(255,255,255,0.7); }
        .cycle-dot {
          width: 7px; height: 7px; border-radius: 50%;
          transition: background 0.4s, transform 0.4s;
        }
        .phase-word {
          font-size: clamp(22px, 4vw, 32px);
          font-weight: 500;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          transition: color 0.3s;
        }
        .count-num {
          font-size: clamp(52px, 10vw, 80px);
          font-weight: 300;
          letter-spacing: -0.02em;
          line-height: 1;
          color: #fff;
        }
        .cursor { animation: blink 1s step-end infinite; }
      `}</style>

      {/* ── INTRO SCREEN ── */}
      {screen === "intro" && (
        <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {/* Ballpit background */}
          <div style={{ position: "absolute", inset: 0 }}>
            <BallpitCanvas
              count={120}
              gravity={0.01}
              friction={0.9975}
              wallBounce={0.95}
              followCursor={true}
              colors={BALL_COLORS}
            />
          </div>

          {/* Card */}
          <div className="intro-card" style={{
            position: "relative", zIndex: 10,
            background: "rgba(7,7,26,0.78)",
            backdropFilter: "blur(20px)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "20px",
            padding: "36px 32px",
            width: "min(360px, 90vw)",
            display: "flex", flexDirection: "column", gap: "20px",
            boxShadow: "0 24px 80px rgba(0,0,0,0.6)"
          }}>
            {/* Icon */}
            <div style={{ display: "flex", justifyContent: "center" }}>
              <div style={{
                width: 48, height: 48, border: `1.5px solid ${ACCENT}66`,
                borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center"
              }}>
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                  <rect x="2" y="2" width="18" height="18" rx="3" stroke={ACCENT} strokeWidth="1.5" />
                  <line x1="2" y1="11" x2="20" y2="11" stroke={ACCENT} strokeWidth="1" strokeOpacity="0.4" />
                  <line x1="11" y1="2" x2="11" y2="20" stroke={ACCENT} strokeWidth="1" strokeOpacity="0.4" />
                </svg>
              </div>
            </div>

            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 20, fontWeight: 500, color: "#fff", marginBottom: 6 }}>
                box breathing
              </div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", lineHeight: 1.6 }}>
                4 cycles · 4-4-4-4 pattern<br />calm your nervous system
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", letterSpacing: "0.08em" }}>
                what should we call you?
              </div>
              <input
                className="input-name"
                placeholder="your first name..."
                value={inputVal}
                onChange={e => setInputVal(e.target.value)}
                onKeyDown={e => e.key === "Enter" && startBreathing()}
                autoFocus
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button className="btn-primary" onClick={startBreathing}>
                start breathing →
              </button>
              <button className="btn-ghost" onClick={() => { setInputVal(""); startBreathing(); }}>
                skip
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── COUNTDOWN SCREEN ── */}
      {screen === "countdown" && (
        <div className="breathe-ui" style={{
          flex: 1, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          gap: 16, position: "relative"
        }}>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", letterSpacing: "0.18em", textTransform: "uppercase" }}>
            get ready
          </div>
          <Counter
            value={preCount}
            places={[1]}
            fontSize={120}
            padding={8}
            gap={0}
            textColor={ACCENT}
            fontWeight={300}
            gradientFrom="transparent"
            gradientHeight={0}
          />
        </div>
      )}

      {/* ── BREATHING SCREEN ── */}
      {screen === "breathing" && (
        <div className="breathe-ui" style={{
          flex: 1, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          gap: "clamp(28px, 5vh, 48px)", padding: "40px 20px",
          position: "relative"
        }}>
          {/* subtle grid overlay */}
          <div style={{
            position: "absolute", inset: 0, opacity: 0.03,
            backgroundImage: `linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px),
                              linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)`,
            backgroundSize: "40px 40px", pointerEvents: "none"
          }} />

          {/* greeting */}
          <div style={{ textAlign: "center", zIndex: 1 }}>
            <BlurText
              key={name}
              text={`hey, ${name} — let's breathe`}
              delay={120}
              animateBy="words"
              direction="top"
              stepDuration={0.4}
              style={{
                fontSize: 13,
                color: "rgba(255,255,255,0.5)",
                letterSpacing: "0.06em",
                justifyContent: "center",
              }}
            />
          </div>

          {/* square + phase info */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 32, zIndex: 1 }}>
            {/* pulse ring behind square */}
            <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{
                position: "absolute", width: 260, height: 260, borderRadius: 16,
                border: `1px solid ${ACCENT}33`,
                animation: "pulse-ring 3s ease-out infinite"
              }} />
              <BreathingSquare phaseIdx={phaseIdx} cycle={cycle} phaseProgress={phaseProgress} size={220} />
            </div>

            {/* phase + countdown — below the box */}
            <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <div className="phase-word" style={{ color: ACCENT }}>{currentPhase.label}</div>
              {/* phase hint — re-animates each phase via key */}
              <div key={phaseIdx} style={{ animation: "fadeUp 0.5s ease both", display: "flex", flexDirection: "column", gap: 2 }}>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", letterSpacing: "0.1em" }}>
                  {HINTS[currentPhase.label]?.main}
                </div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.28)", letterSpacing: "0.08em", fontStyle: "italic" }}>
                  {HINTS[currentPhase.label]?.sub}
                </div>
              </div>
              <Counter
                value={countdown}
                places={[1]}
                fontSize={80}
                padding={5}
                gap={0}
                textColor="white"
                fontWeight={300}
                gradientFrom="#07071a"
                gradientHeight={20}
              />
            </div>
          </div>

          {/* cycle dots */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, zIndex: 1 }}>
            <div style={{ display: "flex", gap: 8 }}>
              {Array.from({ length: TOTAL_CYCLES }).map((_, i) => (
                <div key={i} className="cycle-dot" style={{
                  background: i < cycle ? ACCENT : i === cycle ? `${ACCENT}88` : "rgba(255,255,255,0.15)",
                  transform: i === cycle ? "scale(1.3)" : "scale(1)"
                }} />
              ))}
            </div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", letterSpacing: "0.1em" }}>
              cycle {cycle + 1} / {TOTAL_CYCLES}
            </div>
          </div>

          {/* phase progress bar */}
          <div style={{ width: "min(260px, 70vw)", zIndex: 1 }}>
            <div style={{ height: 1, background: "rgba(255,255,255,0.08)", borderRadius: 1, overflow: "hidden" }}>
              <div style={{
                height: "100%", background: ACCENT, borderRadius: 1,
                width: `${phaseProgress * 100}%`,
                transition: "width 0.05s linear",
                boxShadow: `0 0 6px ${ACCENT}`
              }} />
            </div>
          </div>
        </div>
      )}

      {/* ── DONE SCREEN ── */}
      {screen === "done" && (
        <div className="breathe-ui" style={{
          flex: 1, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          gap: 24, padding: 40, textAlign: "center",
          position: "relative"
        }}>
          {/* Galaxy background — no mouse interaction */}
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            <Galaxy
              mouseInteraction={false}
              mouseRepulsion={false}
              density={1}
              glowIntensity={0.3}
              saturation={0}
              hueShift={140}
              twinkleIntensity={0.3}
              rotationSpeed={0.1}
              repulsionStrength={2}
              autoCenterRepulsion={0}
              starSpeed={0.5}
              speed={1}
              transparent={true}
            />
          </div>
          <div style={{
            width: 64, height: 64, borderRadius: 16,
            border: `1.5px solid ${ACCENT}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: `0 0 24px ${ACCENT}44`,
            position: "relative", zIndex: 1
          }}>
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <path d="M6 14l6 6 10-12" stroke={ACCENT} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div style={{ position: "relative", zIndex: 1 }}>
            <div style={{ fontSize: 20, fontWeight: 500, color: "#fff", marginBottom: 8 }}>
              well done, {name}.
            </div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", lineHeight: 1.7 }}>
              4 cycles complete.<br />your nervous system thanks you.
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center", position: "relative", zIndex: 1 }}>
            <button className="btn-primary" style={{ width: "auto", padding: "12px 28px" }}
              onClick={() => { setCycle(0); setPhaseIdx(0); setCountdown(4); setPhaseProgress(0); setScreen("breathing"); }}>
              go again →
            </button>
            <button className="btn-ghost" style={{ width: "auto", padding: "12px 28px" }}
              onClick={() => setScreen("intro")}>
              restart
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
