import { WalletTracker } from "./utils";

import { clearDB, clearLogs } from "./utils/utils";
async function main() {
  const tracker = new WalletTracker();
  try {
    // clearDB();
    clearLogs();
    await tracker.start();
  } catch (error) {
    tracker.saveLog(`Error starting wallet tracker: ${error} `);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    main();
  }
}

main().catch((error) => {
  console.error("Main process error:", error);
  console.log("Restarting in 3 seconds...");
  setTimeout(main, 3000);
});
