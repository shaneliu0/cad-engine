#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from OCP.Bnd import Bnd_Box
from OCP.BRep import BRep_Builder, BRep_Tool
from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepClass3d import BRepClass3d, BRepClass3d_SolidClassifier
from OCP.BRepGProp import BRepGProp
from OCP.collections import IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher as ShapeMap
from OCP.GeomAbs import GeomAbs_Cone, GeomAbs_Cylinder, GeomAbs_Line, GeomAbs_Plane
from OCP.GProp import GProp_GProps
from OCP.IFSelect import IFSelect_RetDone
from OCP.Interface import Interface_CheckFail
from OCP.Message import Message
from OCP.STEPControl import STEPControl_Reader
from OCP.TopLoc import TopLoc_Location
from OCP.TopAbs import (
    TopAbs_EDGE,
    TopAbs_FACE,
    TopAbs_IN,
    TopAbs_OUT,
    TopAbs_REVERSED,
    TopAbs_ShapeEnum,
    TopAbs_SOLID,
    TopAbs_VERTEX,
)
from OCP.TopExp import TopExp
from OCP.TopoDS import TopoDS, TopoDS_Compound, TopoDS_Face, TopoDS_Shape
from OCP.gp import gp_Ax3, gp_Dir, gp_Pnt, gp_Trsf, gp_Vec

Vec3 = tuple[float, float, float]

MM3_PER_CM3: float = 1000.0
MM2_PER_CM2: float = 100.0
GPROP_RELATIVE_EPSILON: float = 1e-6

LINEAR_TOLERANCE_MM: float = 1e-3
AXIS_PARALLEL_TOLERANCE: float = 1e-4
CLASSIFIER_TOLERANCE_MM: float = 1e-6
AXIAL_PROBE_OFFSET_MM: float = 0.01

TWO_PI: float = 2.0 * math.pi
MIN_HOLE_COVERAGE_RAD: float = 1.5 * math.pi

PRISM_FACE_COUNT: int = 6
COMPLEXITY_COEFFICIENT: float = 0.263

MIN_DATUM_NORMAL_AREA_FRACTION: float = 0.05
MIN_DATUM_EDGE_PART_SPAN_FRACTION: float = 0.25
BOX_VOLUME_TIE_TOLERANCE: float = 1e-5


class GeometryError(Exception):
    pass


@dataclass(frozen=True)
class AxialSegment:

    is_cylinder: bool
    radius_mm: float
    origin: Vec3
    direction: Vec3
    start_point: Vec3
    quarter_point: Vec3
    span_rad: float
    axial_points: tuple[Vec3, Vec3]


@dataclass(frozen=True)
class Hole:

    diameters_mm: tuple[float, ...]
    axis: Vec3
    location_mm: Vec3
    depth_mm: float
    is_through: bool


@dataclass
class _AxisCluster:
    origin: Vec3
    direction: Vec3
    segments: list[AxialSegment]


@dataclass(frozen=True)
class _Interval:
    start: float
    end: float
    segment: AxialSegment


def _sub(a: Vec3, b: Vec3) -> Vec3:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _dot(a: Vec3, b: Vec3) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _cross(a: Vec3, b: Vec3) -> Vec3:
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def _scale(a: Vec3, factor: float) -> Vec3:
    return (a[0] * factor, a[1] * factor, a[2] * factor)


def _add(a: Vec3, b: Vec3) -> Vec3:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def _length(a: Vec3) -> float:
    return math.sqrt(_dot(a, a))


def _normalize(a: Vec3) -> Vec3:
    return _scale(a, 1.0 / _length(a))


def _as_tuple(xyz: gp_Pnt | gp_Vec) -> Vec3:
    return (xyz.X(), xyz.Y(), xyz.Z())


def _silence_native_console_output() -> None:
    messenger = Message.DefaultMessenger_s()
    for printer in list(messenger.Printers()):
        messenger.RemovePrinter(printer)


