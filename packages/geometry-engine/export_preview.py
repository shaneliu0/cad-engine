from __future__ import annotations

import argparse
import math
import os
import struct
import sys
import zlib
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from numpy.typing import NDArray
from OCP.Bnd import Bnd_Box
from OCP.BRep import BRep_Tool
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.BRepTools import BRepTools
from OCP.collections import IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher as ShapeMap
from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE, TopAbs_REVERSED
from OCP.TopExp import TopExp, TopExp_Explorer
from OCP.TopLoc import TopLoc_Location
from OCP.TopoDS import TopoDS, TopoDS_Shape

from geometry_engine import read_step

FloatArray = NDArray[np.float64]
IntArray = NDArray[np.int64]

MODEL_FILE_NAME: str = "model.bin"
THUMBNAIL_FILE_NAME: str = "thumbnail.png"
MODEL_MAGIC: bytes = b"QPM1"

LINEAR_DEFLECTION_RATIO: float = 0.001
ANGULAR_DEFLECTION_RAD: float = 0.25
MAX_ANGULAR_DEFLECTION_RAD: float = 1.0
COARSENING_FACTORS: tuple[int, ...] = (1, 2, 4, 8, 16)
MAX_TRIANGLES: int = 400_000
SHARP_EDGE_COSINE: float = math.cos(math.radians(20.0))

THUMBNAIL_WIDTH: int = 240
THUMBNAIL_HEIGHT: int = 180
SUPERSAMPLE: int = 3
FRAME_FILL: float = 0.84
MAX_CANDIDATES_PER_BATCH: int = 4_000_000

VIEW_AZIMUTH_RAD: float = -math.pi / 4.0
VIEW_ELEVATION_RAD: float = math.radians(35.264)

LIGHT_DIRECTION: FloatArray = np.array([-0.42, 0.74, 0.52])
AMBIENT_WEIGHT: float = 0.52
DIFFUSE_WEIGHT: float = 0.56

PAPER_RGB: FloatArray = np.array([239.0, 236.0, 228.0])
SHADOW_RGB: FloatArray = np.array([150.0, 144.0, 130.0])
SURFACE_RGB: FloatArray = np.array([250.0, 248.0, 242.0])
INK_RGB: FloatArray = np.array([26.0, 29.0, 33.0])
EDGE_STRENGTH: float = 0.78
CREASE_COSINE: float = 0.82
DEPTH_STEP_RATIO: float = 0.006


class PreviewError(Exception):
    pass


@dataclass(frozen=True)
class DisplayMesh:
    positions: FloatArray
    normals: FloatArray
    triangles: IntArray
    edges: IntArray


@dataclass
class _OpenEdge:
    segments: list[tuple[int, int]]
    normal: FloatArray


def _vertex_normals(points: FloatArray, triangles: IntArray) -> FloatArray:
    first: FloatArray = points[triangles[:, 0]]
    weighted: FloatArray = np.cross(points[triangles[:, 1]] - first, points[triangles[:, 2]] - first)
    normals: FloatArray = np.zeros_like(points)
    for corner in range(3):
        np.add.at(normals, triangles[:, corner], weighted)
    lengths: FloatArray = np.linalg.norm(normals, axis=1)
    normals[lengths == 0.0] = (0.0, 0.0, 1.0)
    lengths[lengths == 0.0] = 1.0
    return normals / lengths[:, np.newaxis]


def _face_arrays(face: TopoDS_Shape, triangulation: object, location: TopLoc_Location) -> tuple[FloatArray, IntArray]:
    transform = location.Transformation()
    points: list[tuple[float, float, float]] = []
    for index in range(1, triangulation.NbNodes() + 1):
        node = triangulation.Node(index).Transformed(transform)
        points.append((node.X(), node.Y(), node.Z()))

    triangles: list[tuple[int, int, int]] = []
    for index in range(1, triangulation.NbTriangles() + 1):
        a, b, c = triangulation.Triangle(index).Get()
        triangles.append((a - 1, b - 1, c - 1))

    connectivity: IntArray = np.array(triangles, dtype=np.int64)
    if (face.Orientation() == TopAbs_REVERSED) != transform.IsNegative():
        connectivity = connectivity[:, [0, 2, 1]]
    return np.array(points, dtype=np.float64), connectivity


