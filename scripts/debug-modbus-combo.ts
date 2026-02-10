// scripts/debug-modbus-combo.ts
// Test ALL combinations: address vs address-1, BE vs LSRF
// Tujuan: cari kombinasi yang match dengan ModScan (851 dan 217)

import ModbusRTU from 'modbus-serial';
import { getMachine } from '../data/machine';
import type { MachineData, MappingParam } from '../type';

function parseFloat32BE(data: number[], offset: number = 0): number {
  const buf = Buffer.alloc(4);
  buf.writeUInt16BE(data[offset] ?? 0, 0);
  buf.writeUInt16BE(data[offset + 1] ?? 0, 2);
  return buf.readFloatBE(0);
}

function parseFloat32LSRF(data: number[], offset: number = 0): number {
  // Word swap: swap the two registers, then read as BE
  const buf = Buffer.alloc(4);
  buf.writeUInt16BE(data[offset + 1] ?? 0, 0); // Low word → position 0 (becomes high)
  buf.writeUInt16BE(data[offset] ?? 0, 2);      // High word → position 2 (becomes low)
  return buf.readFloatBE(0);
}

async function comboTest() {
  console.log('=== MODBUS COMBO TEST ===');
  console.log('Target: Match ModScan values (851 dan 217)\n');

  const machines = await getMachine() as unknown as MachineData[];
  if (!machines || machines.length === 0) {
    console.log('❌ No machines found');
    return;
  }

  const machine = machines[0]!;
  const sensor = machine.power_meter;
  const config = sensor.gateway.config as { ip: string; port: number };
  const params = sensor.mapping.params as MappingParam[];

  console.log(`Machine: ${machine.name}`);
  console.log(`Gateway: ${config.ip}:${config.port}, Slave ID: ${sensor.address}\n`);

  const client = new ModbusRTU();
  await client.connectTCP(config.ip, { port: Number(config.port) });
  client.setTimeout(5000);
  client.setID(sensor.address);
  console.log('✓ Connected!\n');

  // Test setiap param (kwh_high dan kwh_low)
  for (const param of params) {
    const addr = param.address;
    console.log(`${'='.repeat(60)}`);
    console.log(`PARAM: ${param.name} (DB address: ${addr})`);
    console.log(`${'='.repeat(60)}`);

    // Read 4 registers starting from addr-1 to cover both possibilities
    // This gives us registers at: addr-1, addr, addr+1, addr+2
    try {
      const result = await client.readInputRegisters(addr - 1, 4);
      
      console.log(`\nRaw Registers (FC04):`);
      for (let i = 0; i < result.data.length; i++) {
        const v = result.data[i] ?? 0;
        console.log(`  [${addr - 1 + i}] = ${v} (0x${v.toString(16).padStart(4, '0')})`);
      }

      // 4 Combinations
      console.log(`\n┌────────────────────────────────┬──────────────┐`);
      console.log(`│ Combination                    │ Value        │`);
      console.log(`├────────────────────────────────┼──────────────┤`);

      // 1. addr + BE (current code)
      const v1 = parseFloat32BE(Array.from(result.data), 1); // offset 1 = addr
      console.log(`│ addr(${addr})   + float32-be   │ ${v1.toFixed(2).padStart(12)} │`);

      // 2. addr + LSRF
      const v2 = parseFloat32LSRF(Array.from(result.data), 1); // offset 1 = addr
      console.log(`│ addr(${addr})   + float32-lsrf │ ${v2.toFixed(2).padStart(12)} │`);

      // 3. addr-1 + BE
      const v3 = parseFloat32BE(Array.from(result.data), 0); // offset 0 = addr-1
      console.log(`│ addr(${addr - 1}) + float32-be   │ ${v3.toFixed(2).padStart(12)} │`);

      // 4. addr-1 + LSRF  ← This is likely what ModScan does
      const v4 = parseFloat32LSRF(Array.from(result.data), 0); // offset 0 = addr-1
      console.log(`│ addr(${addr - 1}) + float32-lsrf │ ${v4.toFixed(2).padStart(12)} │ ← ModScan?`);

      console.log(`└────────────────────────────────┴──────────────┘`);

      // Also try FC03 (Holding Registers)
      try {
        const result3 = await client.readHoldingRegisters(addr - 1, 4);
        console.log(`\nFC03 (Holding Registers):`);
        console.log(`  addr(${addr})   + BE:   ${parseFloat32BE(Array.from(result3.data), 1).toFixed(2)}`);
        console.log(`  addr(${addr})   + LSRF: ${parseFloat32LSRF(Array.from(result3.data), 1).toFixed(2)}`);
        console.log(`  addr(${addr - 1}) + BE:   ${parseFloat32BE(Array.from(result3.data), 0).toFixed(2)}`);
        console.log(`  addr(${addr - 1}) + LSRF: ${parseFloat32LSRF(Array.from(result3.data), 0).toFixed(2)}`);
      } catch {
        console.log(`\nFC03 (Holding Registers): ERROR / Not supported`);
      }

    } catch (error) {
      console.log(`❌ Error: ${error}`);
    }

    console.log('');
    await new Promise(r => setTimeout(r, 200));
  }

  await client.close();
  console.log('=== DONE ===');
  process.exit(0);
}

comboTest().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
