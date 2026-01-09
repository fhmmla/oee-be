/**
 * Machine ID Generator
 * 
 * Generates a unique, STABLE machine identifier for license validation.
 * 
 * Priority:
 * 1. /host-machine-id (Docker mount from host)
 * 2. /etc/machine-id (Linux native)
 * 3. Fallback CPU-based (tanpa MAC address untuk stabilitas)
 * 
 * PENTING: File ini harus IDENTIK di frontend dan backend!
 */

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';

/**
 * Generate a unique machine identifier
 * 
 * Uses /etc/machine-id which is:
 * - STABLE: Created once during OS install, never changes
 * - NOT affected by network changes
 * - NOT affected by MAC address changes
 * - Same across all containers on the same host (when mounted)
 * 
 * @returns Unique machine identifier (SHA256 hash, 64 character hex string)
 */
export function getMachineId(): string {
  // Prioritas 1: Baca dari /host-machine-id (Docker mount)
  try {
    const hostId = fs.readFileSync('/host-machine-id', 'utf8').trim();
    if (hostId && hostId.length > 0) {
      return crypto.createHash('sha256').update(hostId).digest('hex');
    }
  } catch {
    // File tidak ada - skip
  }

  // Prioritas 2: Baca dari /etc/machine-id (Linux native)
  try {
    const machineId = fs.readFileSync('/etc/machine-id', 'utf8').trim();
    if (machineId && machineId.length > 0) {
      return crypto.createHash('sha256').update(machineId).digest('hex');
    }
  } catch {
    // File tidak ada (Windows) - skip
  }

  // Prioritas 3: Fallback CPU-based (TANPA MAC untuk stabilitas)
  // Hanya digunakan jika kedua file di atas tidak ada
  try {
    const components = [
      os.hostname(),
      os.platform(),
      os.arch(),
      os.cpus()[0]?.model || 'unknown-cpu',
    ];
    return crypto.createHash('sha256').update(components.join('|')).digest('hex');
  } catch (error) {
    console.error('Failed to generate machine ID:', error);
    // Last resort fallback
    return crypto.createHash('sha256').update(`fallback-${os.hostname()}`).digest('hex');
  }
}

/**
 * Get a shortened version of the machine ID for display purposes
 * @param length - Number of characters to return (default: 16)
 * @returns Shortened machine ID
 */
export function getShortMachineId(length: number = 16): string {
  const fullId = getMachineId();
  return fullId.substring(0, length);
}

/**
 * Machine identification information for display
 */
export interface MachineIdInfo {
  fullId: string;
  shortId: string;
  source: 'docker-host' | 'linux-native' | 'cpu-fallback';
}

/**
 * Get comprehensive machine identification information
 * @returns Machine ID info object with source information
 */
export function getMachineIdInfo(): MachineIdInfo {
  let source: 'docker-host' | 'linux-native' | 'cpu-fallback' = 'cpu-fallback';
  
  // Check source
  try {
    const hostId = fs.readFileSync('/host-machine-id', 'utf8').trim();
    if (hostId) source = 'docker-host';
  } catch {
    try {
      const machineId = fs.readFileSync('/etc/machine-id', 'utf8').trim();
      if (machineId) source = 'linux-native';
    } catch {
      source = 'cpu-fallback';
    }
  }

  const fullId = getMachineId();
  return {
    fullId,
    shortId: fullId.substring(0, 16),
    source,
  };
}

// ============================================
// Self-test: bun run lib/machine-id.ts
// ============================================
if (require.main === module || process.argv[1]?.includes('machine-id')) {
  console.log('='.repeat(60));
  console.log('MACHINE ID GENERATOR');
  console.log('='.repeat(60));
  
  const info = getMachineIdInfo();
  
  console.log('Source:', info.source);
  console.log('');
  console.log('Machine ID (Full):');
  console.log(info.fullId);
  console.log('');
  console.log('Machine ID (Short):');
  console.log(info.shortId);
  console.log('='.repeat(60));
  console.log('');
  console.log('Docker Setup (docker-compose.yml):');
  console.log('  volumes:');
  console.log('    - /etc/machine-id:/host-machine-id:ro');
  console.log('='.repeat(60));
}
