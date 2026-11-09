import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { ApiError, getQuoteModel } from "../api";
import type { Quote } from "../api";
import { REDUCED_MOTION_QUERY } from "../hooks/useReducedMotion";
import type { ModelScene } from "../viewer/modelScene";
import { decodePartMesh } from "../viewer/mesh";
import type { PartMesh } from "../viewer/mesh";
import { QuoteThumbnail } from "./QuoteThumbnail";

type ViewerStatus = "loading" | "ready" | "missing" | "failed" | "no-webgl";

function ViewerMessage({ title, detail }: { title: string; detail: string }): JSX.Element {
  return (
    <div className="viewer-message">
      <strong>{title}</strong>
      <span className="hint">{detail}</span>
    </div>
  );
}

export function StepViewer({ quote }: { quote: Quote }): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<ViewerStatus>("loading");
  const { id, file } = quote;

  useEffect(() => {
    const controller = new AbortController();
    const motionQuery: MediaQueryList = window.matchMedia(REDUCED_MOTION_QUERY);
    let scene: ModelScene | null = null;

    function handleMotionChange(): void {
      scene?.setAutoRotate(!motionQuery.matches);
    }

    async function loadModel(): Promise<void> {
      try {
        const buffer: ArrayBuffer = await getQuoteModel(id, controller.signal);
        const mesh: PartMesh = decodePartMesh(buffer);
        const { createModelScene } = await import("../viewer/modelScene");
        if (controller.signal.aborted || host.current === null) {
          return;
        }
        try {
          scene = createModelScene(host.current, mesh, !motionQuery.matches);
        } catch {
          setStatus("no-webgl");
          return;
        }
        setStatus("ready");
      } catch (error: unknown) {
        if (controller.signal.aborted) {
          return;
        }
        if (error instanceof ApiError && error.status === 404) {
          setStatus("missing");
        } else {
          setStatus("failed");
        }
      }
    }

    motionQuery.addEventListener("change", handleMotionChange);
    void loadModel();
    return () => {
      controller.abort();
      motionQuery.removeEventListener("change", handleMotionChange);
      scene?.dispose();
    };
  }, [id]);

  return (
    <div className="viewer" data-status={status}>
      <div
        ref={host}
        className="viewer-host"
        role={status === "ready" ? "img" : undefined}
        aria-label={status === "ready" ? `3D model of ${file}, rotatable by dragging` : undefined}
      />
      {status === "loading" && <ViewerMessage title="Loading 3D model…" detail="Preparing the part preview." />}
      {status === "missing" && (
        <ViewerMessage title="Preview unavailable" detail="This quote has no saved 3D preview." />
      )}
      {status === "failed" && (
        <ViewerMessage title="Preview unavailable" detail="The 3D preview could not be loaded." />
      )}
      {status === "no-webgl" && (
        <div className="viewer-message">
          <QuoteThumbnail quoteId={id} fileName={file} />
          <strong>3D view unavailable</strong>
          <span className="hint">This browser cannot display WebGL, so a still image is shown.</span>
        </div>
      )}
      {status === "ready" && <span className="micro-label viewer-hint">Drag to rotate</span>}
    </div>
  );
}
