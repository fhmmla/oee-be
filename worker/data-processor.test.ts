// worker/data-processor.test.ts
// Tests for the updated checkConditions logic with new conditions:
// 1. MachineOFF      - on_contact=0, capstan=0, all 4 temps=0
// 2. HeatingUp        - NOT (all 4 temps >= target for 1 hour)
// 3. Iddle[SU]        - on_contact=0, capstan < speed_to_production, all 4 temps >= target
// 4. Iddle[Make Sample] - on_contact=0, capstan > speed_to_production, all 4 temps >= target for time_to_make_sample min
// 5. MachineProduction  - on_contact=1, capstan > speed_to_production, all 4 temps >= target
//
// Priority order: MachineOFF > HeatingUp > Iddle[SU] > Iddle[Make Sample] > MachineProduction
// If no condition matched → return null (skip, don't log)
//
// PENTING: Sebelum menjalankan test ini, pastikan:
// 1. `MachineReading` di type.ts sudah ditambahkan field:
//    - time_to_make_sample_inlet_heater?: number;
//    - time_to_make_sample_lower_heater?: number;
//    - time_to_make_sample_after_catalyst?: number;
//    - time_to_make_sample_upper_heater?: number;
// 2. `hasAllRequiredValues` sudah include capstan_speed != null
// 3. `checkConditions` sudah diupdate sesuai logic baru
// 4. tempTracker sudah punya method `checkAllWithDuration` untuk time_to_make_sample check
//    atau `checkAll` menerima parameter duration opsional

import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { MachineReading } from '../type';

// ============================================================
// Mock Setup - tempTracker
// ============================================================

// Controllable results per test
let ovenReadyResult = false;   // checkAll → ovenReady (1 hour)
let sampleReadyResult = false; // checkAllWithDuration → sampleReady (time_to_make_sample)

mock.module('./temperature-tracker', () => ({
  tempTracker: {
    // checkAll: cek all 4 temps >= target selama 1 jam (untuk HeatingUp)
    checkAll: async () => ovenReadyResult,
    // checkAllWithDuration: cek all 4 temps >= target selama N menit (untuk Iddle[Make Sample])
    // Jika implementasi menggunakan checkAll dengan parameter duration tambahan,
    // sesuaikan mock ini
    checkAllWithDuration: async () => sampleReadyResult,
  },
}));

// Import AFTER mock setup
import { checkConditions, hasAllRequiredValues } from './data-processor';

// ============================================================
// Helper: create MachineReading with defaults
// ============================================================

function createReading(overrides: Partial<MachineReading & {
  time_to_make_sample_inlet_heater?: number;
  time_to_make_sample_lower_heater?: number;
  time_to_make_sample_after_catalyst?: number;
  time_to_make_sample_upper_heater?: number;
}> = {}): MachineReading {
  return {
    machineId: 1,
    machineName: 'TestMachine',
    timestamp: new Date('2026-03-03T10:00:00Z'),
    kwh: 100,
    on_contact: 0,
    capstan_speed: 0,
    temperature_inlet_heater: 0,
    temperature_lower_heater: 0,
    temperature_after_catalyst: 0,
    temperature_upper_heater: 0,
    target_temp_inlet_heater: 300,
    target_temp_lower_heater: 300,
    target_temp_after_catalyst: 300,
    target_temp_upper_heater: 300,
    speed_to_production: 60,
    ...overrides,
  } as MachineReading;
}

// ============================================================
// Reset mock state before each test
// ============================================================

beforeEach(() => {
  ovenReadyResult = false;
  sampleReadyResult = false;
});

// ============================================================
// Test: hasAllRequiredValues
// ============================================================

