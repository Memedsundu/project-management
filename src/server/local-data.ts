import os from "node:os";
import path from "node:path";

/**
 * Where a laptop keeps the development database and uploaded files.
 * Outside the project folder on purpose: the dev server watches the project
 * and would reload the page on every database write.
 */
export function localDataDir() {
  return process.env.LOCAL_DATA_DIR ?? path.join(os.homedir(), ".proje-calisma-alani");
}