def read_step(path: Path) -> TopoDS_Shape:
    if not path.is_file():
        raise GeometryError(f"file not found: {path}")
    if not os.access(path, os.R_OK):
        raise GeometryError(f"file is not readable: {path}")

    _silence_native_console_output()
    reader = STEPControl_Reader()
    if reader.ReadFile(str(path)) != IFSelect_RetDone:
        raise GeometryError(f"could not parse STEP file: {path}")
    if reader.WS().ModelCheckList(False).Complies(Interface_CheckFail):
        raise GeometryError(f"STEP file contains corrupt entities: {path}")
    transferred_roots: int = reader.TransferRoots()
    if transferred_roots < reader.NbRootsForTransfer():
        raise GeometryError(f"STEP file has roots that failed to transfer: {path}")
    if reader.NbShapes() == 0:
        raise GeometryError(f"STEP file contains no transferable shapes: {path}")

    shape: TopoDS_Shape = reader.OneShape()
    if shape.IsNull():
        raise GeometryError(f"STEP file produced an empty shape: {path}")
    return _validated_solids(shape, _declared_solid_count(reader), path)


def _declared_solid_count(reader: STEPControl_Reader) -> int:
    model = reader.StepModel()
    return sum(
        model.Entity(index).IsKind("StepShape_ManifoldSolidBrep")
        for index in range(1, model.NbEntities() + 1)
    )


def _validated_solids(shape: TopoDS_Shape, declared_solids: int, path: Path) -> TopoDS_Compound:
    solids: ShapeMap = _unique_subshapes(shape, TopAbs_SOLID)
    if solids.Extent() == 0:
        raise GeometryError(f"STEP file contains no solid geometry: {path}")
    if solids.Extent() < declared_solids:
        raise GeometryError(f"STEP file has solids that failed to transfer: {path}")

    builder = BRep_Builder()
    compound = TopoDS_Compound()
    builder.MakeCompound(compound)
    for index in range(1, solids.Extent() + 1):
        solid: TopoDS_Shape = solids.FindKey(index)
        if not BRepCheck_Analyzer(solid).IsValid():
            raise GeometryError(f"STEP file contains an invalid solid: {path}")
        builder.Add(compound, solid)
    return compound


def _unique_subshapes(shape: TopoDS_Shape, kind: TopAbs_ShapeEnum) -> ShapeMap:
    subshapes = ShapeMap()
    TopExp.MapShapes_s(shape, kind, subshapes)
    return subshapes


def count_edges(shape: TopoDS_Shape) -> int:
    edges: ShapeMap = _unique_subshapes(shape, TopAbs_EDGE)
    return sum(
        not BRep_Tool.Degenerated_s(TopoDS.Edge(edges.FindKey(index)))
        for index in range(1, edges.Extent() + 1)
    )


def _axis_aligned_extents(shape: TopoDS_Shape) -> Vec3:
    box = Bnd_Box()
    BRepBndLib.AddOptimal_s(shape, box, False, False)
    low: gp_Pnt = box.CornerMin()
    high: gp_Pnt = box.CornerMax()
    return (high.X() - low.X(), high.Y() - low.Y(), high.Z() - low.Z())


def _merge_parallel(weighted: list[tuple[Vec3, float]]) -> list[tuple[Vec3, float]]:
    merged: list[tuple[Vec3, float]] = []
    for direction, weight in weighted:
        for index, (existing, total) in enumerate(merged):
            if _length(_cross(existing, direction)) <= AXIS_PARALLEL_TOLERANCE:
                merged[index] = (existing, total + weight)
                break
        else:
            merged.append((direction, weight))
    return sorted(merged, key=lambda item: -item[1])


def _part_span_mm(shape: TopoDS_Shape) -> float:
    vertices: ShapeMap = _unique_subshapes(shape, TopAbs_VERTEX)
    points: list[Vec3] = [
        _as_tuple(BRep_Tool.Pnt_s(TopoDS.Vertex(vertices.FindKey(index))))
        for index in range(1, vertices.Extent() + 1)
    ]
    center: Vec3 = _scale(
        (sum(p[0] for p in points), sum(p[1] for p in points), sum(p[2] for p in points)),
        1.0 / len(points),
    )
    return 2.0 * max(_length(_sub(point, center)) for point in points)


