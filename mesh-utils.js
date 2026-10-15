// Data-only helpers shared by the worker and tests. No DOM or GPU allocations.
export const triangleCount = (positions, indices) =>
  (indices?.length ?? positions.length / 3) / 3;
export const binarySTLSize = (count) => 84 + 50 * count;

export function validatePositions(positions, indices = null) {
  if (
    !positions.length ||
    positions.length % 3 ||
    (!indices && positions.length % 9)
  ) {
    throw new Error("El STL no contiene triángulos completos.");
  }
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    const value = positions[i],
      axis = i % 3;
    if (!Number.isFinite(value))
      throw new Error("El modelo contiene coordenadas no válidas.");
    min[axis] = Math.min(min[axis], value);
    max[axis] = Math.max(max[axis], value);
  }
  if (indices) {
    if (!indices.length || indices.length % 3)
      throw new Error("Índices de triángulos no válidos.");
    for (const index of indices)
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= positions.length / 3
      )
        throw new Error("Índice fuera del modelo.");
  }
  const scale = Math.max(...max.map((v, i) => v - min[i]));
  if (!(scale > 0) || !Number.isFinite(scale))
    throw new Error("El modelo no tiene dimensiones válidas.");
  return { center: min.map((v, i) => (v + max[i]) / 2), scale };
}

// STL duplicates vertices per face. Weld EXACT float32 coordinates using an open
// addressing table, avoiding millions of JS objects/string keys and fuzzy merges.
export function weldVertices(positions) {
  const count = positions.length / 3;
  let capacity = 16;
  while (capacity < count * 1.5) capacity *= 2;
  const table = new Uint32Array(capacity),
    mask = capacity - 1;
  const bits = new Uint32Array(
    positions.buffer,
    positions.byteOffset,
    positions.length,
  );
  const vertices = new Float32Array(positions.length);
  const vertexBits = new Uint32Array(vertices.buffer);
  const indices = new Uint32Array(count);
  let unique = 0,
    faces = 0;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] === 0 ? 0 : bits[i];
    const y = positions[i + 1] === 0 ? 0 : bits[i + 1];
    const z = positions[i + 2] === 0 ? 0 : bits[i + 2];
    let hash =
      Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791);
    hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
    let slot = (hash ^ (hash >>> 15)) & mask;
    while (table[slot]) {
      const offset = (table[slot] - 1) * 3;
      if (
        vertexBits[offset] === x &&
        vertexBits[offset + 1] === y &&
        vertexBits[offset + 2] === z
      )
        break;
      slot = (slot + 1) & mask;
    }
    if (!table[slot]) {
      const offset = unique * 3;
      vertexBits[offset] = x;
      vertexBits[offset + 1] = y;
      vertexBits[offset + 2] = z;
      table[slot] = ++unique;
    }
    indices[i / 3] = table[slot] - 1;
  }
  // Remove zero-area faces before the QEM normal calculation.
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3,
      b = indices[i + 1] * 3,
      c = indices[i + 2] * 3;
    const ux = vertices[b] - vertices[a],
      uy = vertices[b + 1] - vertices[a + 1],
      uz = vertices[b + 2] - vertices[a + 2];
    const vx = vertices[c] - vertices[a],
      vy = vertices[c + 1] - vertices[a + 1],
      vz = vertices[c + 2] - vertices[a + 2];
    if (
      uy * vz - uz * vy === 0 &&
      uz * vx - ux * vz === 0 &&
      ux * vy - uy * vx === 0
    )
      continue;
    indices[faces++] = indices[i];
    indices[faces++] = indices[i + 1];
    indices[faces++] = indices[i + 2];
  }
  return {
    positions: vertices.subarray(0, unique * 3),
    indices: indices.subarray(0, faces),
  };
}

export function encodeMZ3(positions, indices, center, scale) {
  const buffer = new ArrayBuffer(
    16 + indices.byteLength + positions.byteLength,
  );
  const view = new DataView(buffer);
  view.setUint16(0, 0x5a4d, true);
  view.setUint16(2, 3, true);
  view.setUint32(4, indices.length / 3, true);
  view.setUint32(8, positions.length / 3, true);
  new Uint32Array(buffer, 16, indices.length).set(indices);
  const out = new Float32Array(
    buffer,
    16 + indices.byteLength,
    positions.length,
  );
  // Normalize to a common size: upstream's error threshold is scale-dependent.
  for (let i = 0; i < out.length; i++)
    out[i] = ((positions[i] - center[i % 3]) / scale) * 100;
  return new Uint8Array(buffer);
}

