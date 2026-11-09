export const INITIAL_AZIMUTH: number = -Math.PI / 4;
export const INITIAL_ELEVATION: number = (35.264 * Math.PI) / 180;

const AUTO_ROTATE_RADIANS_PER_SECOND: number = 0.28;
const RESUME_DELAY_MS: number = 1200;
const DRAG_RADIANS_PER_PIXEL: number = 0.009;
const MAX_ELEVATION: number = (85 * Math.PI) / 180;
const MAX_FRAME_SECONDS: number = 0.1;

export interface Orbit {
  readonly azimuth: number;
  readonly elevation: number;
  readonly dragging: boolean;
  readonly autoRotate: boolean;
  setAutoRotate(enabled: boolean): void;
  beginDrag(): void;
  dragBy(deltaX: number, deltaY: number): void;
  endDrag(now: number): void;
  advance(now: number): void;
}

export function createOrbit(autoRotate: boolean): Orbit {
  let azimuth: number = INITIAL_AZIMUTH;
  let elevation: number = INITIAL_ELEVATION;
  let dragging: boolean = false;
  let autoRotateEnabled: boolean = autoRotate;
  let resumeAt: number = 0;
  let lastFrame: number | null = null;

  return {
    get azimuth(): number {
      return azimuth;
    },
    get elevation(): number {
      return elevation;
    },
    get dragging(): boolean {
      return dragging;
    },
    get autoRotate(): boolean {
      return autoRotateEnabled;
    },
    setAutoRotate(enabled: boolean): void {
      autoRotateEnabled = enabled;
      lastFrame = null;
    },
    beginDrag(): void {
      dragging = true;
      lastFrame = null;
    },
    dragBy(deltaX: number, deltaY: number): void {
      azimuth += deltaX * DRAG_RADIANS_PER_PIXEL;
      elevation = Math.min(
        MAX_ELEVATION,
        Math.max(-MAX_ELEVATION, elevation + deltaY * DRAG_RADIANS_PER_PIXEL),
      );
    },
    endDrag(now: number): void {
      dragging = false;
      resumeAt = now + RESUME_DELAY_MS;
      lastFrame = null;
    },
    advance(now: number): void {
      if (!autoRotateEnabled || dragging || now < resumeAt) {
        lastFrame = null;
        return;
      }
      if (lastFrame !== null) {
        azimuth += Math.min((now - lastFrame) / 1000, MAX_FRAME_SECONDS) * AUTO_ROTATE_RADIANS_PER_SECOND;
      }
      lastFrame = now;
    },
  };
}