def _datum_normals(shape: TopoDS_Shape) -> list[Vec3]:
    faces: ShapeMap = _unique_subshapes(shape, TopAbs_FACE)
    weighted: list[tuple[Vec3, float]] = []
    for index in range(1, faces.Extent() + 1):
        face: TopoDS_Face = TopoDS.Face(faces.FindKey(index))
        surface = BRepAdaptor_Surface(face, True)
        if surface.GetType() == GeomAbs_Plane:
            weighted.append((_as_tuple(surface.Plane().Axis().Direction()), surface_area_mm2(face)))
    minimum: float = MIN_DATUM_NORMAL_AREA_FRACTION * surface_area_mm2(shape)
    return [normal for normal, area in _merge_parallel(weighted) if area >= minimum]


def _datum_edge_directions(shape: TopoDS_Shape) -> list[Vec3]:
    edges: ShapeMap = _unique_subshapes(shape, TopAbs_EDGE)
    minimum: float = MIN_DATUM_EDGE_PART_SPAN_FRACTION * _part_span_mm(shape)
    weighted: list[tuple[Vec3, float]] = []
    for index in range(1, edges.Extent() + 1):
        edge = TopoDS.Edge(edges.FindKey(index))
        if BRep_Tool.Degenerated_s(edge):
            continue
        curve = BRepAdaptor_Curve(edge)
        if curve.GetType() == GeomAbs_Line:
            length: float = curve.LastParameter() - curve.FirstParameter()
            if length >= minimum:
                weighted.append((_as_tuple(curve.Line().Direction()), length))
    return [direction for direction, _ in _merge_parallel(weighted)]


def _datum_aligned_extents(shape: TopoDS_Shape) -> list[Vec3]:
    directions: list[Vec3] = _datum_edge_directions(shape)
    extents: list[Vec3] = []
    for normal in _datum_normals(shape):
        for direction in directions:
            if abs(_dot(normal, direction)) > AXIS_PARALLEL_TOLERANCE:
                continue
            frame = gp_Trsf()
            frame.SetTransformation(gp_Ax3(gp_Pnt(0.0, 0.0, 0.0), gp_Dir(*normal), gp_Dir(*direction)))
            extents.append(_axis_aligned_extents(shape.Moved(TopLoc_Location(frame))))
    return extents


def _is_tighter_box(candidate: Vec3, best: Vec3) -> bool:
    candidate_volume: float = candidate[0] * candidate[1] * candidate[2]
    best_volume: float = best[0] * best[1] * best[2]
    tolerance: float = BOX_VOLUME_TIE_TOLERANCE * best_volume
    if candidate_volume < best_volume - tolerance:
        return True
    return (
        candidate_volume <= best_volume + tolerance
        and max(candidate) < max(best) * (1.0 - BOX_VOLUME_TIE_TOLERANCE)
    )


def bounding_box_mm(shape: TopoDS_Shape) -> tuple[float, float, float]:
    best: Vec3 = _axis_aligned_extents(shape)
    for candidate in _datum_aligned_extents(shape):
        if _is_tighter_box(candidate, best):
            best = candidate
    return best


def volume_mm3(shape: TopoDS_Shape) -> float:
    properties = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, properties, GPROP_RELATIVE_EPSILON, False, False)
    return abs(properties.Mass())


def surface_area_mm2(shape: TopoDS_Shape) -> float:
    properties = GProp_GProps()
    BRepGProp.SurfaceProperties_s(shape, properties, GPROP_RELATIVE_EPSILON, True)
    return properties.Mass()


