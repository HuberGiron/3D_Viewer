// Shared between page and service worker. Files stay on this device and are
// removed atomically when claimed. Expired, unclaimed deliveries are pruned.
const DATABASE = `ibero-3d-share:${new URL("./", import.meta.url).pathname}`;
const TTL = 60 * 60 * 1000;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("files", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function putSharedFile(file) {
  const database = await openDatabase();
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("files", "readwrite"),
      store = transaction.objectStore("files");
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      if (!cursor.result) return;
      if (Date.now() - cursor.result.value.created > TTL)
        cursor.result.delete();
      cursor.result.continue();
    };
    store.put({
      id,
      file,
      name: file.name,
      type: file.type,
      created: Date.now(),
    });
    transaction.oncomplete = () => {
      database.close();
      resolve(id);
    };
    transaction.onabort = () => {
      database.close();
      reject(
        transaction.error ||
          new Error("No se pudo guardar el archivo compartido."),
      );
    };
  });
}

export async function takeSharedFile(id) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("files", "readwrite"),
      store = transaction.objectStore("files");
    let file = null;
    const request = store.get(id);
    request.onsuccess = () => {
      const record = request.result;
      if (!record) return;
      if (Date.now() - record.created <= TTL)
        file = new File([record.file], record.name, { type: record.type });
      store.delete(id);
    };
    transaction.oncomplete = () => {
      database.close();
      resolve(file);
    };
    transaction.onabort = () => {
      database.close();
      reject(
        transaction.error ||
          new Error("No se pudo recuperar el archivo compartido."),
      );
    };
  });
}
