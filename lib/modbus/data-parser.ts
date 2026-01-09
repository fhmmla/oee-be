// lib/modbus/data-parser.ts
// Parser untuk berbagai tipe data Modbus

export function parseModbusData(buffer: Buffer, dataType: string): number {
  try {
    switch (dataType.toLowerCase()) {
      case 'float32-be':
      case 'float32be':
        // Big Endian Float (32-bit)
        return buffer.readFloatBE(0);

      case 'float32-le':
      case 'float32le':
        // Little Endian Float (32-bit)
        return buffer.readFloatLE(0);

      case 'int16':
      case 'int16-be':
        // Signed 16-bit Big Endian
        return buffer.readInt16BE(0);

      case 'int16-le':
        // Signed 16-bit Little Endian
        return buffer.readInt16LE(0);

      case 'uint16':
      case 'uint16-be':
        // Unsigned 16-bit Big Endian
        return buffer.readUInt16BE(0);

      case 'uint16-le':
        // Unsigned 16-bit Little Endian
        return buffer.readUInt16LE(0);

      case 'int32':
      case 'int32-be':
        // Signed 32-bit Big Endian
        return buffer.readInt32BE(0);

      case 'int32-le':
        // Signed 32-bit Little Endian
        return buffer.readInt32LE(0);

      case 'uint32':
      case 'uint32-be':
        // Unsigned 32-bit Big Endian
        return buffer.readUInt32BE(0);

      case 'uint32-le':
        // Unsigned 32-bit Little Endian
        return buffer.readUInt32LE(0);

      default:
        throw new Error(`Unsupported data type: ${dataType}`);
    }
  } catch (error) {
    throw new Error(`Failed to parse data type ${dataType}: ${error}`);
  }
}
