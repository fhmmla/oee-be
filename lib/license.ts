// lib/license.ts
// License key decryption and validation utilities

import { createDecipheriv } from 'crypto';
import { prisma } from './prisma';
import { getMachineId } from './machine-id';

// ============ Types ============

export interface LicenseInfo {
  companyName: string;
  location: string;
  serverId: string;
  totalLicense: number;
  raw: string;
}

export interface LicenseValidationResult {
  isValid: boolean;
  message: string;
  licenseInfo?: LicenseInfo;
  actualMachineId?: string;
  enabledMachineCount?: number;
}

// ============ Constants ============

const ALGORITHM = 'aes-128-cbc';
const KEY_LENGTH = 16; // 128 bits
const IV_LENGTH = 16;  // 128 bits

// ============ Helper Functions ============

/**
 * Pad a string to specified length with zero bytes
 */
function zeroPad(str: string, length: number): Buffer {
  const buffer = Buffer.alloc(length, 0);
  const strBuffer = Buffer.from(str, 'utf8');
  strBuffer.copy(buffer, 0, 0, Math.min(strBuffer.length, length));
  return buffer;
}

/**
 * Get encryption key from environment variable
 * Max 16 characters, padded with zeros if shorter
 */
function getSecretKey(): Buffer {
  const key = process.env.LICENSE_SECRET_KEY || '';
  return zeroPad(key, KEY_LENGTH);
}

/**
 * Get IV from environment variable
 * Optional, max 16 characters, uses zero IV if not provided
 */
function getIV(): Buffer {
  const iv = process.env.LICENSE_IV || '';
  return zeroPad(iv, IV_LENGTH);
}

// ============ Main Functions ============

/**
 * Decrypt an encrypted license key
 * 
 * @param encryptedKey - Base64 encoded encrypted license key
 * @returns LicenseInfo object or null if decryption fails
 * 
 * License format after decryption: "CompanyName/Location/ServerUniqID/TotalLicense"
 */
export function decryptLicenseKey(encryptedKey: string): LicenseInfo | null {
  try {
    if (!encryptedKey || encryptedKey.trim() === '') {
      return null;
    }

    const key = getSecretKey();
    const iv = getIV();

    // Decode base64 encrypted data
    const encryptedBuffer = Buffer.from(encryptedKey, 'base64');

    // Create decipher
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    
    // Decrypt
    let decrypted = decipher.update(encryptedBuffer);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    const decryptedText = decrypted.toString('utf8');

    // Parse license format: CompanyName/Location/ServerUniqID/TotalLicense
    const parts = decryptedText.split('/');
    if (parts.length < 4) {
      console.error('Invalid license format: expected 4 parts separated by /');
      return null;
    }

    const companyName = parts[0] ?? '';
    const location = parts[1] ?? '';
    const serverId = parts[2] ?? '';
    const totalLicenseStr = parts[3] ?? '0';
    
    const totalLicense = parseInt(totalLicenseStr, 10);
    if (isNaN(totalLicense)) {
      console.error('Invalid totalLicense value in license key');
      return null;
    }

    return {
      companyName,
      location,
      serverId,
      totalLicense,
      raw: decryptedText,
    };
  } catch (error) {
    console.error('Failed to decrypt license key:', error);
    return null;
  }
}

/**
 * Get license info from database
 * Fetches the license_key from tbl_general and decrypts it
 * 
 * @returns LicenseInfo object or null if not found or decryption fails
 */
export async function getLicenseInfo(): Promise<LicenseInfo | null> {
  try {
    const config = await prisma.general.findFirst();
    
    if (!config || !config.license_key) {
      console.error('No license key found in database');
      return null;
    }

    return decryptLicenseKey(config.license_key);
  } catch (error) {
    console.error('Failed to get license info from database:', error);
    return null;
  }
}

/**
 * Get count of enabled machines in database
 * 
 * @returns Number of machines with enabled=true
 */
export async function getEnabledMachineCount(): Promise<number> {
  try {
    const count = await prisma.machine.count({
      where: { enabled: true },
    });
    return count;
  } catch (error) {
    console.error('Failed to count enabled machines:', error);
    return 0;
  }
}

/**
 * Validate the license key
 * 
 * Performs the following validations:
 * 1. License key can be decrypted (valid format)
 * 2. serverId in license matches actual machine ID
 * 3. Number of enabled machines does not exceed totalLicense
 * 
 * @returns LicenseValidationResult with validation status and details
 */
export async function validateLicense(): Promise<LicenseValidationResult> {
  try {
    // 1. Get and decrypt license info
    const licenseInfo = await getLicenseInfo();
    
    if (!licenseInfo) {
      return {
        isValid: false,
        message: 'License key tidak ditemukan atau tidak valid',
      };
    }

    // 2. Get actual machine ID
    const actualMachineId = getMachineId();

    // 3. Compare serverId with actual machine ID
    if (licenseInfo.serverId !== actualMachineId) {
      return {
        isValid: false,
        message: 'License not valid for this server (Machine ID not match)',
        licenseInfo,
        actualMachineId,
      };
    }

    // 4. Check enabled machine count against totalLicense
    const enabledCount = await getEnabledMachineCount();
    
    if (enabledCount > licenseInfo.totalLicense) {
      return {
        isValid: false,
        message: `Jumlah machine aktif (${enabledCount}) melebihi limit license (${licenseInfo.totalLicense})`,
        licenseInfo,
        actualMachineId,
        enabledMachineCount: enabledCount,
      };
    }

    // All validations passed
    return {
      isValid: true,
      message: `License valid untuk ${licenseInfo.companyName} - ${licenseInfo.location}`,
      licenseInfo,
      actualMachineId,
      enabledMachineCount: enabledCount,
    };
  } catch (error) {
    console.error('License validation error:', error);
    return {
      isValid: false,
      message: `Error validasi license: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Quick check if license is valid (without detailed info)
 * Useful for performance-sensitive operations
 * 
 * @returns true if license is valid, false otherwise
 */
export async function isLicenseValid(): Promise<boolean> {
  const result = await validateLicense();
  return result.isValid;
}
