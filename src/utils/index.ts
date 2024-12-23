import { Connection, PublicKey } from "@solana/web3.js";
import { Database } from "sqlite3";
import TelegramBot from "node-telegram-bot-api";
import {
  DB_PATH,
  LOG_MAX_SIZE,
  LOGFILE,
  MAIN_WALLET_ADDRESS_1,
  MAIN_WALLET_ADDRESS_2,
  MAX_BALANCE_CHANGE,
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
  }

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

    // const timestamp = new Date().toISOString();
    // const logMessage = `[${timestamp}] ${message}\n`;
    const logMessage = `${message}\n`;
    fs.appendFileSync(logFile, logMessage);
  }

  private async trackNewWallet(
    wallet_id: number,
    address: string
  ): Promise<void> {
    const timestamp = Date.now();
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

  private async MonitorSmallWallets(
    id: number,
    newTrackedWalletAddress: string
  ) {
    // monitor small wallet from main wallet 1
    this.connection.onLogs(
      new PublicKey(newTrackedWalletAddress),
      async ({ logs, err, signature }) => {
        try {
          if (err) return;
          // console.log(`${newTrackedWalletAddress} Logs:`);
          // this.saveLog(`${newTrackedWalletAddress} Logs: ${logs}`);
          const CA = await getSignature2CA(this.connection, signature);
          // console.log("CA:", CA);

          if (CA) {
            this.saveLog(
              `small wallet tx: sm: ${newTrackedWalletAddress}, token: ${CA}, siggnature: ${signature}`
            );
            const CA_ADDRESS = CA.toString();
            const tmpAnother = 3 - id;
            if (
              CA_ADDRESS === MAIN_WALLET_ADDRESS_1 ||
              CA_ADDRESS === MAIN_WALLET_ADDRESS_2
            ) {
              this.pumpfunTokens.set(CA_ADDRESS, -1);
            } else if (
              this.pumpfunTokens.get(CA_ADDRESS) === tmpAnother ||
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
              this.saveLog(
                `TG alert: 📝 ${id} Main wall: sm:${newTrackedWalletAddress} => ca:${CA_ADDRESS}, tx: ${signature}`
              );
              this.pumpfunTokens.set(CA_ADDRESS, 3);
            } else if (this.pumpfunTokens.get(CA_ADDRESS) !== -1) {
              this.pumpfunTokens.set(CA_ADDRESS, id);
            }
          }
        } catch (error) {
          this.saveLog(`Error: ${error}`);
        }
      }
    );
  }

  private async sendTelegramNotification(
    symbol: string,
    mc: string,
    walletAddress: string,
    ca: string,
    signature: string
  ): Promise<void> {
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

  public async monitorTransactions(id: number): Promise<void> {
    // Monitor main wallet 1
    const MAIN_WALLET_ADDRESS =
      id === 1 ? MAIN_WALLET_ADDRESS_1 : MAIN_WALLET_ADDRESS_2;
    try {
      this.connection.onLogs(
        new PublicKey(MAIN_WALLET_ADDRESS),
        async ({ logs, err, signature }) => {
          try {
            if (err) return;

            const data = await getTransactionDetails(
              this.connection,
              signature
            );
            console.log(`${id} Data:`, data?.signature);
            let smWallets = [];

            if (data?.balanceChange && data.sender === MAIN_WALLET_ADDRESS) {
              const balanceValue = parseFloat(
                data.balanceChange.replace(" SOL", "")
              );
              if (Math.abs(balanceValue) < MAX_BALANCE_CHANGE) {
                for (const instruction of data?.instructions) {
                  const newTrackedWalletAddress = instruction.receiver;

                  if (
                    instruction.program === "system" &&
                    instruction.type === "transfer" &&
                    newTrackedWalletAddress
                  ) {
                    smWallets.push(newTrackedWalletAddress);
                    const tmpTrackedWallets =
                      id === 1 ? this.trackedWallets_1 : this.trackedWallets_2;
                    if (tmpTrackedWallets.has(newTrackedWalletAddress)) {
                      await this.trackUpdateWallet(id, newTrackedWalletAddress);
                      continue;
                    }
                    if (tmpTrackedWallets.size >= TRACKED_WALLETS_SIZE) {
                      this.saveLog(
                        `Main wallet ${id} tracked limited wallets. Skipping...`
                      );
                      continue;
                    }
                    await this.trackNewWallet(id, newTrackedWalletAddress);
                    try {
                      await this.MonitorSmallWallets(
                        id,
                        newTrackedWalletAddress
                      );
                    } catch (error) {
                      this.saveLog(
                        `Error monitoring ${id} transactions: ${error}`
                      );
                    }
                  }
                }
              }
            }
            if (smWallets.length > 0) {
              this.saveLog(
                `${id} Main wallet txn: ${
                  data?.signature
                } smWallets: ${smWallets.join(", ")}`
              );
            }
          } catch (error) {
            console.log(`Error processing ${id} transactions:`, error);
          }
        },
        "confirmed"
      );
    } catch (error) {
      console.log(`Error monitoring ${id} transactions:`, error);
      this.saveLog(`Error monitoring ${id} transactions`);
    }
  }

  public async start(): Promise<void> {
    await this.monitorTransactions(1);
    await this.monitorTransactions(2);
    this.saveLog("Wallet tracker started...");
    console.log("Wallet tracker started...");
  }
}