def _concave_segment(face: TopoDS_Face) -> AxialSegment | None:
    surface = BRepAdaptor_Surface(face, True)
    surface_type = surface.GetType()
    if surface_type == GeomAbs_Cylinder:
        cylinder = surface.Cylinder()
        axis_placement = cylinder.Axis()
        radius: float = cylinder.Radius()
        is_cylinder: bool = True
    elif surface_type == GeomAbs_Cone:
        cone = surface.Cone()
        axis_placement = cone.Axis()
        radius = cone.RefRadius()
        is_cylinder = False
    else:
        return None

    origin: Vec3 = _as_tuple(axis_placement.Location())
    direction: Vec3 = _as_tuple(axis_placement.Direction())
    u_first: float = surface.FirstUParameter()
    u_last: float = surface.LastUParameter()
    v_first: float = surface.FirstVParameter()
    v_last: float = surface.LastVParameter()
    u_mid: float = 0.5 * (u_first + u_last)
    v_mid: float = 0.5 * (v_first + v_last)
    span: float = min(u_last - u_first, TWO_PI)

    point = gp_Pnt()
    d1u = gp_Vec()
    d1v = gp_Vec()
    surface.D1(u_mid, v_mid, point, d1u, d1v)
    normal: Vec3 = _cross(_as_tuple(d1u), _as_tuple(d1v))
    if face.Orientation() == TopAbs_REVERSED:
        normal = _scale(normal, -1.0)

    mid_point: Vec3 = _as_tuple(point)
    offset: Vec3 = _sub(mid_point, origin)
    radial: Vec3 = _sub(offset, _scale(direction, _dot(offset, direction)))
    if _dot(normal, radial) >= 0.0:
        return None

    return AxialSegment(
        is_cylinder=is_cylinder,
        radius_mm=radius,
        origin=origin,
        direction=direction,
        start_point=_as_tuple(surface.Value(u_first, v_mid)),
        quarter_point=_as_tuple(surface.Value(u_first + 0.25 * span, v_mid)),
        span_rad=span,
        axial_points=(
            _as_tuple(surface.Value(u_mid, v_first)),
            _as_tuple(surface.Value(u_mid, v_last)),
        ),
    )


def _cluster_by_axis(segments: list[AxialSegment]) -> list[_AxisCluster]:
    clusters: list[_AxisCluster] = []
    for segment in segments:
        for cluster in clusters:
            if _length(_cross(cluster.direction, segment.direction)) > AXIS_PARALLEL_TOLERANCE:
                continue
            offset: Vec3 = _sub(segment.origin, cluster.origin)
            axial: Vec3 = _scale(cluster.direction, _dot(offset, cluster.direction))
            if _length(_sub(offset, axial)) <= LINEAR_TOLERANCE_MM:
                cluster.segments.append(segment)
                break
        else:
            clusters.append(_AxisCluster(segment.origin, segment.direction, [segment]))
    return clusters


def _reference_vector(direction: Vec3) -> Vec3:
    helper: Vec3 = (1.0, 0.0, 0.0) if abs(direction[0]) < 0.9 else (0.0, 1.0, 0.0)
    return _normalize(_cross(direction, helper))


def _angle_about(point: Vec3, cluster: _AxisCluster, reference: Vec3, binormal: Vec3) -> float:
    offset: Vec3 = _sub(point, cluster.origin)
    return math.atan2(_dot(offset, binormal), _dot(offset, reference))


def _angular_interval(
    segment: AxialSegment, cluster: _AxisCluster, reference: Vec3, binormal: Vec3
) -> tuple[float, float]:
    start: float = _angle_about(segment.start_point, cluster, reference, binormal)
    quarter: float = _angle_about(segment.quarter_point, cluster, reference, binormal)
    delta: float = math.atan2(math.sin(quarter - start), math.cos(quarter - start))
    if delta >= 0.0:
        return start, segment.span_rad
    return start - segment.span_rad, segment.span_rad