export function decodeMZ3(bytes, center, scale) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.byteLength < 16 ||
    view.getUint16(0, true) !== 0x5a4d ||
    view.getUint16(2, true) !== 3
  )
    throw new Error("Respuesta del simplificador no válida.");
  const faces = view.getUint32(4, true),
    vertices = view.getUint32(8, true),
    skip = view.getUint32(12, true);
  if (
    !faces ||
    !vertices ||
    bytes.length !== 16 + skip + faces * 12 + vertices * 12
  )
    throw new Error("Resultado incompleto del simplificador.");
  const indices = new Uint32Array(faces * 3),
    positions = new Float32Array(vertices * 3);
  for (let i = 0; i < indices.length; i++)
    indices[i] = view.getUint32(16 + skip + i * 4, true);
  const offset = 16 + skip + indices.byteLength;
  for (let i = 0; i < positions.length; i++)
    positions[i] =
      (view.getFloat32(offset + i * 4, true) * scale) / 100 + center[i % 3];
  validatePositions(positions, indices);
  return { positions, indices };
}

export function exportBinarySTL(positions, indices, matrix) {
  validatePositions(positions, indices);
  if (matrix.length !== 16 || !matrix.every(Number.isFinite))
    throw new Error("Transformación no válida.");
  const count = triangleCount(positions, indices);
  const buffer = new ArrayBuffer(binarySTLSize(count)),
    view = new DataView(buffer);
  new Uint8Array(buffer).set(
    new TextEncoder().encode("IBERO STL Viewer - binary STL"),
  );
  view.setUint32(80, count, true);
  const v = new Float64Array(9);
  for (let t = 0; t < count; t++) {
    for (let j = 0; j < 3; j++) {
      const p = (indices ? indices[t * 3 + j] : t * 3 + j) * 3,
        k = j * 3;
      const x = positions[p],
        y = positions[p + 1],
        z = positions[p + 2];
      for (let a = 0; a < 3; a++) {
        v[k + a] =
          matrix[a] * x +
          matrix[4 + a] * y +
          matrix[8 + a] * z +
          matrix[12 + a];
        if (!Number.isFinite(Math.fround(v[k + a])))
          throw new Error("La transformación excede el rango STL.");
      }
    }
    const ux = v[3] - v[0],
      uy = v[4] - v[1],
      uz = v[5] - v[2];
    const vx = v[6] - v[0],
      vy = v[7] - v[1],
      vz = v[8] - v[2];
    const nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1,
      offset = 84 + t * 50;
    view.setFloat32(offset, nx / length, true);
    view.setFloat32(offset + 4, ny / length, true);
    view.setFloat32(offset + 8, nz / length, true);
    for (let i = 0; i < 9; i++)
      view.setFloat32(offset + 12 + i * 4, v[i], true);
  }
  return buffer;
}

// OBJ has independent position indices, so both indexed optimized geometry and
// the original STL triangle soup can be exported without changing their faces.
// Encode in chunks to avoid retaining one huge JavaScript string for heavy meshes.
export function exportOBJ(positions, indices, matrix) {
  validatePositions(positions, indices);
  if (matrix.length !== 16 || !matrix.every(Number.isFinite))
    throw new Error("Transformación no válida.");
  const chunks = [],
    encoder = new TextEncoder();
  let text = "# IBERO STL Viewer - OBJ\n# Units assumed: mm\no modelo\n",
    rows = 0;
  const append = (line) => {
    text += line;
    if (++rows === 4096) {
      chunks.push(encoder.encode(text));
      text = "";
      rows = 0;
    }
  };
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i],
      y = positions[i + 1],
      z = positions[i + 2];
    const transformed = [0, 1, 2].map(
      (axis) =>
        matrix[axis] * x +
        matrix[4 + axis] * y +
        matrix[8 + axis] * z +
        matrix[12 + axis],
    );
    if (!transformed.every(Number.isFinite))
      throw new Error("La transformación excede el rango OBJ.");
    append(`v ${transformed.join(" ")}\n`);
  }
  const count = triangleCount(positions, indices);
  for (let face = 0; face < count; face++) {
    const offset = face * 3;
    const a = (indices ? indices[offset] : offset) + 1;
    const b = (indices ? indices[offset + 1] : offset + 1) + 1;
    const c = (indices ? indices[offset + 2] : offset + 2) + 1;
    append(`f ${a} ${b} ${c}\n`);
  }
  if (text) chunks.push(encoder.encode(text));
  return new Blob(chunks, { type: "text/plain;charset=utf-8" });
}
