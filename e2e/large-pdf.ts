import { crc32, deflateSync } from "node:zlib";
import { randomBytes } from "node:crypto";
import { PDFDocument } from "pdf-lib";

/** A valid single-page PDF of roughly `mb` megabytes (incompressible noise image), built without extra dependencies. */
export async function makeLargePdf(mb: number): Promise<Uint8Array> {
  const side = Math.ceil(Math.sqrt((mb * 1024 * 1024) / 3));
  const raw = Buffer.alloc((side * 3 + 1) * side);
  for (let y = 0; y < side; y++) randomBytes(side * 3).copy(raw, y * (side * 3 + 1) + 1); // filter byte 0 + noise
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(side, 0);
  ihdr.writeUInt32BE(side, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(2, 9); // RGB
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 0 })), chunk("IEND", Buffer.alloc(0))]);

  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const img = await doc.embedPng(png);
  page.drawImage(img, { x: 36, y: 100, width: 540, height: 540 });
  return doc.save();
}
