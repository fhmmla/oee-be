// check-machine-id.ts
// Script untuk mengecek Machine ID dari server ini

import { getMachineId, getShortMachineId } from './lib/machine-id';

console.log('============================================');
console.log('        Machine ID Check Script');
console.log('============================================\n');

console.log('🔑 Machine ID (Full - SHA256 Hash):');
console.log('--------------------------------------------');
console.log(getMachineId());

console.log('\n🔑 Machine ID (Short - 16 chars):');
console.log('--------------------------------------------');
console.log(getShortMachineId());

console.log('\n💡 Gunakan Machine ID di atas untuk generate license key.');
console.log('============================================\n');
