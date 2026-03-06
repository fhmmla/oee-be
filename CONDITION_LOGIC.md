# Logika Pengecekan Kondisi Mesin (Machine Condition)

## Pembaruan Struktur Data

### Perubahan pada Schema:
1. **Machine**: Sekarang memiliki 4 temperature sensor (bukan 1)
   - `temperature_inlet_heater_id`
   - `temperature_lower_heater_id`
   - `temperature_after_catalyst_id`
   - `temperature_upper_heater_id`

2. **TemperatureSensor**: Ditambahkan kolom `target_temp` (default: 300)
   - Setiap sensor memiliki target temperature sendiri

3. **CapstanSpeed**: Ditambahkan kolom `speed_to_production` (default: 60)
   - ⚠️ Tidak lagi digunakan untuk penentuan kondisi, tetapi tetap dilog ke LogHistory

4. **LogHistory**: 
   - Dihapus: `alarm_contact`, `temperature` (single)
   - Ditambah: 4 kolom temperature
     - `temperature_inlet_heater`
     - `temperature_lower_heater`
     - `temperature_after_catalyst`
     - `temperature_upper_heater`
   - `capstan_speed` sekarang bertipe `Int` (sebelumnya `String`)

5. **AlarmContactSensor**: Dihapus sepenuhnya dari sistem

---

## Variabel Input (Sensor Reading)

| Variabel | Tipe | Deskripsi |
|----------|------|-----------|
| `on_contact` | Int (0/1) | Status kontak ON (0 = OFF, 1 = ON) |
| `temperature_inlet_heater` | Int | Suhu inlet heater (°C) |
| `temperature_lower_heater` | Int | Suhu lower heater (°C) |
| `temperature_after_catalyst` | Int | Suhu after catalyst (°C) |
| `temperature_upper_heater` | Int | Suhu upper heater (°C) |
| `capstan_speed` | Int | Kecepatan capstan (hanya untuk logging, bukan condition) |
| `target_temp_*` | Int | Target temperature masing-masing sensor (dari database) |

---

## 🔥 Definisi "Oven"

**Oven** adalah gabungan dari 4 sensor temperature dengan logic AND:
- `temperature_inlet_heater` >= `target_temp_inlet_heater`
- `temperature_lower_heater` >= `target_temp_lower_heater`
- `temperature_after_catalyst` >= `target_temp_after_catalyst`
- `temperature_upper_heater` >= `target_temp_upper_heater`

**Oven = ON** hanya jika **SEMUA 4 sensor** mencapai target masing-masing **selama minimal 1 jam** secara kontinu.

**Oven = MATI (0)** jika **SEMUA 4 sensor** bernilai 0.

---

## Logika Kondisi (4 Conditions) — VERSI BARU

### 1️⃣ **MachineProduction**
```
JIKA on_contact >= 1 (ON)
MAKA kondisi = "MachineProduction"

Catatan: Langsung Production jika on_contact ON, 
tanpa perlu cek suhu oven apapun.
```

### 2️⃣ **MachineOFF**
```
JIKA on_contact < 1 (OFF)
DAN temperature_inlet_heater = 0
DAN temperature_lower_heater = 0
DAN temperature_after_catalyst = 0
DAN temperature_upper_heater = 0
MAKA kondisi = "MachineOFF"

Catatan: Mesin benar-benar mati — kontak OFF dan semua suhu 0.
```

### 3️⃣ **Iddle**
```
JIKA on_contact < 1 (OFF)
DAN temperature_inlet_heater >= target_temp_inlet_heater selama 1 jam
DAN temperature_lower_heater >= target_temp_lower_heater selama 1 jam
DAN temperature_after_catalyst >= target_temp_after_catalyst selama 1 jam
DAN temperature_upper_heater >= target_temp_upper_heater selama 1 jam
MAKA kondisi = "Iddle"

Catatan: Oven sudah panas (semua sensor >= target 1 jam) tapi mesin tidak produksi (on_contact OFF).
```

### 4️⃣ **HeatingUp**
```
JIKA on_contact < 1 (OFF)
DAN TIDAK semua temperature = 0
DAN TIDAK (semua 4 sensor >= target_temp selama 1 jam)
MAKA kondisi = "HeatingUp"

Catatan: Oven sedang dipanaskan (ada temp > 0) tapi belum semua sensor 
mencapai target selama 1 jam penuh.
```

---

## 📊 Decision Tree (Pohon Keputusan)

