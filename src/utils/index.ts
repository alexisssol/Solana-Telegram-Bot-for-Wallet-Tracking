import { Connection, PublicKey } from "@solana/web3.js";
import { Database } from "sqlite3";
import TelegramBot from "node-telegram-bot-api";
import {
  DB_PATH,
  LOG_MAX_SIZE,
  LOGFILE,
  MAIN_WALLET_ADDRESS_1,
  MAIN_WALLET_ADDRESS_2,
  PUMP_FUN_ADDRESS,
  SOLANA_RPC_URL,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHANNEL_ID,
  TRACKED_WALLETS_SIZE,
} from "../config/config";
import {
  birdeyeLink,
  dextoolLink,
  getSignature2CA,
  getTokenInfo,
  getTransactionDetails,
  shortenAddressWithLink,
  txnLink,
} from "./utils";
import * as fs from "fs";

interface WalletTrack {
  address: string;
  timestamp: number;
}

export class WalletTracker {
  private connection: Connection;
  private db: Database;
  private bot: TelegramBot;
  private trackedWallets_1: Map<string, WalletTrack>; // this is from wallet 1
  private trackedWallets_2: Map<string, WalletTrack>; // this is from wallet 2

  private pumpfunTokens: Map<string, number>;

  constructor() {
    this.connection = new Connection(SOLANA_RPC_URL);
    this.db = new Database(DB_PATH);
    const BOT_TOKEN = TELEGRAM_BOT_TOKEN || "";
    this.bot = new TelegramBot(BOT_TOKEN, { polling: false });
    this.trackedWallets_1 = new Map();
    this.trackedWallets_2 = new Map();

    this.pumpfunTokens = new Map();
    // this.initDatabase();
    // this.loadTrackedWallets(1);
    // this.loadTrackedWallets(2);
  }

  // private initDatabase(): void {
  //   this.db.run(`
  //           CREATE TABLE IF NOT EXISTS tracked_wallets (
  //               address TEXT PRIMARY KEY,
  //               timestamp INTEGER
  //           )
  //       `);
  // }
  public saveLog(message: string): void {
    const logFile = LOGFILE;
    const maxSize = LOG_MAX_SIZE;
    // Check current file size
    if (fs.existsSync(logFile)) {
      const stats = fs.statSync(logFile);
      if (stats.size >= maxSize) {
        return; // Skip logging if file is too large
      }
    }

    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(logFile, logMessage);
  }

  // private loadTrackedWallets(wallet_id: number): void {
  //   this.db.all("SELECT * FROM tracked_wallets", (err, rows: WalletTrack[]) => {
  //     if (err) {
  //       console.error("Error loading wallets:", err);
  //       return;
  //     }
  //     rows.forEach((row) => {
  //       if (wallet_id === 1) {
  //         this.trackedWallets_1.set(row.address, row);
  //       } else {
  //         this.trackedWallets_2.set(row.address, row);
  //       }
  //     });
  //   });
  // }

  private async trackNewWallet(
    wallet_id: number,
    address: string
  ): Promise<void> {
    const timestamp = Date.now();
    // this.db.run(
    //   "INSERT INTO tracked_wallets (address, timestamp) VALUES (?, ?)",
    //   [address, timestamp]
    // );
    if (wallet_id === 1)
      this.trackedWallets_1.set(address, { address, timestamp });
    if (wallet_id === 2)
      this.trackedWallets_2.set(address, { address, timestamp });
  }
  private async trackUpdateWallet(
    wallet_id: number,
    address: string
  ): Promise<void> {
    const timestamp = Date.now();
    // this.db.run("UPDATE tracked_wallets SET timestamp = ? WHERE address = ?", [
    //   timestamp,
    //   address,
    // ]);
    if (wallet_id === 1)
      this.trackedWallets_1.set(address, {
        address: address,
        timestamp,
      });

    if (wallet_id === 2)
      this.trackedWallets_2.set(address, {
        address: address,
        timestamp,
      });
  }

