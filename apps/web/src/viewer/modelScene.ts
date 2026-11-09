import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshLambertMaterial,
  OrthographicCamera,
  Scene,
  WebGLRenderer,
} from "three";
import { boundingRadius } from "./mesh";
import type { PartMesh } from "./mesh";
import { createOrbit } from "./orbit";
import type { Orbit } from "./orbit";

const FRAME_MARGIN: number = 1.14;
const MAX_PIXEL_RATIO: number = 2;
const SKY_LIGHT_INTENSITY: number = 2.35;
const KEY_LIGHT_INTENSITY: number = 1.25;

export interface ModelScene {
  setAutoRotate(enabled: boolean): void;
  dispose(): void;
}

function readToken(host: HTMLElement, token: string): Color {
  return new Color(getComputedStyle(host).getPropertyValue(token).trim());
}

export function createModelScene(host: HTMLElement, mesh: PartMesh, autoRotate: boolean): ModelScene {
  const renderer: WebGLRenderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
  const canvas: HTMLCanvasElement = renderer.domElement;
  canvas.className = "viewer-canvas";
  host.appendChild(canvas);

  const scene: Scene = new Scene();
  scene.add(new HemisphereLight(readToken(host, "--sheet"), readToken(host, "--model-shade"), SKY_LIGHT_INTENSITY));
  const keyLight: DirectionalLight = new DirectionalLight(readToken(host, "--sheet"), KEY_LIGHT_INTENSITY);
  keyLight.position.set(-0.42, 0.74, 0.52);
  scene.add(keyLight);

  const positions: BufferAttribute = new BufferAttribute(mesh.positions, 3);
  const surfaceGeometry: BufferGeometry = new BufferGeometry();
  surfaceGeometry.setAttribute("position", positions);
  surfaceGeometry.setAttribute("normal", new BufferAttribute(mesh.normals, 3, true));
  surfaceGeometry.setIndex(new BufferAttribute(mesh.triangles, 1));
  const edgeGeometry: BufferGeometry = new BufferGeometry();
  edgeGeometry.setAttribute("position", positions);
  edgeGeometry.setIndex(new BufferAttribute(mesh.edges, 1));

  const surfaceMaterial: MeshLambertMaterial = new MeshLambertMaterial({
    color: readToken(host, "--model-surface"),
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const edgeMaterial: LineBasicMaterial = new LineBasicMaterial({
    color: readToken(host, "--ink"),
    transparent: true,
    opacity: 0.72,
  });

  const part: Group = new Group();
  part.rotation.x = -Math.PI / 2;
  part.add(new Mesh(surfaceGeometry, surfaceMaterial));
  part.add(new LineSegments(edgeGeometry, edgeMaterial));
  const pivot: Group = new Group();
  pivot.add(part);
  scene.add(pivot);

  const radius: number = Math.max(boundingRadius(mesh.positions), 1e-6);
  const camera: OrthographicCamera = new OrthographicCamera(-1, 1, 1, -1, radius, radius * 5);
  camera.position.z = radius * 3;

  const orbit: Orbit = createOrbit(autoRotate);
  let frame: number = 0;
  let disposed: boolean = false;

  function draw(): void {
    pivot.rotation.set(orbit.elevation, orbit.azimuth, 0);
    renderer.render(scene, camera);
  }

  function schedule(): void {
    if (frame === 0 && !disposed) {
      frame = requestAnimationFrame(tick);
    }
  }

  function tick(now: number): void {
    frame = 0;
    orbit.advance(now);
    draw();
    if (orbit.autoRotate) {
      schedule();
    }
  }

  function resize(): void {
    const width: number = Math.max(host.clientWidth, 1);
    const height: number = Math.max(host.clientHeight, 1);
    renderer.setSize(width, height, false);
    const aspect: number = width / height;
    const halfHeight: number = radius * FRAME_MARGIN * (aspect < 1 ? 1 / aspect : 1);
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.updateProjectionMatrix();
    schedule();
  }

  let activePointer: number | null = null;
  let lastX: number = 0;
  let lastY: number = 0;

  function onPointerDown(event: PointerEvent): void {
    if (activePointer !== null || event.button !== 0) {
      return;
    }
    activePointer = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
    canvas.dataset.dragging = "true";
    orbit.beginDrag();
  }

  function onPointerMove(event: PointerEvent): void {
    if (event.pointerId !== activePointer) {
      return;
    }
    orbit.dragBy(event.clientX - lastX, event.clientY - lastY);
    lastX = event.clientX;
    lastY = event.clientY;
    schedule();
  }

  function onPointerEnd(event: PointerEvent): void {
    if (event.pointerId !== activePointer) {
      return;
    }
    activePointer = null;
    delete canvas.dataset.dragging;
    orbit.endDrag(performance.now());
    schedule();
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerEnd);
  canvas.addEventListener("pointercancel", onPointerEnd);

  const observer: ResizeObserver = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  return {
    setAutoRotate(enabled: boolean): void {
      orbit.setAutoRotate(enabled);
      schedule();
    },
    dispose(): void {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerEnd);
      canvas.removeEventListener("pointercancel", onPointerEnd);
      surfaceGeometry.dispose();
      edgeGeometry.dispose();
      surfaceMaterial.dispose();
      edgeMaterial.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
