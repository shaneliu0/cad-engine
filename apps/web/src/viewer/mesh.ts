const MAGIC: string = "QPM1";
const HEADER_BYTES: number = 16;

export interface PartMesh {
  positions: Float32Array<ArrayBuffer>;
  triangles: Uint32Array<ArrayBuffer>;
  edges: Uint32Array<ArrayBuffer>;
  normals: Int16Array<ArrayBuffer>;
}

export function decodePartMesh(buffer: ArrayBuffer): PartMesh {
  if (buffer.byteLength < HEADER_BYTES) {
    throw new Error("Model data is truncated");
  }
  const view: DataView = new DataView(buffer);
  const magic: string = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3),
  );
  if (magic !== MAGIC) {
    throw new Error("Model data has an unknown format");
  }

  const vertexCount: number = view.getUint32(4, true);
  const triangleCount: number = view.getUint32(8, true);
  const edgeCount: number = view.getUint32(12, true);
  const positionsEnd: number = HEADER_BYTES + vertexCount * 12;
  const trianglesEnd: number = positionsEnd + triangleCount * 12;
  const edgesEnd: number = trianglesEnd + edgeCount * 8;
  const normalsEnd: number = edgesEnd + vertexCount * 6;
  if (buffer.byteLength !== normalsEnd || vertexCount === 0 || triangleCount === 0) {
    throw new Error("Model data is truncated");
  }

  return {
    positions: new Float32Array(buffer, HEADER_BYTES, vertexCount * 3),
    triangles: new Uint32Array(buffer, positionsEnd, triangleCount * 3),
    edges: new Uint32Array(buffer, trianglesEnd, edgeCount * 2),
    normals: new Int16Array(buffer, edgesEnd, vertexCount * 3),
  };
}

export function boundingRadius(positions: Float32Array): number {
  let largest: number = 0;
  for (let index: number = 0; index < positions.length; index += 3) {
    const x: number = positions[index];
    const y: number = positions[index + 1];
    const z: number = positions[index + 2];
    largest = Math.max(largest, x * x + y * y + z * z);
  }
  return Math.sqrt(largest);
}
