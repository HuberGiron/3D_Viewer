// Classic worker: Emscripten's upstream distribution uses importScripts.
// A new worker per operation releases WASM heap and all temporaries on termination.
const stage = (message) => self.postMessage({ stage: message });

async function loadSimplifier() {
  return new Promise((resolve, reject) => {
    self.Module = {
      locateFile: (name) =>
        new URL(`./vendor/fast-quadric/${name}`, self.location.href).href,
      print: () => {},
      printErr: () => {},
      onRuntimeInitialized: () => resolve(self.Module),
      onAbort: (reason) =>
        reject(new Error(`No se pudo iniciar WebAssembly: ${reason}`)),
    };
    try {
      importScripts("./vendor/fast-quadric/a.out.js");
    } catch (error) {
      reject(error);
    }
  });
}

self.onmessage = async ({ data }) => {
  try {
    const utils = await import("./mesh-utils.js");
    if (data.type === "load" || data.type === "demo") {
      let geometry;
      if (data.type === "demo") {
        const { TorusKnotGeometry } = await import(
          "./vendor/three/three.module.js"
        );
        const indexed = new TorusKnotGeometry(35, 11, 320, 64);
        geometry = indexed.toNonIndexed();
        indexed.dispose();
      } else {
        stage("Leyendo y validando STL…");
        const buffer = await data.file.arrayBuffer();
        const { STLLoader } = await import(
          "./vendor/three/addons/loaders/STLLoader.js"
        );
        geometry = new STLLoader().parse(buffer);
      }
      const positions = geometry.attributes.position.array;
      const { center } = utils.validatePositions(positions);
      if (data.center)
        for (let i = 0; i < positions.length; i++)
          positions[i] -= center[i % 3];
      self.postMessage({ positions }, [positions.buffer]);
    } else if (data.type === "simplify") {
      const start = performance.now();
      const bounds = utils.validatePositions(data.positions);
      const originalCount = utils.triangleCount(data.positions);
      if (
        !Number.isInteger(data.target) ||
        data.target < 4 ||
        data.target >= originalCount
      )
        throw new Error(
          "El objetivo debe ser de 4 a un triángulo menos que el original.",
        );
      stage("Uniendo vértices y preparando la malla…");
      const mesh = utils.weldVertices(data.positions);
      const inputCount = mesh.indices.length / 3;
      if (inputCount < 4)
        throw new Error("Hay menos de 4 triángulos válidos para simplificar.");
      if (inputCount <= data.target && inputCount < originalCount) {
        // Degenerate removal alone may already meet the requested target.
        const positions = mesh.positions.slice(),
          indices = mesh.indices.slice();
        self.postMessage(
          {
            positions,
            indices,
            elapsed: performance.now() - start,
            removedDegenerate: originalCount - inputCount,
          },
          [positions.buffer, indices.buffer],
        );
        return;
      }
      const target = Math.min(data.target, inputCount);
      stage("Iniciando Fast Quadric WebAssembly…");
      const module = await loadSimplifier();
      const input = utils.encodeMZ3(
        mesh.positions,
        mesh.indices,
        bounds.center,
        bounds.scale,
      );
      module.FS_createDataFile("/", "input.mz3", input, true, true);
      stage("Reduciendo triángulos… Puedes seguir navegando o cancelar.");
      // No OBJ strings: binary MZ3 passes indexed geometry directly to the port.
      const code = module.ccall(
        "simplify",
        "number",
        ["string", "number", "string", "number"],
        ["input.mz3", target / inputCount, "output.mz3", 7],
      );
      if (code !== 0)
        throw new Error(
          "No se pudo reducir más esta malla. Prueba otro objetivo.",
        );
      const result = utils.decodeMZ3(
        module.FS_readFile("output.mz3"),
        bounds.center,
        bounds.scale,
      );
      module.FS_unlink("input.mz3");
      module.FS_unlink("output.mz3");
      if (result.indices.length / 3 >= originalCount)
        throw new Error("No se logró reducir el número de triángulos.");
      self.postMessage(
        {
          ...result,
          elapsed: performance.now() - start,
          removedDegenerate: originalCount - inputCount,
        },
        [result.positions.buffer, result.indices.buffer],
      );
    } else if (data.type === "export") {
      if (data.format === "obj") {
        stage("Preparando OBJ con las transformaciones…");
        const blob = utils.exportOBJ(data.positions, data.indices, data.matrix);
        self.postMessage({ blob });
        return;
      }
      if (data.format && data.format !== "stl")
        throw new Error("Formato de descarga no válido.");
      stage("Preparando STL binario con las transformaciones…");
      const buffer = utils.exportBinarySTL(
        data.positions,
        data.indices,
        data.matrix,
      );
      self.postMessage({ buffer }, [buffer]);
    } else throw new Error("Operación desconocida.");
  } catch (error) {
    self.postMessage({
      error: error?.message || "No se pudo procesar el modelo.",
    });
  }
};