```
                        ┌──────────────────┐
                        │   Start Check    │
                        └────────┬─────────┘
                                 │
                        ┌────────▼─────────┐
                        │ on_contact >= 1? │
                        └────────┬─────────┘
                                 │
               ┌─────────────────┼─────────────────┐
               │ YES             │                 │ NO
               ▼                 │                 ▼
      ┌─────────────────┐        │    ┌────────────────────────┐
      │MachineProduction│        │    │ Semua 4 temp = 0?      │
      └─────────────────┘        │    └───────────┬────────────┘
                                 │                │
                                 │    ┌───────────┼───────────┐
                                 │    │ YES       │           │ NO
                                 │    ▼           │           ▼
                                 │ ┌──────────┐   │  ┌────────────────────────┐
                                 │ │MachineOFF│   │  │ ALL 4 temps >= target  │
                                 │ └──────────┘   │  │    for 1 hour?         │
                                 │                │  └───────────┬────────────┘
                                 │                │              │
                                 │                │  ┌───────────┼───────────┐
                                 │                │  │ NO        │           │ YES
                                 │                │  ▼           │           ▼
                                 │                │ ┌─────────┐  │  ┌─────────┐
                                 │                │ │HeatingUp│  │  │  Iddle  │
                                 │                │ └─────────┘  │  └─────────┘
```

---

## 📝 Ringkasan Urutan Prioritas

| Prioritas | Kondisi | Syarat |
|-----------|---------|--------|
| 1 | **MachineProduction** | `on_contact >= 1` (ON) |
| 2 | **MachineOFF** | `on_contact < 1` (OFF) ∧ semua 4 temp = 0 |
| 3 | **Iddle** | `on_contact < 1` (OFF) ∧ `allTempsReachedTarget = true` |
| 4 | **HeatingUp** | `on_contact < 1` (OFF) ∧ ada temp > 0 ∧ `allTempsReachedTarget = false` |

---

## 🔥 Logika Temperature Tracker

Temperature tracker melakukan tracking **per sensor** dengan key format: `machineId:sensorType`

### Contoh Cache Keys:
- `1:temperature_inlet_heater`
- `1:temperature_lower_heater`
- `1:temperature_after_catalyst`
- `1:temperature_upper_heater`

### Flow Pengecekan per Sensor:

#### 1️⃣ **Reset Tracking**
```
JIKA temperature < target_temp (untuk sensor tersebut)
MAKA reset timer (heatingUpSince = null)
```

#### 2️⃣ **Start Tracking**
```
JIKA temperature >= target_temp
DAN sebelumnya temperature < target_temp
MAKA mulai tracking dari waktu sekarang
```

#### 3️⃣ **Continue Tracking**
```
JIKA temperature >= target_temp
DAN sebelumnya sudah >= target_temp (kontinyu)
MAKA lanjutkan tracking (tidak reset)
```

#### 4️⃣ **Check 1 Hour Threshold (per sensor)**
```
JIKA durasi tracking >= 1 jam (3.600.000 ms)
MAKA sensor tersebut telah mencapai target
```

#### 5️⃣ **Check All (untuk kondisi Iddle)**
```
Hanya jika SEMUA 4 sensor telah mencapai target selama 1 jam,
DAN on_contact OFF,
maka kondisi = Iddle
```

#### 6️⃣ **Fallback Logic** (untuk data gap/restart)
```
JIKA data LogHistory tidak cukup untuk sensor tertentu
DAN kondisi terakhir = "MachineProduction" ATAU "Iddle"
MAKA anggap sensor tersebut sudah mencapai target
(asumsi: kondisi sebelumnya valid)
```

---

## 📁 File yang Diubah

1. **`type.ts`** - Update interfaces untuk 4 temperature sensors
2. **`data/machine.ts`** - Update query untuk fetch 4 temperature sensors dengan target_temp
3. **`worker/grouper.ts`** - Update untuk group 7 sensors (tidak ada alarm_contact)
4. **`worker/temperature-tracker.ts`** - Track 4 sensors independently per machine
5. **`worker/data-processor.ts`** - New condition logic (Production=ON, OFF+temp0=MachineOFF, OFF+oven1hr=Iddle, OFF+heating=HeatingUp)
6. **`lib/modbus/reader.ts`** - Update sensor types
7. **`worker/modbus-worker.ts`** - Attach target temps dan speed_to_production

---

## ⚠️ Catatan Penting

1. **capstan_speed** tidak lagi digunakan untuk penentuan kondisi, tapi tetap dibaca dari Modbus dan disimpan ke LogHistory
2. **on_contact ON = Production** — langsung, tanpa cek suhu apapun
3. **MachineOFF** hanya jika on_contact OFF **DAN** semua 4 temperature = 0
4. **Migration Database**: Pastikan schema database sudah diupdate dan migration dijalankan
5. **Prisma Generate**: Jalankan `npx prisma generate` setelah migration
6. **Testing**: Test dengan berbagai kombinasi sensor values untuk memastikan logika benar