def _sharp_edge_segments(
    face: TopoDS_Shape,
    triangulation: object,
    location: TopLoc_Location,
    normals: FloatArray,
    offset: int,
    edge_map: ShapeMap,
    open_edges: dict[int, _OpenEdge],
    segments: list[tuple[int, int]],
) -> None:
    explorer = TopExp_Explorer(face, TopAbs_EDGE)
    while explorer.More():
        edge = TopoDS.Edge(explorer.Current())
        explorer.Next()
        if BRep_Tool.Degenerated_s(edge) or BRep_Tool.IsClosed_s(edge, face):
            continue
        polygon = BRep_Tool.PolygonOnTriangulation_s(edge, triangulation, location)
        if polygon is None or polygon.NbNodes() < 2:
            continue

        nodes: list[int] = [polygon.Node(index) - 1 for index in range(1, polygon.NbNodes() + 1)]
        normal: FloatArray = normals[nodes[len(nodes) // 2]]
        edge_segments: list[tuple[int, int]] = [
            (offset + start, offset + end) for start, end in zip(nodes, nodes[1:])
        ]
        key: int = edge_map.FindIndex(edge)
        paired: _OpenEdge | None = open_edges.pop(key, None)
        if paired is None:
            open_edges[key] = _OpenEdge(edge_segments, normal)
        elif float(np.dot(paired.normal, normal)) < SHARP_EDGE_COSINE:
            segments.extend(edge_segments)


def _collect_mesh(shape: TopoDS_Shape) -> DisplayMesh | None:
    edge_map = ShapeMap()
    TopExp.MapShapes_s(shape, TopAbs_EDGE, edge_map)
    open_edges: dict[int, _OpenEdge] = {}

    all_points: list[FloatArray] = []
    all_normals: list[FloatArray] = []
    all_triangles: list[IntArray] = []
    segments: list[tuple[int, int]] = []
    offset: int = 0

    explorer = TopExp_Explorer(shape, TopAbs_FACE)
    while explorer.More():
        face = TopoDS.Face(explorer.Current())
        explorer.Next()
        location = TopLoc_Location()
        triangulation = BRep_Tool.Triangulation_s(face, location)
        if triangulation is None or triangulation.NbTriangles() == 0:
            continue

        points, triangles = _face_arrays(face, triangulation, location)
        normals: FloatArray = _vertex_normals(points, triangles)
        _sharp_edge_segments(face, triangulation, location, normals, offset, edge_map, open_edges, segments)
        all_points.append(points)
        all_normals.append(normals)
        all_triangles.append(triangles + offset)
        offset += points.shape[0]

    if not all_triangles:
        return None

    for open_edge in open_edges.values():
        segments.extend(open_edge.segments)

    positions: FloatArray = np.concatenate(all_points)
    centre: FloatArray = (positions.min(axis=0) + positions.max(axis=0)) / 2.0
    return DisplayMesh(
        positions=positions - centre,
        normals=np.concatenate(all_normals),
        triangles=np.concatenate(all_triangles),
        edges=np.array(segments, dtype=np.int64).reshape(-1, 2),
    )


def build_display_mesh(shape: TopoDS_Shape) -> DisplayMesh:
    box = Bnd_Box()
    BRepBndLib.Add_s(shape, box)
    low = box.CornerMin()
    high = box.CornerMax()
    diagonal: float = math.dist((low.X(), low.Y(), low.Z()), (high.X(), high.Y(), high.Z()))
    if not math.isfinite(diagonal) or diagonal <= 0.0:
        raise PreviewError("part has no measurable extent")

    mesh: DisplayMesh | None = None
    for factor in COARSENING_FACTORS:
        BRepTools.Clean_s(shape)
        BRepMesh_IncrementalMesh(
            shape,
            diagonal * LINEAR_DEFLECTION_RATIO * factor,
            False,
            min(ANGULAR_DEFLECTION_RAD * factor, MAX_ANGULAR_DEFLECTION_RAD),
            True,
        )
        mesh = _collect_mesh(shape)
        if mesh is None:
            raise PreviewError("part could not be tessellated")
        if mesh.triangles.shape[0] <= MAX_TRIANGLES:
            return mesh
    assert mesh is not None
    return mesh


def encode_mesh(mesh: DisplayMesh) -> bytes:
    header: bytes = struct.pack(
        "<4sIII",
        MODEL_MAGIC,
        mesh.positions.shape[0],
        mesh.triangles.shape[0],
        mesh.edges.shape[0],
    )
    quantized: NDArray[np.int16] = np.rint(np.clip(mesh.normals, -1.0, 1.0) * 32767.0).astype("<i2")
    return b"".join(
        (
            header,
            mesh.positions.astype("<f4").tobytes(),
            mesh.triangles.astype("<u4").tobytes(),
            mesh.edges.astype("<u4").tobytes(),
            quantized.tobytes(),
        )
    )


def _view_rotation() -> FloatArray:
    z_up_to_y_up: FloatArray = np.array([[1.0, 0.0, 0.0], [0.0, 0.0, 1.0], [0.0, -1.0, 0.0]])
    cos_azimuth, sin_azimuth = math.cos(VIEW_AZIMUTH_RAD), math.sin(VIEW_AZIMUTH_RAD)
    cos_elevation, sin_elevation = math.cos(VIEW_ELEVATION_RAD), math.sin(VIEW_ELEVATION_RAD)
    spin: FloatArray = np.array(
        [[cos_azimuth, 0.0, sin_azimuth], [0.0, 1.0, 0.0], [-sin_azimuth, 0.0, cos_azimuth]]
    )
    tilt: FloatArray = np.array(
        [[1.0, 0.0, 0.0], [0.0, cos_elevation, -sin_elevation], [0.0, sin_elevation, cos_elevation]]
    )
    return tilt @ spin @ z_up_to_y_up


def _rasterize(
    screen: FloatArray, view_normals: FloatArray, triangles: IntArray, width: int, height: int
) -> tuple[FloatArray, FloatArray]:
    depth: FloatArray = np.full(width * height, -np.inf)
    shading_normals: FloatArray = np.zeros((width * height, 3))

    corners: FloatArray = screen[triangles]
    ab: FloatArray = corners[:, 1, :2] - corners[:, 0, :2]
    ac: FloatArray = corners[:, 2, :2] - corners[:, 0, :2]
    doubled_area: FloatArray = ab[:, 0] * ac[:, 1] - ab[:, 1] * ac[:, 0]
    visible: NDArray[np.bool_] = doubled_area < 0.0
    triangles = triangles[visible]
    corners = corners[visible]
    doubled_area = doubled_area[visible]

    limit: IntArray = np.array([width - 1, height - 1])
    low: IntArray = np.clip(np.floor(corners[:, :, :2].min(axis=1)).astype(np.int64), 0, limit)
    high: IntArray = np.clip(np.ceil(corners[:, :, :2].max(axis=1)).astype(np.int64), 0, limit)
    spans: IntArray = high - low + 1
    candidate_counts: IntArray = spans[:, 0] * spans[:, 1]

    order: IntArray = np.argsort(candidate_counts)
    start: int = 0
    while start < order.size:
        cumulative: IntArray = np.cumsum(candidate_counts[order[start:]])
        stop: int = max(int(np.searchsorted(cumulative, MAX_CANDIDATES_PER_BATCH)), 1)
        batch: IntArray = order[start : start + stop]
        start += stop

        counts: IntArray = candidate_counts[batch]
        owner: IntArray = np.repeat(batch, counts)
        serial: IntArray = np.arange(counts.sum()) - np.repeat(np.cumsum(counts) - counts, counts)
        column_span: IntArray = spans[owner, 0]
        x: IntArray = low[owner, 0] + serial % column_span
        y: IntArray = low[owner, 1] + serial // column_span

        a: FloatArray = corners[owner, 0]
        b: FloatArray = corners[owner, 1]
        c: FloatArray = corners[owner, 2]
        sample_x: FloatArray = x + 0.5
        sample_y: FloatArray = y + 0.5
        area: FloatArray = doubled_area[owner]
        w0: FloatArray = ((c[:, 0] - b[:, 0]) * (sample_y - b[:, 1]) - (c[:, 1] - b[:, 1]) * (sample_x - b[:, 0])) / area
        w1: FloatArray = ((a[:, 0] - c[:, 0]) * (sample_y - c[:, 1]) - (a[:, 1] - c[:, 1]) * (sample_x - c[:, 0])) / area
        w2: FloatArray = 1.0 - w0 - w1

        inside: NDArray[np.bool_] = (w0 >= 0.0) & (w1 >= 0.0) & (w2 >= 0.0)
        pixel: IntArray = y[inside] * width + x[inside]
        weights: FloatArray = np.stack((w0[inside], w1[inside], w2[inside]), axis=1)
        hit_owner: IntArray = owner[inside]
        z: FloatArray = (weights * corners[hit_owner, :, 2]).sum(axis=1)

        closer: NDArray[np.bool_] = z > depth[pixel]
        pixel = pixel[closer]
        z = z[closer]
        weights = weights[closer]
        hit_owner = hit_owner[closer]

        by_depth: IntArray = np.argsort(z, kind="stable")
        pixel = pixel[by_depth]
        z = z[by_depth]
        weights = weights[by_depth]
        hit_owner = hit_owner[by_depth]

        depth[pixel] = z
        vertex_normals: FloatArray = view_normals[triangles[hit_owner]]
        shading_normals[pixel] = (weights[:, :, np.newaxis] * vertex_normals).sum(axis=1)

    return depth.reshape(height, width), shading_normals.reshape(height, width, 3)


def _edge_mask(depth: FloatArray, normals: FloatArray, depth_step: float) -> NDArray[np.bool_]:
    covered: NDArray[np.bool_] = np.isfinite(depth)
    filled: FloatArray = np.where(covered, depth, depth[covered].min())
    mask: NDArray[np.bool_] = np.zeros(depth.shape, dtype=bool)

    for axis in (0, 1):
        before: FloatArray = np.roll(filled, 1, axis=axis)
        after: FloatArray = np.roll(filled, -1, axis=axis)
        step: NDArray[np.bool_] = np.abs(before - 2.0 * filled + after) > depth_step
        coverage: NDArray[np.bool_] = covered != np.roll(covered, 1, axis=axis)
        crease: NDArray[np.bool_] = (normals * np.roll(normals, 1, axis=axis)).sum(axis=2) < CREASE_COSINE
        mask |= coverage | (crease & covered & np.roll(covered, 1, axis=axis)) | (step & covered)

    widened: NDArray[np.bool_] = mask.copy()
    for axis in (0, 1):
        widened |= np.roll(mask, 1, axis=axis)
    return widened


def render_thumbnail(mesh: DisplayMesh) -> NDArray[np.uint8]:
    width: int = THUMBNAIL_WIDTH * SUPERSAMPLE
    height: int = THUMBNAIL_HEIGHT * SUPERSAMPLE
    rotation: FloatArray = _view_rotation()
    view_positions: FloatArray = mesh.positions @ rotation.T
    view_normals: FloatArray = mesh.normals @ rotation.T

    low: FloatArray = view_positions[:, :2].min(axis=0)
    high: FloatArray = view_positions[:, :2].max(axis=0)
    extent: FloatArray = np.maximum(high - low, 1e-9)
    scale: float = FRAME_FILL * float(min(width / extent[0], height / extent[1]))
    middle: FloatArray = (low + high) / 2.0

    screen: FloatArray = np.column_stack(
        (
            width / 2.0 + (view_positions[:, 0] - middle[0]) * scale,
            height / 2.0 - (view_positions[:, 1] - middle[1]) * scale,
            view_positions[:, 2] * scale,
        )
    )
    depth, normals = _rasterize(screen, view_normals, mesh.triangles, width, height)

    lengths: FloatArray = np.linalg.norm(normals, axis=2, keepdims=True)
    lengths[lengths == 0.0] = 1.0
    normals = normals / lengths

    light: FloatArray = LIGHT_DIRECTION / np.linalg.norm(LIGHT_DIRECTION)
    sky: FloatArray = 0.5 * (normals[:, :, 1] + 1.0)
    diffuse: FloatArray = np.maximum((normals * light).sum(axis=2), 0.0)
    intensity: FloatArray = np.clip(AMBIENT_WEIGHT * sky + DIFFUSE_WEIGHT * diffuse, 0.0, 1.0)

    covered: NDArray[np.bool_] = np.isfinite(depth)
    image: FloatArray = np.full((height, width, 3), PAPER_RGB)
    surface: FloatArray = SHADOW_RGB + (SURFACE_RGB - SHADOW_RGB) * intensity[:, :, np.newaxis]
    image[covered] = surface[covered]

    edges: NDArray[np.bool_] = _edge_mask(depth, normals, DEPTH_STEP_RATIO * float(np.ptp(depth[covered])) + 1.0)
    image[edges] = image[edges] * (1.0 - EDGE_STRENGTH) + INK_RGB * EDGE_STRENGTH

    downsampled: FloatArray = image.reshape(
        THUMBNAIL_HEIGHT, SUPERSAMPLE, THUMBNAIL_WIDTH, SUPERSAMPLE, 3
    ).mean(axis=(1, 3))
    return np.clip(np.rint(downsampled), 0.0, 255.0).astype(np.uint8)


def encode_png(pixels: NDArray[np.uint8]) -> bytes:
    height, width, _ = pixels.shape
    rows: NDArray[np.uint8] = np.concatenate(
        (np.zeros((height, 1), dtype=np.uint8), pixels.reshape(height, width * 3)), axis=1
    )

    def chunk(kind: bytes, payload: bytes) -> bytes:
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload))

    return b"".join(
        (
            b"\x89PNG\r\n\x1a\n",
            chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)),
            chunk(b"IDAT", zlib.compress(rows.tobytes(), 9)),
            chunk(b"IEND", b""),
        )
    )


def _write_atomic(path: Path, content: bytes) -> None:
    temporary: Path = path.with_name(f"{path.name}.partial")
    temporary.write_bytes(content)
    os.replace(temporary, path)


def export_preview(step_path: Path, output_dir: Path) -> None:
    mesh: DisplayMesh = build_display_mesh(read_step(step_path))
    model: bytes = encode_mesh(mesh)
    thumbnail: bytes = encode_png(render_thumbnail(mesh))
    output_dir.mkdir(parents=True, exist_ok=True)
    _write_atomic(output_dir / MODEL_FILE_NAME, model)
    _write_atomic(output_dir / THUMBNAIL_FILE_NAME, thumbnail)


def main(arguments: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Write a display mesh and thumbnail for a STEP file.")
    parser.add_argument("step_file", type=Path, help="path to a STEP file")
    parser.add_argument("output_dir", type=Path, help="directory that receives the preview files")
    options: argparse.Namespace = parser.parse_args(arguments)

    try:
        export_preview(options.step_file, options.output_dir)
    except Exception as error:
        print(f"error: failed to export preview: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
