// lib/modbus/connection-pool.ts
// Gateway connection pool manager - 1 koneksi per gateway

import ModbusRTU from 'modbus-serial';
import type { ModbusConfig, GatewayConnection } from '../../type';
import { logger } from '../logger';

class ConnectionPool {
  private connections: Map<string, GatewayConnection> = new Map();
  private readonly MAX_RETRY = 5;
  private readonly RETRY_DELAY = 2000; // 2 seconds

  private getKey(config: ModbusConfig): string {
    return `${config.ip}:${config.port}`;
  }

  async getConnection(config: ModbusConfig): Promise<ModbusRTU> {
    const key = this.getKey(config);
    
    // Check if connection exists and is still connected
    let conn = this.connections.get(key);
    
    if (conn && conn.connected) {
      conn.lastUsed = new Date();
      return conn.client;
    }

    // Create new connection or reconnect
    return await this.createConnection(config, key);
  }

  private async createConnection(config: ModbusConfig, key: string): Promise<ModbusRTU> {
    logger.info(`Creating connection to gateway: ${key}`);
    
    const client = new ModbusRTU();
    let retryCount = 0;

    while (retryCount < this.MAX_RETRY) {
      try {
        await client.connectTCP(config.ip, { port: config.port });
        client.setTimeout(5000); // 5 second timeout
        
        const conn: GatewayConnection = {
          key,
          config,
          client,
          connected: true,
          lastUsed: new Date(),
          retryCount: 0,
        };

        this.connections.set(key, conn);
        logger.info(`✓ Connected to gateway: ${key}`);
        
        return client;
      } catch (error) {
        retryCount++;
        logger.warn(`Connection failed to ${key}, retry ${retryCount}/${this.MAX_RETRY}`, error);
        
        if (retryCount < this.MAX_RETRY) {
          await this.sleep(this.RETRY_DELAY);
        }
      }
    }

    throw new Error(`Failed to connect to gateway ${key} after ${this.MAX_RETRY} retries`);
  }

  async reconnect(key: string): Promise<void> {
    const conn = this.connections.get(key);
    if (!conn) {
      throw new Error(`Connection ${key} not found in pool`);
    }

    logger.info(`Reconnecting to gateway: ${key}`);
    
    try {
      await conn.client.close();
    } catch (error) {
      // Ignore close errors
    }

    conn.connected = false;
    await this.createConnection(conn.config, key);
  }

  markDisconnected(key: string) {
    const conn = this.connections.get(key);
    if (conn) {
      conn.connected = false;
      logger.warn(`Gateway ${key} marked as disconnected`);
    }
  }

  async closeAll(): Promise<void> {
    logger.info('Closing all gateway connections...');
    
    for (const [key, conn] of this.connections) {
      try {
        if (conn.connected) {
          await conn.client.close();
        }
        logger.info(`✓ Closed connection: ${key}`);
      } catch (error) {
        logger.error(`Error closing connection ${key}:`, error);
      }
    }
    
    this.connections.clear();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getStatus(): { key: string; connected: boolean; lastUsed: Date }[] {
    return Array.from(this.connections.values()).map(conn => ({
      key: conn.key,
      connected: conn.connected,
      lastUsed: conn.lastUsed,
    }));
  }
}

export const connectionPool = new ConnectionPool();
