// scripts/debug-modbus-live.ts
// Live comparison: baca KWH register terus-menerus untuk dibandingkan real-time dengan ModScan

import ModbusRTU from 'modbus-serial';
import { getMachine } from '../data/machine';
import type { MachineData, MappingParam } from '../type';

function readFloat32BE(buffer: Buffer): number {
  return buffer.readFloatBE(0);
}

async function liveRead() {
  console.log('=== MODBUS LIVE KWH READER ===');
  console.log('Tekan Ctrl+C untuk berhenti\n');

  const machines = await getMachine() as unknown as MachineData[];
  if (!machines || machines.length === 0) {
    console.log('❌ No machines found');
    return;
  }

  // Ambil machine pertama saja untuk testing
  const machine = machines[0]!;
  const sensor = machine.power_meter;
  const gateway = sensor.gateway;
  const config = gateway.config as { ip: string; port: number };
  const params = sensor.mapping.params as MappingParam[];

  console.log(`Machine: ${machine.name}`);
  console.log(`Gateway: ${config.ip}:${config.port}`);
  console.log(`Slave ID: ${sensor.address}`);
  console.log(`Params: ${params.map(p => `${p.name} @ addr ${p.address} (len=${p.length})`).join(', ')}`);
  console.log('');

  const client = new ModbusRTU();
  await client.connectTCP(config.ip, { port: Number(config.port) });
  client.setTimeout(5000);
  client.setID(sensor.address);

  console.log('✓ Connected!\n');

  // Header
  console.log('┌─────────────────────┬───────────────────────────────────────────────┬───────────────────────────────────────────────┐');
  console.log('│ Timestamp           │ kwh_high                                      │ kwh_low                                       │');
  console.log('│                     │ addr / addr-1 / raw regs                      │ addr / addr-1 / raw regs                      │');
  console.log('├─────────────────────┼───────────────────────────────────────────────┼───────────────────────────────────────────────┤');

  let readCount = 0;
  const MAX_READS = 30; // Read 30 times then stop

  while (readCount < MAX_READS) {
    try {
      const now = new Date().toLocaleTimeString('id-ID');
      const results: string[] = [];

      for (const param of params) {
        // === Read with ORIGINAL address ===
        const result1 = await client.readInputRegisters(param.address, param.length);
        const buf1 = Buffer.alloc(param.length * 2);
        for (let i = 0; i < param.length; i++) {
          buf1.writeUInt16BE(result1.data[i] || 0, i * 2);
        }
        const val1 = readFloat32BE(buf1);

        // === Read with address - 1 (0-based correction) ===
        let val2 = NaN;
        let reg2Data: number[] = [];
        try {
          const result2 = await client.readInputRegisters(param.address - 1, param.length);
          const buf2 = Buffer.alloc(param.length * 2);
          for (let i = 0; i < param.length; i++) {
            buf2.writeUInt16BE(result2.data[i] || 0, i * 2);
          }
          val2 = readFloat32BE(buf2);
          reg2Data = Array.from(result2.data);
        } catch {
          val2 = NaN;
        }

        // === Also try Holding Registers (FC03) on original address ===
        let val3 = NaN;
        try {
          const result3 = await client.readHoldingRegisters(param.address, param.length);
          const buf3 = Buffer.alloc(param.length * 2);
          for (let i = 0; i < param.length; i++) {
            buf3.writeUInt16BE(result3.data[i] || 0, i * 2);
          }
          val3 = readFloat32BE(buf3);
        } catch {
          val3 = NaN;
        }

        const reg1Str = result1.data.map((v: number) => v).join(',');
        results.push(
          `FC04[${param.address}]=${val1.toFixed(2)} | ` +
          `FC04[${param.address - 1}]=${isNaN(val2) ? 'ERR' : val2.toFixed(2)} | ` +
          `FC03[${param.address}]=${isNaN(val3) ? 'ERR' : val3.toFixed(2)}`
        );

        await new Promise(r => setTimeout(r, 100));
      }

      console.log(`│ ${now.padEnd(19)} │ ${results[0]?.padEnd(45) ?? 'N/A'} │ ${results[1]?.padEnd(45) ?? 'N/A'} │`);

    } catch (error) {
      console.log(`│ ERROR: ${error}`.padEnd(130) + '│');
    }

    readCount++;
    await new Promise(r => setTimeout(r, 2000)); // Read every 2 seconds
  }

  console.log('└─────────────────────┴───────────────────────────────────────────────┴───────────────────────────────────────────────┘');

  await client.close();
  console.log('\n=== DONE ===');
  process.exit(0);
}

liveRead().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
