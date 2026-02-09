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
   - Threshold untuk menentukan kondisi Production vs Iddle

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
| `capstan_speed` | Int | Kecepatan capstan |
| `target_temp_*` | Int | Target temperature masing-masing sensor (dari database) |
| `speed_to_production` | Int | Threshold speed untuk Production (dari database) |

---

## Logika Kondisi (4 Conditions)

### 1️⃣ **MachineOFF**
```
JIKA on_contact = 0
MAKA kondisi = "MachineOFF"
```

### 2️⃣ **HeatingUp**
```
JIKA on_contact = 1
DAN TIDAK (
    temperature_inlet_heater >= target_temp_inlet_heater selama 1 jam
    DAN temperature_lower_heater >= target_temp_lower_heater selama 1 jam
    DAN temperature_after_catalyst >= target_temp_after_catalyst selama 1 jam
    DAN temperature_upper_heater >= target_temp_upper_heater selama 1 jam
)
MAKA kondisi = "HeatingUp"

Catatan: Jika SALAH SATU dari 4 sensor belum mencapai target selama 1 jam,
maka kondisi tetap "HeatingUp"
```

### 3️⃣ **Iddle**
```
JIKA on_contact = 1
DAN temperature_inlet_heater >= target_temp_inlet_heater selama 1 jam
DAN temperature_lower_heater >= target_temp_lower_heater selama 1 jam
DAN temperature_after_catalyst >= target_temp_after_catalyst selama 1 jam
DAN temperature_upper_heater >= target_temp_upper_heater selama 1 jam
DAN capstan_speed < speed_to_production
MAKA kondisi = "Iddle"
```

### 4️⃣ **MachineProduction**
```
JIKA on_contact = 1
DAN temperature_inlet_heater >= target_temp_inlet_heater selama 1 jam
DAN temperature_lower_heater >= target_temp_lower_heater selama 1 jam
DAN temperature_after_catalyst >= target_temp_after_catalyst selama 1 jam
DAN temperature_upper_heater >= target_temp_upper_heater selama 1 jam
DAN capstan_speed >= speed_to_production
MAKA kondisi = "MachineProduction"
```

---

## 🔥 Logika Temperature Tracker

Temperature tracker sekarang melakukan tracking **per sensor** dengan key format: `machineId:sensorType`

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

#### 5️⃣ **Check All (untuk kondisi)**
```
Hanya jika SEMUA 4 sensor telah mencapai target selama 1 jam,
maka kondisi bisa berubah menjadi Iddle atau MachineProduction
```

#### 6️⃣ **Fallback Logic** (untuk data gap/restart)
```
JIKA data LogHistory tidak cukup untuk sensor tertentu
DAN kondisi terakhir = "MachineProduction" ATAU "Iddle"
MAKA anggap sensor tersebut sudah mencapai target
(asumsi: kondisi sebelumnya valid)
```

---

## 📊 Decision Tree (Pohon Keputusan)

```
                        ┌──────────────────┐
                        │   Start Check    │
                        └────────┬─────────┘
                                 │
                        ┌────────▼─────────┐
                        │  on_contact = 0? │
                        └────────┬─────────┘
                                 │
               ┌─────────────────┼─────────────────┐
               │ YES             │                 │ NO
               ▼                 │                 ▼
        ┌──────────────┐         │    ┌────────────────────────┐
        │  MachineOFF  │         │    │ ALL 4 temps >= target  │
        └──────────────┘         │    │    for 1 hour?         │
                                 │    └───────────┬────────────┘
                                 │                │
                                 │    ┌───────────┼───────────┐
                                 │    │ NO        │           │ YES
                                 │    ▼           │           ▼
                                 │ ┌─────────┐    │    ┌──────────────────────┐
                                 │ │HeatingUp│    │    │ capstan_speed >=     │
                                 │ └─────────┘    │    │ speed_to_production? │
                                 │                │    └───────────┬──────────┘
                                 │                │                │
                                 │                │    ┌───────────┼───────────┐
                                 │                │    │ NO        │           │ YES
                                 │                │    ▼           │           ▼
                                 │                │ ┌─────────┐    │ ┌─────────────────┐
                                 │                │ │  Iddle  │    │ │MachineProduction│
                                 │                │ └─────────┘    │ └─────────────────┘
```

---

## 📝 Ringkasan Urutan Prioritas

| Prioritas | Kondisi | Syarat |
|-----------|---------|--------|
| 1 | **MachineOFF** | `on_contact = 0` |
| 2 | **HeatingUp** | `on_contact = 1` ∧ `NOT allTempsReachedTarget` |
| 3 | **Iddle** | `on_contact = 1` ∧ `allTempsReachedTarget = true` ∧ `capstan_speed < speed_to_production` |
| 4 | **MachineProduction** | `on_contact = 1` ∧ `allTempsReachedTarget = true` ∧ `capstan_speed >= speed_to_production` |

---

## 📁 File yang Diubah

1. **`type.ts`** - Update interfaces untuk 4 temperature sensors
2. **`data/machine.ts`** - Update query untuk fetch 4 temperature sensors dengan target_temp
3. **`worker/grouper.ts`** - Update untuk group 7 sensors (tidak ada alarm_contact)
4. **`worker/temperature-tracker.ts`** - Track 4 sensors independently per machine
5. **`worker/data-processor.ts`** - New condition logic dengan 4 temperature checks
6. **`lib/modbus/reader.ts`** - Update sensor types
7. **`worker/modbus-worker.ts`** - Attach target temps dan speed_to_production

---

## ⚠️ Catatan Penting

1. **Migration Database**: Pastikan schema database sudah diupdate dan migration dijalankan
2. **Prisma Generate**: Jalankan `npx prisma generate` setelah migration
3. **Data Existing**: Data LogHistory lama mungkin memiliki struktur berbeda
4. **Testing**: Test dengan berbagai kombinasi sensor values untuk memastikan logika benar
