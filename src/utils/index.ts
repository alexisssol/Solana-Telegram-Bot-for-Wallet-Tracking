import {
  AccountInfo,
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";
import { Database } from "sqlite3";
import TelegramBot from "node-telegram-bot-api";
import {
  DB_PATH,
  LOG_MAX_SIZE,
  LOGFILE,
  MAIN_WALLET_ADDRESS,
  PUMP_FUN_ADDRESS,
  SOLANA_RPC_URL,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHANNEL_ID,
  TRACKED_WALLETS_SIZE,
} from "../config/config";
import {
  getTransactionDetails,
  shortenAddress,
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
  private trackedWallets: Map<string, WalletTrack>;

  constructor() {
    this.connection = new Connection(SOLANA_RPC_URL);
    this.db = new Database(DB_PATH);
    const BOT_TOKEN = TELEGRAM_BOT_TOKEN || "";
    this.bot = new TelegramBot(BOT_TOKEN, { polling: false });
    this.trackedWallets = new Map();
    this.initDatabase();
    this.loadTrackedWallets();
  }

  private initDatabase(): void {
    this.db.run(`
            CREATE TABLE IF NOT EXISTS tracked_wallets (
                address TEXT PRIMARY KEY,
                timestamp INTEGER
            )
        `);
  }
  private saveLog(message: string): void {
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

  private loadTrackedWallets(): void {
    this.db.all("SELECT * FROM tracked_wallets", (err, rows: WalletTrack[]) => {
      if (err) {
        console.error("Error loading wallets:", err);
        return;
      }
      rows.forEach((row) => {
        this.trackedWallets.set(row.address, row);
      });
    });
  }

  private async trackNewWallet(address: string): Promise<void> {
    const timestamp = Date.now();
    this.db.run(
      "INSERT INTO tracked_wallets (address, timestamp) VALUES (?, ?)",
      [address, timestamp]
    );
    this.trackedWallets.set(address, { address, timestamp });
  }
  private async trackUpdateWallet(address: string): Promise<void> {
    const timestamp = Date.now();
    this.db.run("UPDATE tracked_wallets SET timestamp = ? WHERE address = ?", [
      timestamp,
      address,
    ]);
    this.trackedWallets.set(address, {
      address: address,
      timestamp,
    });
  }

  private async sendTelegramNotification(
    walletAddress: string,
    signature: string
  ): Promise<void> {
    const message = `🚨 ${shortenAddressWithLink(
      walletAddress
    )} has interacted with pump.fun. | ${txnLink(signature)}
    `;
    console.log(message);
    try {
      await this.bot.sendMessage(TELEGRAM_CHANNEL_ID, message, {
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
    } catch (error) {
      console.error("Error sending Telegram notification:", error);
    }
  }

  private shouldTrackWallet(timestamp: number): boolean {
    const twoDaysMs = 2 * 24 * 60 * 60 * 1000;
    return Date.now() - timestamp < twoDaysMs;
  }

  public async monitorTransactions(): Promise<void> {
    // Monitor main wallet
    try {
      this.connection.onLogs(
        new PublicKey(MAIN_WALLET_ADDRESS),
        async ({ logs, err, signature }) => {
          if (err) return;

          const data = await getTransactionDetails(this.connection, signature);
          console.log("Data:", data?.signature);
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
                  if (this.trackedWallets.has(newTrackedWalletAddress)) {
                    await this.trackUpdateWallet(newTrackedWalletAddress);
                    continue;
                  }
                  if (this.trackedWallets.size >= TRACKED_WALLETS_SIZE) {
                    console.log("Max tracked wallets reached. Skipping...");
                    continue;
                  }
                  await this.trackNewWallet(newTrackedWalletAddress);
                  this.connection.onLogs(
                    new PublicKey(newTrackedWalletAddress),
                    async ({ logs, err, signature }) => {
                      if (err) return;
                      console.log(`${newTrackedWalletAddress} Logs:`);
                      this.saveLog(`${newTrackedWalletAddress} Logs: ${logs}`);

                      if (logs.some((log) => log.includes(PUMP_FUN_ADDRESS))) {
                        await this.sendTelegramNotification(
                          newTrackedWalletAddress,
                          signature
                        );
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
      console.log("Error monitoring transactions:", error);
      this.saveLog("Error monitoring transactions");
    }
  }

  public async start(): Promise<void> {
    await this.monitorTransactions();
    this.saveLog("Wallet tracker started...");
    console.log("Wallet tracker started...");
  }
}