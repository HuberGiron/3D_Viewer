import test from "node:test";
import assert from "node:assert/strict";
import {
  validatePositions,
  weldVertices,
  encodeMZ3,
  decodeMZ3,
  exportBinarySTL,
  binarySTLSize,
} from "../mesh-utils.js";
import { STLLoader } from "../vendor/three/addons/loaders/STLLoader.js";

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const square = new Float32Array([
  0, 0, 0, 1, 0, 0, 1, 1, 0, -0, 0, 0, 1, 1, 0, 0, 1, 0,
]);

test("exact welding shares edges, canonicalizes signed zero, preserves winding", () => {
  const result = weldVertices(square);
  assert.equal(result.positions.length, 12);
  assert.deepEqual([...result.indices], [0, 1, 2, 0, 2, 3]);
  const almost = square.slice();
  almost[9] = 1e-8;
  assert.equal(weldVertices(almost).positions.length, 15);
});
test("welding filters duplicate and collinear zero-area triangles", () => {
  const positions = new Float32Array([
    ...square,
    0,
    0,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    2,
    0,
    0,
  ]);
  assert.equal(weldVertices(positions).indices.length / 3, 2);
});
test("MZ3 round trip preserves indices, units and offset across scales", () => {
  for (const factor of [1e-6, 1, 1e6]) {
    const source = square.map((v) => (v + 15) * factor);
    const { center, scale } = validatePositions(source),
      mesh = weldVertices(source);
    const encoded = encodeMZ3(mesh.positions, mesh.indices, center, scale);
    const result = decodeMZ3(encoded, center, scale);
    assert.deepEqual(result.indices, mesh.indices);
    for (let i = 0; i < result.positions.length; i++)
      assert.ok(
        Math.abs(result.positions[i] - mesh.positions[i]) <= factor * 1e-5,
      );
  }
});
test("binary STL export bakes rotation and translation and reopens in STLLoader", () => {
  const matrix = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1];
  const mesh = weldVertices(square);
  for (const input of [{ positions: square, indices: null }, mesh]) {
    const buffer = exportBinarySTL(input.positions, input.indices, matrix);
    assert.equal(buffer.byteLength, binarySTLSize(2));
    const geometry = new STLLoader().parse(buffer);
    assert.deepEqual(
      [...geometry.attributes.position.array.slice(0, 9)],
      [10, 20, 30, 10, 21, 30, 9, 21, 30],
    );
    assert.equal(geometry.attributes.position.count / 3, 2);
    assert.equal(new DataView(buffer).getFloat32(92, true), 1);
  }
});
test("invalid empty, incomplete, nonfinite and out-of-bounds meshes fail explicitly", () => {
  for (const p of [
    new Float32Array(),
    new Float32Array([1, 2]),
    new Float32Array(9),
    new Float32Array([...square.slice(0, 8), NaN]),
  ])
    assert.throws(() => validatePositions(p));
  assert.throws(() => validatePositions(square, new Uint32Array([0, 1, 999])));
  assert.throws(() => decodeMZ3(new Uint8Array(16), [0, 0, 0], 1));
  assert.throws(() =>
    exportBinarySTL(
      square,
      null,
      identity.map(() => Infinity),
    ),
  );
});