def _angular_coverage(arcs: list[tuple[float, float]]) -> float:
    pieces: list[tuple[float, float]] = []
    for start, span in arcs:
        if span >= TWO_PI:
            return TWO_PI
        begin: float = start % TWO_PI
        end: float = begin + span
        if end <= TWO_PI:
            pieces.append((begin, end))
        else:
            pieces.append((begin, TWO_PI))
            pieces.append((0.0, end - TWO_PI))

    pieces.sort()
    covered: float = 0.0
    current_start, current_end = pieces[0]
    for begin, end in pieces[1:]:
        if begin <= current_end:
            current_end = max(current_end, end)
        else:
            covered += current_end - current_start
            current_start, current_end = begin, end
    return covered + current_end - current_start


def _axial_interval(segment: AxialSegment, cluster: _AxisCluster) -> _Interval:
    first: float = _dot(_sub(segment.axial_points[0], cluster.origin), cluster.direction)
    second: float = _dot(_sub(segment.axial_points[1], cluster.origin), cluster.direction)
    return _Interval(min(first, second), max(first, second), segment)


def _closed_at_some_station(spans: list[tuple[_Interval, tuple[float, float]]]) -> set[_Interval]:
    bounds: list[float] = sorted({value for item, _ in spans for value in (item.start, item.end)})
    closed: set[_Interval] = set()
    for low, high in zip(bounds, bounds[1:]):
        if high - low <= LINEAR_TOLERANCE_MM:
            continue
        station: float = 0.5 * (low + high)
        active = [(item, arc) for item, arc in spans if item.start <= station <= item.end]
        if active and _angular_coverage([arc for _, arc in active]) >= MIN_HOLE_COVERAGE_RAD:
            closed.update(item for item, _ in active)
    return closed


def _closed_cylinder_intervals(cluster: _AxisCluster) -> list[_Interval]:
    reference: Vec3 = _reference_vector(cluster.direction)
    binormal: Vec3 = _cross(cluster.direction, reference)

    by_radius: list[list[AxialSegment]] = []
    for segment in cluster.segments:
        if not segment.is_cylinder:
            continue
        for group in by_radius:
            if abs(group[0].radius_mm - segment.radius_mm) <= LINEAR_TOLERANCE_MM:
                group.append(segment)
                break
        else:
            by_radius.append([segment])

    intervals: list[_Interval] = []
    for group in by_radius:
        spans: list[tuple[_Interval, tuple[float, float]]] = [
            (
                _axial_interval(segment, cluster),
                _angular_interval(segment, cluster, reference, binormal),
            )
            for segment in group
        ]
        intervals.extend(_closed_at_some_station(spans))
    return intervals


def _axial_chains(intervals: list[_Interval]) -> list[list[_Interval]]:
    chains: list[list[_Interval]] = []
    chain_end: float = -math.inf
    for interval in sorted(intervals, key=lambda item: item.start):
        if chains and interval.start <= chain_end + LINEAR_TOLERANCE_MM:
            chains[-1].append(interval)
            chain_end = max(chain_end, interval.end)
        else:
            chains.append([interval])
            chain_end = interval.end
    return chains


def _point_on_axis(cluster: _AxisCluster, axial_position: float) -> gp_Pnt:
    x, y, z = _add(cluster.origin, _scale(cluster.direction, axial_position))
    return gp_Pnt(x, y, z)


def _build_hole(
    chain: list[_Interval], cluster: _AxisCluster, classifier: BRepClass3d_SolidClassifier
) -> Hole | None:
    cylinders: list[_Interval] = [item for item in chain if item.segment.is_cylinder]
    if not cylinders:
        return None

    longest: _Interval = max(cylinders, key=lambda item: item.end - item.start)
    classifier.Perform(
        _point_on_axis(cluster, 0.5 * (longest.start + longest.end)), CLASSIFIER_TOLERANCE_MM
    )
    if classifier.State() != TopAbs_OUT:
        return None

    start: float = min(item.start for item in chain)
    end: float = max(item.end for item in chain)
    is_open_at_both_ends: bool = True
    for probe in (start - AXIAL_PROBE_OFFSET_MM, end + AXIAL_PROBE_OFFSET_MM):
        classifier.Perform(_point_on_axis(cluster, probe), CLASSIFIER_TOLERANCE_MM)
        if classifier.State() == TopAbs_IN:
            is_open_at_both_ends = False

    diameters: set[float] = {round(2.0 * item.segment.radius_mm, 4) for item in cylinders}
    midpoint: Vec3 = _add(cluster.origin, _scale(cluster.direction, 0.5 * (start + end)))
    return Hole(
        diameters_mm=tuple(sorted(diameters)),
        axis=cluster.direction,
        location_mm=midpoint,
        depth_mm=end - start,
        is_through=is_open_at_both_ends,
    )


