import { WalletTracker } from "./utils";
import fs from "fs";
import path from "path";
import { DB_PATH } from "./config/config";
import { clearDB, clearLogs } from "./utils/utils";
async function main() {
  // Delete the .db file if it exists
  clearDB();
  clearLogs();
  const tracker = new WalletTracker();
  await tracker.start();
}

main().catch(console.error);