describe('hasAllRequiredValues', () => {
  test('returns true when all required values present (including capstan_speed)', () => {
    const reading = createReading({
      on_contact: 0,
      capstan_speed: 0,
      temperature_inlet_heater: 100,
      temperature_lower_heater: 100,
      temperature_after_catalyst: 100,
      temperature_upper_heater: 100,
      kwh: 50,
    });
    expect(hasAllRequiredValues(reading)).toBe(true);
  });

  test('returns false when on_contact is null', () => {
    const reading = createReading({ on_contact: undefined });
    expect(hasAllRequiredValues(reading)).toBe(false);
  });

  test('returns false when capstan_speed is null', () => {
    const reading = createReading({ capstan_speed: undefined });
    expect(hasAllRequiredValues(reading)).toBe(false);
  });

  test('returns false when temperature_inlet_heater is null', () => {
    const reading = createReading({ temperature_inlet_heater: undefined });
    expect(hasAllRequiredValues(reading)).toBe(false);
  });

  test('returns false when temperature_lower_heater is null', () => {
    const reading = createReading({ temperature_lower_heater: undefined });
    expect(hasAllRequiredValues(reading)).toBe(false);
  });

  test('returns false when temperature_after_catalyst is null', () => {
    const reading = createReading({ temperature_after_catalyst: undefined });
    expect(hasAllRequiredValues(reading)).toBe(false);
  });

  test('returns false when temperature_upper_heater is null', () => {
    const reading = createReading({ temperature_upper_heater: undefined });
    expect(hasAllRequiredValues(reading)).toBe(false);
  });

  test('returns false when kwh is null', () => {
    const reading = createReading({ kwh: undefined });
    expect(hasAllRequiredValues(reading)).toBe(false);
  });

  test('returns true when capstan_speed = 0 (zero is valid, not null)', () => {
    const reading = createReading({ capstan_speed: 0 });
    expect(hasAllRequiredValues(reading)).toBe(true);
  });

  test('returns true when on_contact = 0 (zero is valid, not null)', () => {
    const reading = createReading({ on_contact: 0 });
    expect(hasAllRequiredValues(reading)).toBe(true);
  });
});

// ============================================================
// Test: checkConditions
// ============================================================

