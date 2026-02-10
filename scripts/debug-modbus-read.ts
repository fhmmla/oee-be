// scripts/debug-modbus-read.ts
// Diagnostic: baca raw register dan tampilkan semua kemungkinan interpretasi data

import ModbusRTU from 'modbus-serial';
import { getMachine } from '../data/machine';
import type { MachineData, MappingParam } from '../type';

async function debugRead() {
  console.log('=== MODBUS DEBUG READER ===\n');

  // 1. Ambil konfigurasi machine dari database
  const machines = await getMachine() as unknown as MachineData[];
  if (!machines || machines.length === 0) {
    console.log('❌ No machines found');
    return;
  }

  for (const machine of machines) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`MACHINE: ${machine.name} (ID: ${machine.id})`);
    console.log(`${'='.repeat(60)}`);

    // Focus on power_meter (KWH) since that's the problematic one
    const sensor = machine.power_meter;
    const gateway = sensor.gateway;
    const config = gateway.config as { ip: string; port: number };
    const params = sensor.mapping.params as MappingParam[];

    console.log(`\nGateway: ${gateway.name} (${config.ip}:${config.port})`);
    console.log(`Slave/Unit ID: ${sensor.address}`);
    console.log(`Mapping Type: ${sensor.mapping.type}`);
    console.log(`Params count: ${params.length}`);
    console.log(`Params: ${JSON.stringify(params, null, 2)}`);

    // Connect to gateway
    const client = new ModbusRTU();
    try {
      await client.connectTCP(config.ip, { port: config.port });
      client.setTimeout(5000);
      client.setID(sensor.address);

      console.log(`\n✓ Connected to ${config.ip}:${config.port}`);

      // Read each param
      for (const param of params) {
        console.log(`\n--- Param: "${param.name}" ---`);
        console.log(`  Address: ${param.address}`);
        console.log(`  Length: ${param.length} register(s)`);
        console.log(`  Data Type: ${param.data_type}`);
        console.log(`  Formula: ${param.formula}`);

        try {
          // Read input registers (FC 04)
          const result = await client.readInputRegisters(param.address, param.length);

          console.log(`\n  📊 Raw Register Values:`);
          for (let i = 0; i < result.data.length; i++) {
            const val = result.data[i] ?? 0;
            console.log(`    Register[${param.address + i}] = ${val} (0x${val.toString(16).padStart(4, '0')})`);
          }

          // Build buffer
          const buffer = Buffer.alloc(param.length * 2);
          for (let i = 0; i < param.length; i++) {
            buffer.writeUInt16BE(result.data[i] || 0, i * 2);
          }

          console.log(`  📦 Buffer (hex): ${buffer.toString('hex')}`);
          console.log(`  📦 Buffer bytes: [${Array.from(buffer).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);

          // Try all possible interpretations
          console.log(`\n  🔍 All Possible Interpretations:`);

          if (param.length === 1) {
            // Single register (16-bit)
            console.log(`    uint16-be:  ${buffer.readUInt16BE(0)}`);
            console.log(`    uint16-le:  ${buffer.readUInt16LE(0)}`);
            console.log(`    int16-be:   ${buffer.readInt16BE(0)}`);
            console.log(`    int16-le:   ${buffer.readInt16LE(0)}`);
          }

          if (param.length >= 2) {
            // Two registers (32-bit)
            
            // 1. Float32 Big Endian (MSRF) - AB CD
            console.log(`    float32-be (MSRF)  [AB CD]:     ${buffer.readFloatBE(0)}`);
            
            // 2. Float32 Little Endian - DC BA
            console.log(`    float32-le         [DC BA]:     ${buffer.readFloatLE(0)}`);

            // 3. Float32 LSRF (Word Swap) - CD AB
            const lsrf = Buffer.alloc(4);
            buffer.copy(lsrf, 0, 2, 4);
            buffer.copy(lsrf, 2, 0, 2);
            console.log(`    float32-lsrf (WS)  [CD AB]:     ${lsrf.readFloatBE(0)}`);

            // 4. Float32 Byte Swap - BA DC
            const bswap = Buffer.alloc(4);
            bswap[0] = buffer[1]!; bswap[1] = buffer[0]!;
            bswap[2] = buffer[3]!; bswap[3] = buffer[2]!;
            console.log(`    float32-bswap      [BA DC]:     ${bswap.readFloatBE(0)}`);

            // Integer interpretations
            console.log(`    uint32-be:         ${buffer.readUInt32BE(0)}`);
            console.log(`    uint32-le:         ${buffer.readUInt32LE(0)}`);
            console.log(`    int32-be:          ${buffer.readInt32BE(0)}`);
            console.log(`    int32-le:          ${buffer.readInt32LE(0)}`);

            // Individual uint16 values (for concatenation logic)
            const reg0 = result.data[0] ?? 0;
            const reg1 = result.data[1] ?? 0;
            console.log(`    reg[0] as uint16:  ${reg0}`);
            console.log(`    reg[1] as uint16:  ${reg1}`);
            console.log(`    concat "${reg0}${reg1}": ${parseInt(`${reg0}${reg1}`)}`);
            console.log(`    concat "${reg1}${reg0}": ${parseInt(`${reg1}${reg0}`)}`);

          }

          // Apply formula
          console.log(`\n  🧮 With formula (×${param.formula}):`);
          if (param.length >= 2) {
            const lsrfFormula = Buffer.alloc(4);
            buffer.copy(lsrfFormula, 0, 2, 4);
            buffer.copy(lsrfFormula, 2, 0, 2);
            console.log(`    float32-be × ${param.formula}  = ${buffer.readFloatBE(0) * param.formula}`);
            console.log(`    float32-le × ${param.formula}  = ${buffer.readFloatLE(0) * param.formula}`);
            console.log(`    float32-lsrf × ${param.formula} = ${lsrfFormula.readFloatBE(0) * param.formula}`);
          }

        } catch (error) {
          console.log(`  ❌ Error reading: ${error}`);
        }

        // Small delay between reads
        await new Promise(r => setTimeout(r, 200));
      }

      await client.close();
    } catch (error) {
      console.log(`❌ Connection error: ${error}`);
    }
  }

  console.log('\n=== DEBUG COMPLETE ===');
  process.exit(0);
}

debugRead().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