def _holes_in_solid(solid: TopoDS_Shape) -> list[Hole]:
    outer_shell: TopoDS_Shape = BRepClass3d.OuterShell_s(TopoDS.Solid(solid))
    faces: ShapeMap = _unique_subshapes(outer_shell, TopAbs_FACE)
    segments: list[AxialSegment] = []
    for index in range(1, faces.Extent() + 1):
        segment: AxialSegment | None = _concave_segment(TopoDS.Face(faces.FindKey(index)))
        if segment is not None:
            segments.append(segment)

    classifier = BRepClass3d_SolidClassifier(solid)
    holes: list[Hole] = []
    for cluster in _cluster_by_axis(segments):
        closed: list[_Interval] = _closed_cylinder_intervals(cluster)
        if not closed:
            continue
        cones: list[_Interval] = [
            _axial_interval(segment, cluster)
            for segment in cluster.segments
            if not segment.is_cylinder
        ]
        for chain in _axial_chains(closed + cones):
            hole: Hole | None = _build_hole(chain, cluster, classifier)
            if hole is not None:
                holes.append(hole)
    return holes


def detect_holes(shape: TopoDS_Shape) -> list[Hole]:
    solids: ShapeMap = _unique_subshapes(shape, TopAbs_SOLID)
    holes: list[Hole] = []
    for index in range(1, solids.Extent() + 1):
        holes.extend(_holes_in_solid(solids.FindKey(index)))
    return sorted(holes, key=lambda hole: hole.location_mm)


def complexity_score(face_count: int) -> float:
    return 1.0 + COMPLEXITY_COEFFICIENT * math.log10(
        max(face_count, PRISM_FACE_COUNT) / PRISM_FACE_COUNT
    )


def analyze(path: Path) -> dict[str, Any]:
    shape: TopoDS_Shape = read_step(path)

    extents: tuple[float, float, float] = bounding_box_mm(shape)
    length, width, height = sorted(extents, reverse=True)
    volume: float = volume_mm3(shape)
    area: float = surface_area_mm2(shape)
    if not all(map(math.isfinite, (length, width, height, volume, area))):
        raise GeometryError(f"STEP file produced non-finite measurements: {path}")
    face_count: int = _unique_subshapes(shape, TopAbs_FACE).Extent()

    return {
        "file": path.name,
        "bounding_box_mm": {
            "length": round(length, 1),
            "width": round(width, 1),
            "height": round(height, 1),
        },
        "volume_cm3": round(volume / MM3_PER_CM3, 1),
        "surface_area_cm2": round(area / MM2_PER_CM2, 1),
        "features": {
            "face_count": face_count,
            "edge_count": count_edges(shape),
            "holes_detected": len(detect_holes(shape)),
            "complexity_score": round(complexity_score(face_count), 2),
        },
    }


def main(arguments: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Print STEP file geometry data as JSON.")
    parser.add_argument("step_file", type=Path, help="path to a STEP file")
    options: argparse.Namespace = parser.parse_args(arguments)

    try:
        report: dict[str, Any] = analyze(options.step_file)
    except GeometryError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    except Exception as error:
        print(f"error: failed to process {options.step_file}: {error}", file=sys.stderr)
        return 1

    print(json.dumps(report, indent=4))
    return 0


if __name__ == "__main__":
    sys.exit(main())