describe('checkConditions', () => {

  // ----------------------------------------------------------
  // Guard: return null if any required value is null/undefined
  // ----------------------------------------------------------
  describe('Guard: skip if missing required values', () => {
    test('returns null when on_contact is null', async () => {
      const reading = createReading({ on_contact: undefined });
      expect(await checkConditions(reading)).toBeNull();
    });

    test('returns null when capstan_speed is null', async () => {
      const reading = createReading({ capstan_speed: undefined });
      expect(await checkConditions(reading)).toBeNull();
    });

    test('returns null when any temperature is null', async () => {
      const reading = createReading({ temperature_inlet_heater: undefined });
      expect(await checkConditions(reading)).toBeNull();
    });

    test('returns null when kwh is null', async () => {
      const reading = createReading({ kwh: undefined });
      expect(await checkConditions(reading)).toBeNull();
    });
  });

  // ----------------------------------------------------------
  // Condition 1: MachineOFF
  // on_contact = 0, capstan = 0, all 4 temps = 0
  // ----------------------------------------------------------
  describe('Condition 1: MachineOFF', () => {
    test('returns MachineOFF when on_contact=0, capstan=0, all temps=0', async () => {
      const reading = createReading({
        on_contact: 0,
        capstan_speed: 0,
        temperature_inlet_heater: 0,
        temperature_lower_heater: 0,
        temperature_after_catalyst: 0,
        temperature_upper_heater: 0,
      });
      expect(await checkConditions(reading)).toBe('MachineOFF');
    });

    test('NOT MachineOFF when one temp > 0 (even if on_contact=0, capstan=0)', async () => {
      const reading = createReading({
        on_contact: 0,
        capstan_speed: 0,
        temperature_inlet_heater: 50, // <-- not zero
        temperature_lower_heater: 0,
        temperature_after_catalyst: 0,
        temperature_upper_heater: 0,
      });
      // ovenReady = false → HeatingUp
      ovenReadyResult = false;
      expect(await checkConditions(reading)).toBe('HeatingUp');
    });

    test('NOT MachineOFF when capstan > 0 (even if on_contact=0, all temps=0)', async () => {
      const reading = createReading({
        on_contact: 0,
        capstan_speed: 10, // <-- not zero
        temperature_inlet_heater: 0,
        temperature_lower_heater: 0,
        temperature_after_catalyst: 0,
        temperature_upper_heater: 0,
      });
      ovenReadyResult = false;
      expect(await checkConditions(reading)).toBe('HeatingUp');
    });

    test('NOT MachineOFF when on_contact=1 (even if capstan=0, all temps=0)', async () => {
      const reading = createReading({
        on_contact: 1, // <-- ON
        capstan_speed: 0,
        temperature_inlet_heater: 0,
        temperature_lower_heater: 0,
        temperature_after_catalyst: 0,
        temperature_upper_heater: 0,
      });
      ovenReadyResult = false;
      expect(await checkConditions(reading)).toBe('HeatingUp');
    });
  });

  // ----------------------------------------------------------
  // Condition 2: HeatingUp
  // NOT (all 4 temps >= target for 1 hour)
  // Artinya: temps < target ATAU temps >= target tapi belum 1 jam
  // ----------------------------------------------------------
  describe('Condition 2: HeatingUp', () => {
    test('returns HeatingUp when all temps below target', async () => {
      ovenReadyResult = false;
      const reading = createReading({
        on_contact: 0,
        capstan_speed: 0,
        temperature_inlet_heater: 200,
        temperature_lower_heater: 250,
        temperature_after_catalyst: 280,
        temperature_upper_heater: 290,
      });
      expect(await checkConditions(reading)).toBe('HeatingUp');
    });

    test('returns HeatingUp when temps at target but not yet 1 hour', async () => {
      ovenReadyResult = false; // belum 1 jam
      const reading = createReading({
        on_contact: 0,
        capstan_speed: 0,
        temperature_inlet_heater: 300,
        temperature_lower_heater: 300,
        temperature_after_catalyst: 300,
        temperature_upper_heater: 300,
      });
      expect(await checkConditions(reading)).toBe('HeatingUp');
    });

    test('returns HeatingUp when 3 of 4 temps >= target for 1 hr but 1 is not', async () => {
      ovenReadyResult = false; // not ALL sensors ready
      const reading = createReading({
        on_contact: 0,
        capstan_speed: 0,
        temperature_inlet_heater: 350,
        temperature_lower_heater: 350,
        temperature_after_catalyst: 350,
        temperature_upper_heater: 250, // <--- below target
      });
      expect(await checkConditions(reading)).toBe('HeatingUp');
    });

    test('returns HeatingUp regardless of on_contact value when temps not ready', async () => {
      ovenReadyResult = false;
      const reading = createReading({
        on_contact: 1,  // ON, but temps not ready
        capstan_speed: 80,
        temperature_inlet_heater: 200,
        temperature_lower_heater: 200,
        temperature_after_catalyst: 200,
        temperature_upper_heater: 200,
      });
      expect(await checkConditions(reading)).toBe('HeatingUp');
    });

    test('returns HeatingUp regardless of capstan value when temps not ready', async () => {
      ovenReadyResult = false;
      const reading = createReading({
        on_contact: 0,
        capstan_speed: 100, // > speed_to_production
        temperature_inlet_heater: 290,
        temperature_lower_heater: 290,
        temperature_after_catalyst: 290,
        temperature_upper_heater: 290,
      });
      expect(await checkConditions(reading)).toBe('HeatingUp');
    });
  });

  // ----------------------------------------------------------
  // Condition 3: Iddle[SU]
  // on_contact = 0, capstan < speed_to_production, all 4 temps >= target
  // (tidak perlu durasi, cukup >= target saja, karena HeatingUp sudah filter durasi 1 jam)
  // ----------------------------------------------------------
  describe('Condition 3: Iddle[SU]', () => {
    test('returns Iddle[SU] when on_contact=0, capstan < speed_to_production, oven ready', async () => {
      ovenReadyResult = true; // temps >= target for >= 1 hour
      const reading = createReading({
        on_contact: 0,
        capstan_speed: 30,  // < 60 (speed_to_production)
        temperature_inlet_heater: 350,
        temperature_lower_heater: 350,
        temperature_after_catalyst: 350,
        temperature_upper_heater: 350,
        speed_to_production: 60,
      });
      expect(await checkConditions(reading)).toBe('Iddle[SU]');
    });

    test('returns Iddle[SU] when capstan = 0 and oven ready', async () => {
      ovenReadyResult = true;
      const reading = createReading({
        on_contact: 0,
        capstan_speed: 0,  // 0 < 60 → Iddle[SU], NOT MachineOFF (because temps > 0)
        temperature_inlet_heater: 350,
        temperature_lower_heater: 350,
        temperature_after_catalyst: 350,
        temperature_upper_heater: 350,
        speed_to_production: 60,
      });
      expect(await checkConditions(reading)).toBe('Iddle[SU]');
    });

    test('returns Iddle[SU] when capstan = 59 (just below speed_to_production=60)', async () => {
      ovenReadyResult = true;
      const reading = createReading({
        on_contact: 0,
        capstan_speed: 59,
        temperature_inlet_heater: 300,
        temperature_lower_heater: 300,
        temperature_after_catalyst: 300,
        temperature_upper_heater: 300,
        speed_to_production: 60,
      });
      expect(await checkConditions(reading)).toBe('Iddle[SU]');
    });

    test('NOT Iddle[SU] when on_contact=1 (would be Production)', async () => {
      ovenReadyResult = true;
      const reading = createReading({
        on_contact: 1,   // ON
        capstan_speed: 30,
        temperature_inlet_heater: 350,
        temperature_lower_heater: 350,
        temperature_after_catalyst: 350,
        temperature_upper_heater: 350,
        speed_to_production: 60,
      });
      // on_contact=1, capstan < speed_to_production → invalid scenario, return null
      expect(await checkConditions(reading)).toBeNull();
    });
  });

  // ----------------------------------------------------------
  // Condition 4: Iddle[Make Sample]
  // on_contact = 0, capstan >= speed_to_production,
  // all 4 temps >= target for time_to_make_sample minutes
  // ----------------------------------------------------------
  describe('Condition 4: Iddle[Make Sample]', () => {
    test('returns Iddle[Make Sample] when on_contact=0, capstan >= speed_to_production, sample ready', async () => {
      ovenReadyResult = true;
      sampleReadyResult = true; // temps >= target for time_to_make_sample min
      const reading = createReading({
        on_contact: 0,
        capstan_speed: 80,  // > 60 (speed_to_production)
        temperature_inlet_heater: 350,
        temperature_lower_heater: 350,
        temperature_after_catalyst: 350,
        temperature_upper_heater: 350,
        speed_to_production: 60,
      });
      expect(await checkConditions(reading)).toBe('Iddle[Make Sample]');
    });

    test('returns Iddle[Make Sample] when capstan = 60 (exactly speed_to_production=60)', async () => {
      ovenReadyResult = true;
      sampleReadyResult = true;
      const reading = createReading({
        on_contact: 0,
        capstan_speed: 60,  // == speed_to_production → >= applies
        temperature_inlet_heater: 300,
        temperature_lower_heater: 300,
        temperature_after_catalyst: 300,
        temperature_upper_heater: 300,
        speed_to_production: 60,
      });
      expect(await checkConditions(reading)).toBe('Iddle[Make Sample]');
    });

    test('NOT Iddle[Make Sample] when sample not ready (temps belum cukup lama)', async () => {
      ovenReadyResult = true;
      sampleReadyResult = false; // belum cukup lama untuk time_to_make_sample
      const reading = createReading({
        on_contact: 0,
        capstan_speed: 80,
        temperature_inlet_heater: 350,
        temperature_lower_heater: 350,
        temperature_after_catalyst: 350,
        temperature_upper_heater: 350,
        speed_to_production: 60,
      });
      // Oven ready tapi sample belum ready → bukan Iddle[Make Sample]
      // Jatuh ke condition berikutnya atau null
      const result = await checkConditions(reading);
      expect(result).not.toBe('Iddle[Make Sample]');
    });

    test('NOT Iddle[Make Sample] when on_contact=1 (should be Production)', async () => {
      ovenReadyResult = true;
      sampleReadyResult = true;
      const reading = createReading({
        on_contact: 1,
        capstan_speed: 80,
        temperature_inlet_heater: 350,
        temperature_lower_heater: 350,
        temperature_after_catalyst: 350,
        temperature_upper_heater: 350,
        speed_to_production: 60,
      });
      expect(await checkConditions(reading)).toBe('MachineProduction');
    });
  });

  // ----------------------------------------------------------
  // Condition 5: MachineProduction
  // on_contact = 1, capstan > speed_to_production, all 4 temps >= target
  // (tidak perlu durasi, cukup >= target saja)
  // ----------------------------------------------------------
  describe('Condition 5: MachineProduction', () => {
    test('returns MachineProduction when on_contact=1, capstan > speed_to_production, oven ready', async () => {
      ovenReadyResult = true;
      const reading = createReading({
        on_contact: 1,
        capstan_speed: 80,
        temperature_inlet_heater: 350,
        temperature_lower_heater: 350,
        temperature_after_catalyst: 350,
        temperature_upper_heater: 350,
        speed_to_production: 60,
      });
      expect(await checkConditions(reading)).toBe('MachineProduction');
    });

    test('returns MachineProduction when on_contact=2 (>=1 means ON)', async () => {
      ovenReadyResult = true;
      const reading = createReading({
        on_contact: 2,
        capstan_speed: 100,
        temperature_inlet_heater: 400,
        temperature_lower_heater: 400,
        temperature_after_catalyst: 400,
        temperature_upper_heater: 400,
        speed_to_production: 60,
      });
      expect(await checkConditions(reading)).toBe('MachineProduction');
    });

    test('NOT MachineProduction when on_contact=0 (should be Iddle variant)', async () => {
      ovenReadyResult = true;
      sampleReadyResult = true;
      const reading = createReading({
        on_contact: 0,
        capstan_speed: 80,
        temperature_inlet_heater: 350,
        temperature_lower_heater: 350,
        temperature_after_catalyst: 350,
        temperature_upper_heater: 350,
        speed_to_production: 60,
      });
      expect(await checkConditions(reading)).not.toBe('MachineProduction');
    });
  });

  // ----------------------------------------------------------
  // Priority Order Tests
  // Pastikan urutan pengecekan benar
  // ----------------------------------------------------------
  describe('Priority Order', () => {
    test('MachineOFF takes priority over HeatingUp (all zero)', async () => {
      ovenReadyResult = false;
      const reading = createReading({
        on_contact: 0,
        capstan_speed: 0,
        temperature_inlet_heater: 0,
        temperature_lower_heater: 0,
        temperature_after_catalyst: 0,
        temperature_upper_heater: 0,
      });
      // Could be HeatingUp (ovenReady=false), but MachineOFF has higher priority
      expect(await checkConditions(reading)).toBe('MachineOFF');
    });

    test('HeatingUp takes priority over Iddle when oven not ready', async () => {
      ovenReadyResult = false;
      const reading = createReading({
        on_contact: 0,
        capstan_speed: 30,
        temperature_inlet_heater: 200,
        temperature_lower_heater: 200,
        temperature_after_catalyst: 200,
        temperature_upper_heater: 200,
      });
      expect(await checkConditions(reading)).toBe('HeatingUp');
    });

    test('Iddle[SU] takes priority over Iddle[Make Sample] when capstan < speed_to_production', async () => {
      ovenReadyResult = true;
      sampleReadyResult = true;
      const reading = createReading({
        on_contact: 0,
        capstan_speed: 30,  // < speed_to_production → Iddle[SU]
        temperature_inlet_heater: 350,
        temperature_lower_heater: 350,
        temperature_after_catalyst: 350,
        temperature_upper_heater: 350,
        speed_to_production: 60,
      });
      expect(await checkConditions(reading)).toBe('Iddle[SU]');
    });
  });

  // ----------------------------------------------------------
  // Edge Cases
  // ----------------------------------------------------------
  describe('Edge Cases', () => {
    test('returns null when on_contact=1, capstan < speed_to_production (impossible scenario)', async () => {
      ovenReadyResult = true;
      const reading = createReading({
        on_contact: 1,
        capstan_speed: 30,  // < speed_to_production
        temperature_inlet_heater: 350,
        temperature_lower_heater: 350,
        temperature_after_catalyst: 350,
        temperature_upper_heater: 350,
        speed_to_production: 60,
      });
      // Impossible by machine operation → return null, don't log
      expect(await checkConditions(reading)).toBeNull();
    });

    test('capstan exactly equals speed_to_production → Iddle[Make Sample]', async () => {
      ovenReadyResult = true;
      sampleReadyResult = true;
      const reading = createReading({
        on_contact: 0,
        capstan_speed: 60,  // === speed_to_production → >= so Iddle[Make Sample]
        temperature_inlet_heater: 350,
        temperature_lower_heater: 350,
        temperature_after_catalyst: 350,
        temperature_upper_heater: 350,
        speed_to_production: 60,
      });
      expect(await checkConditions(reading)).toBe('Iddle[Make Sample]');
    });

    test('uses custom speed_to_production value from reading', async () => {
      ovenReadyResult = true;
      const reading = createReading({
        on_contact: 0,
        capstan_speed: 50,
        temperature_inlet_heater: 350,
        temperature_lower_heater: 350,
        temperature_after_catalyst: 350,
        temperature_upper_heater: 350,
        speed_to_production: 100, // custom value, 50 < 100
      });
      expect(await checkConditions(reading)).toBe('Iddle[SU]');
    });

    test('uses custom target temperatures from reading', async () => {
      ovenReadyResult = false; // Not reached target for 1 hour
      const reading = createReading({
        on_contact: 0,
        capstan_speed: 0,
        temperature_inlet_heater: 350,
        temperature_lower_heater: 350,
        temperature_after_catalyst: 350,
        temperature_upper_heater: 350,
        target_temp_inlet_heater: 400,  // target is 400, current 350 < 400
        target_temp_lower_heater: 400,
        target_temp_after_catalyst: 400,
        target_temp_upper_heater: 400,
      });
      expect(await checkConditions(reading)).toBe('HeatingUp');
    });
  });

  // ----------------------------------------------------------
  // Full Scenario Flow Tests
  // Simulasi perubahan kondisi mesin dari OFF → Production
  // ----------------------------------------------------------
  describe('Full Scenario: Machine startup flow', () => {
    test('Step 1: Machine is OFF', async () => {
      const reading = createReading({
        on_contact: 0,
        capstan_speed: 0,
        temperature_inlet_heater: 0,
        temperature_lower_heater: 0,
        temperature_after_catalyst: 0,
        temperature_upper_heater: 0,
      });
      expect(await checkConditions(reading)).toBe('MachineOFF');
    });

    test('Step 2: Machine is heating up (temps rising)', async () => {
      ovenReadyResult = false;
      const reading = createReading({
        on_contact: 0,
        capstan_speed: 0,
        temperature_inlet_heater: 150,
        temperature_lower_heater: 200,
        temperature_after_catalyst: 180,
        temperature_upper_heater: 220,
      });
      expect(await checkConditions(reading)).toBe('HeatingUp');
    });

    test('Step 3: Temps at target but not yet 1 hour → still HeatingUp', async () => {
      ovenReadyResult = false; // belum 1 jam
      const reading = createReading({
        on_contact: 0,
        capstan_speed: 0,
        temperature_inlet_heater: 310,
        temperature_lower_heater: 320,
        temperature_after_catalyst: 305,
        temperature_upper_heater: 315,
      });
      expect(await checkConditions(reading)).toBe('HeatingUp');
    });

    test('Step 4: Oven ready, capstan low → Iddle[SU]', async () => {
      ovenReadyResult = true; // >= 1 jam
      const reading = createReading({
        on_contact: 0,
        capstan_speed: 20,
        temperature_inlet_heater: 310,
        temperature_lower_heater: 320,
        temperature_after_catalyst: 305,
        temperature_upper_heater: 315,
        speed_to_production: 60,
      });
      expect(await checkConditions(reading)).toBe('Iddle[SU]');
    });

    test('Step 5: Oven ready, capstan high, making sample → Iddle[Make Sample]', async () => {
      ovenReadyResult = true;
      sampleReadyResult = true;
      const reading = createReading({
        on_contact: 0,
        capstan_speed: 75,
        temperature_inlet_heater: 310,
        temperature_lower_heater: 320,
        temperature_after_catalyst: 305,
        temperature_upper_heater: 315,
        speed_to_production: 60,
      });
      expect(await checkConditions(reading)).toBe('Iddle[Make Sample]');
    });

    test('Step 6: Full production', async () => {
      ovenReadyResult = true;
      const reading = createReading({
        on_contact: 1,
        capstan_speed: 80,
        temperature_inlet_heater: 310,
        temperature_lower_heater: 320,
        temperature_after_catalyst: 305,
        temperature_upper_heater: 315,
        speed_to_production: 60,
      });
      expect(await checkConditions(reading)).toBe('MachineProduction');
    });
  });
});
