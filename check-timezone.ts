// check-timezone.ts
// Quick utility to check server timezone

console.log('=== Server Timezone Check ===\n');

const now = new Date();

// 1. Current time
console.log('Current Time:', now.toString());

// 2. Timezone offset
const offsetMinutes = now.getTimezoneOffset();
const offsetHours = -offsetMinutes / 60; // Negative because getTimezoneOffset returns opposite
console.log('Timezone Offset:', `UTC${offsetHours >= 0 ? '+' : ''}${offsetHours}`);

// 3. Expected for WIB
console.log('Expected for WIB: UTC+7');

// 4. Check if correct
if (offsetHours === 7) {
  console.log('\n✅ SUCCESS: Server is in UTC+7 (WIB)');
} else {
  console.log('\n❌ WARNING: Server is NOT in UTC+7');
  console.log(`   Current: UTC${offsetHours >= 0 ? '+' : ''}${offsetHours}`);
  console.log('   Expected: UTC+7');
  console.log('\n   Please set server timezone to Asia/Jakarta or UTC+7');
}

// 5. Show what time the daily cron will run
console.log('\n=== Cron Schedule ===');
console.log('Daily calculation cron: 0 1 * * *');
console.log('Will run at: 01:00 in server timezone');

if (offsetHours === 7) {
  console.log('Expected run time: 01:00 WIB (Jakarta time)');
} else {
  console.log(`WARNING: Will run at 01:00 UTC${offsetHours >= 0 ? '+' : ''}${offsetHours}, NOT WIB!`);
}

// 6. ISO String comparison
console.log('\n=== Time Details ===');
console.log('Local String:', now.toLocaleString());
console.log('UTC String:', now.toUTCString());
console.log('ISO String:', now.toISOString());
