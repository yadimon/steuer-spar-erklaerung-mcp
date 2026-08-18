const uint32 = (value) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
};

const record = (name, type, value) => {
  const nameBytes = Buffer.from(`${name}\0`, "ascii");
  return Buffer.concat([uint32(nameBytes.length), nameBytes, Buffer.from([type]), uint32(value.length), value]);
};

const textRecord = (name, value) => record(name, 4, Buffer.from(`${value}\0`, "utf8"));

export function createSyntheticAkadCase({
  fileType = "Gew",
  year = "2025",
  taxNumber = "synthetisch",
  transferTime = "",
  payload = Buffer.from([1, 2, 3, 4]),
} = {}) {
  const uuid = Buffer.from("12345678-1234-1234-1234-123456789abc\0", "ascii");
  return Buffer.concat([
    Buffer.from("AKAD", "ascii"),
    Buffer.alloc(8),
    uint32(uuid.length),
    uuid,
    Buffer.from("FIIF", "ascii"),
    Buffer.from([0xaa, 0xbb, 0xcc]),
    textRecord("FileType", fileType),
    textRecord("VJahr", year),
    textRecord("Steuernummer", taxNumber),
    textRecord("ElsterTransferTime", transferTime),
    record("svCrypted", 12, payload),
  ]);
}
