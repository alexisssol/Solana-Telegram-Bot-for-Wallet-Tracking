import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import fs from "fs";
import path from "path";
import { DB_PATH, LOGFILE, PUMP_FUN_ADDRESS } from "../config/config";
import { Metaplex } from "@metaplex-foundation/js";
import { get } from "http";

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

export async function getSignature2CA(connection: any, signature: string) {
  const txn = await connection.getParsedTransaction(signature, {
    maxSupportedTransactionVersion: 0,
  });
  //@ts-ignore
  const ca = txn?.transaction.message.instructions.find(
    (ix: any) => ix.programId.toString() === PUMP_FUN_ADDRESS
  )?.accounts as PublicKey[];
  if (ca && ca[2]) return ca[2];
  return undefined;
}

export async function getTokenInfo(connection: any, ca: string) {
  let symbol = "Unknown";
  let mc = "";
  try {
    const metaplex = new Metaplex(connection);
    const mintAddress = new PublicKey(ca);
    const metadata = await metaplex.nfts().findByMint({ mintAddress });

    symbol = metadata.symbol;
    const decimal = metadata.mint.decimals;
    const supply = Number(metadata.mint.supply.basisPoints) / 10 ** decimal;
    const price = await getTokenPrice(ca);
    mc = changeStyle(supply * price);

  } catch (e) {
    console.log(e);
  } finally {
    return {
      symbol,
      mc
    };
  }
}

export const changeStyle = (input: number): string => {
  return input.toLocaleString();
};

export const getTokenPrice = async (ca: string) => {
  try {
    const BaseURL = `https://api.jup.ag/price/v2?ids=${ca}`;

    const response = await fetch(BaseURL);
    const data = await response.json();
    // console.log("data", data);
    const price = data.data[ca]?.price;
    return price;
  } catch (error) {
    return 0;
  }
};

export const txnLink = (txn: string) => {
  return `<a href="https://solscan.io/tx/${txn}">TX</a>`;
};

export const shortenAddress = (address: string, chars = 4): string => {
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
};

export const shortenAddressWithLink = (address: string, symbol:string): string => {
  return `<a href="https://solscan.io/account/${address}">${symbol}</a>`;
};

export const birdeyeLink = (address: string) => {
  return `<a href="https://birdeye.so/token/${address}?chain=solana">BE</a>`;
};

export const dextoolLink = (address: string) => {
  return `<a href="https://www.dextools.io/app/en/solana/pair-explorer/${address}">DT</a>`;
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
