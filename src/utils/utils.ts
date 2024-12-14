import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import fs from "fs";
import path from "path";
import { DB_PATH, LOGFILE } from "../config/config";

export async function getTransactionDetails(
  connection: any,
  signature: string
) {
  const txn = await connection.getParsedTransaction(signature, {
    maxSupportedTransactionVersion: 0,
    commitment: "confirmed",
  });

  if (txn?.meta && txn.transaction) {
    const instructions = txn.transaction.message.instructions;

    const timestamp = txn.blockTime
      ? new Date(txn.blockTime * 1000).toISOString()
      : new Date().toISOString();

    const preBalances = txn.meta.preBalances;
    const postBalances = txn.meta.postBalances;
    const balanceChange = (postBalances[0] - preBalances[0]) / LAMPORTS_PER_SOL;

    const details = {
      signature,
      timestamp,
      balanceChange: `${balanceChange} SOL`,
      sender: txn.transaction.message.accountKeys[0].pubkey.toString(),
      instructions: instructions.map((ix: any) => {
        if ("parsed" in ix) {
          return {
            program: ix.program,
            type: ix.parsed.type,
            receiver: ix.parsed.info.destination,
          };
        }
        return {
          programId: ix.programId.toString(),
        };
      }),
      logs: txn.meta.logs,
    };

    return details;
  }
}

export const txnLink = (txn: string) => {
  return `<a href="https://solscan.io/tx/${txn}">Txn</a>`;
};

export const shortenAddress = (address: string, chars = 4): string => {
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
};

export const shortenAddressWithLink = (address: string, chars = 4): string => {
  return `<a href="https://solscan.io/account/${address}">${shortenAddress(
    address,
    chars
  )}</a>`;
};

export const clearLogs = () => {
  // Clear the log file at startup
  const logPath = path.join(process.cwd(), LOGFILE);
  if (fs.existsSync(logPath)) {
    fs.writeFileSync(logPath, ""); // Write empty string to clear the file
    console.log("wallet_tracker.log cleared successfully");
  }
};

export const clearDB = () => {
  const dbPath = path.join(process.cwd(), DB_PATH);

  if (fs.existsSync(dbPath)) {
    console.log(`${DB_PATH} found, removing...`);
    fs.unlinkSync(dbPath);
    console.log(`${DB_PATH} removed successfully`);
  }
};