  private async sendTelegramNotification(
    symbol: string,
    mc: string,
    walletAddress: string,
    ca: string,
    signature: string
  ): Promise<void> {
    // const message = `🔗 ${shortenAddressWithLink(
    //   walletAddress
    // )} has interacted with pump.fun. | ${txnLink(
    //   signature
    // )} | ${shortenAddressWithLink(ca)}
    // `;

    const message = `🔗 ${shortenAddressWithLink(
      ca,
      symbol
    )} | <code>MC: $${mc}</code> | ${birdeyeLink(ca)} | ${dextoolLink(
      ca
    )} | ${txnLink(signature)}
      <code>${ca}</code>
      `;
    // console.log(message);

    try {
      await this.bot.sendMessage(TELEGRAM_CHANNEL_ID, message, {
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
    } catch (error) {
      console.error("Error sending Telegram notification:", error);
    }
  }

  public async monitorTransactions(): Promise<void> {
    // Monitor main wallet 1
    try {
      this.connection.onLogs(
        new PublicKey(MAIN_WALLET_ADDRESS_1),
        async ({ logs, err, signature }) => {
          if (err) return;

          const data = await getTransactionDetails(this.connection, signature);
          console.log("1 Data:", data?.signature);
          this.saveLog(`Main wallet txn: ${data?.signature}`);

          if (data?.balanceChange) {
            const balanceValue = parseFloat(
              data.balanceChange.replace(" SOL", "")
            );
            if (Math.abs(balanceValue) < 25) {
              for (const instruction of data?.instructions) {
                const newTrackedWalletAddress = instruction.receiver;
                if (
                  instruction.program === "system" &&
                  instruction.type === "transfer" &&
                  newTrackedWalletAddress
                ) {
                  if (this.trackedWallets_1.has(newTrackedWalletAddress)) {
                    await this.trackUpdateWallet(1, newTrackedWalletAddress);
                    continue;
                  }
                  if (this.trackedWallets_1.size >= TRACKED_WALLETS_SIZE) {
                    console.log(
                      "Main wallet 1 tracked limited wallets. Skipping..."
                    );
                    continue;
                  }
                  await this.trackNewWallet(1, newTrackedWalletAddress);

                  // monitor small wallet from main wallet 1
                  this.connection.onLogs(
                    new PublicKey(newTrackedWalletAddress),
                    async ({ logs, err, signature }) => {
                      if (err) return;
                      console.log(`${newTrackedWalletAddress} Logs:`);
                      this.saveLog(`${newTrackedWalletAddress} Logs: ${logs}`);
                      const CA = await getSignature2CA(
                        this.connection,
                        signature
                      );
                      console.log("CA:", CA);
                      this.saveLog(`CA: ${CA}`);
                      if (CA) {
                        const CA_ADDRESS = CA.toString();
                        if (
                          this.pumpfunTokens.get(CA_ADDRESS) === 2 ||
                          this.pumpfunTokens.get(CA_ADDRESS) === 3
                        ) {
                          const { symbol, mc } = await getTokenInfo(
                            this.connection,
                            CA_ADDRESS
                          );
                          await this.sendTelegramNotification(
                            symbol,
                            mc,
                            newTrackedWalletAddress,
                            CA_ADDRESS,
                            signature
                          );
                          this.pumpfunTokens.set(CA_ADDRESS, 3);
                        } else {
                          this.pumpfunTokens.set(CA_ADDRESS, 1);
                        }
                      }
                    }
                  );
                }
              }
            }
          }
        },
        "confirmed"
      );
    } catch (error) {
      console.log("Error monitoring 1 transactions:", error);
      this.saveLog("Error monitoring 1 transactions");
    }

    // Monitor main wallet 2
    try {
      this.connection.onLogs(
        new PublicKey(MAIN_WALLET_ADDRESS_2),
        async ({ logs, err, signature }) => {
          if (err) return;

          const data = await getTransactionDetails(this.connection, signature);
          console.log("2 Data:", data?.signature);
          this.saveLog(`Main wallet txn: ${data?.signature}`);

          if (data?.balanceChange) {
            const balanceValue = parseFloat(
              data.balanceChange.replace(" SOL", "")
            );
            if (Math.abs(balanceValue) < 25) {
              for (const instruction of data?.instructions) {
                const newTrackedWalletAddress = instruction.receiver;
                if (
                  instruction.program === "system" &&
                  instruction.type === "transfer" &&
                  newTrackedWalletAddress
                ) {
                  if (this.trackedWallets_2.has(newTrackedWalletAddress)) {
                    await this.trackUpdateWallet(2, newTrackedWalletAddress);
                    continue;
                  }
                  if (this.trackedWallets_2.size >= TRACKED_WALLETS_SIZE) {
                    console.log(
                      "Main wallet 2 tracked limited wallets. Skipping..."
                    );
                    continue;
                  }
                  await this.trackNewWallet(2, newTrackedWalletAddress);

                  // monitor small wallet from main wallet 2
                  this.connection.onLogs(
                    new PublicKey(newTrackedWalletAddress),
                    async ({ logs, err, signature }) => {
                      if (err) return;
                      console.log(`${newTrackedWalletAddress} Logs:`);
                      this.saveLog(`${newTrackedWalletAddress} Logs: ${logs}`);
                      const CA = await getSignature2CA(
                        this.connection,
                        signature
                      );

                      if (CA) {
                        const CA_ADDRESS = CA.toString();
                        if (
                          this.pumpfunTokens.get(CA_ADDRESS) === 1 ||
                          this.pumpfunTokens.get(CA_ADDRESS) === 3
                        ) {
                          const { symbol, mc } = await getTokenInfo(
                            this.connection,
                            CA_ADDRESS
                          );
                          await this.sendTelegramNotification(
                            symbol,
                            mc,
                            newTrackedWalletAddress,
                            CA_ADDRESS,
                            signature
                          );
                          this.pumpfunTokens.set(CA_ADDRESS, 3);
                        } else {
                          this.pumpfunTokens.set(CA_ADDRESS, 2);
                        }
                      }
                    }
                  );
                }
              }
            }
          }
        },
        "confirmed"
      );
    } catch (error) {
      console.log("Error monitoring 2 transactions:", error);
      this.saveLog("Error monitoring 2 transactions");
    }
  }

  public async start(): Promise<void> {
    await this.monitorTransactions();
    this.saveLog("Wallet tracker started...");
    console.log("Wallet tracker started...");
  }
}
