/**
 * Minimal JPEG EXIF reader — no dependencies.
 *
 * Why this exists: a site photo is only dispute-grade evidence if its
 * time + GPS come from the PHOTO itself (EXIF DateTimeOriginal + GPS IFD),
 * not from where the uploader happens to stand. Every phone camera writes
 * EXIF; WhatsApp/forwarded copies usually strip it — in which case we say
 * so honestly and fall back to device GPS at upload time.
 *
 * Returns { takenAt: Date|null, lat: number|null, lon: number|null }.
 * Never throws — corrupted/absent EXIF yields nulls.
 */

export function parseExifFromBuffer(buf) {
  const out = { takenAt: null, lat: null, lon: null };
  try {
    const dv =
      buf instanceof DataView
        ? buf
        : new DataView(buf.buffer || buf, buf.byteOffset || 0, buf.byteLength);
    if (dv.byteLength < 4 || dv.getUint16(0) !== 0xffd8) return out; // not JPEG

    let off = 2;
    while (off + 4 <= dv.byteLength) {
      if (dv.getUint8(off) !== 0xff) break;
      const marker = dv.getUint8(off + 1);
      if (marker === 0xda || marker === 0xd9) break; // SOS / EOI: image data
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        off += 2; // standalone markers, no length
        continue;
      }
      const len = dv.getUint16(off + 2);
      if (len < 2) break;
      if (marker === 0xe1 && len > 8) {
        if (
          dv.getUint32(off + 4) === 0x45786966 && // "Exif"
          dv.getUint16(off + 8) === 0
        ) {
          parseTiff(dv, off + 10, out);
          break;
        }
      }
      off += 2 + len;
    }
  } catch {
    // corrupted file — nulls stand
  }
  return out;
}

/** Convenience wrapper for File/Blob. */
export async function parseExifFromFile(file) {
  try {
    const buf = await file.arrayBuffer();
    return parseExifFromBuffer(buf);
  } catch {
    return { takenAt: null, lat: null, lon: null };
  }
}

function parseTiff(dv, base, out) {
  if (base + 8 > dv.byteLength) return;
  const order = dv.getUint16(base);
  const le = order === 0x4949 ? true : order === 0x4d4d ? false : null;
  if (le === null || dv.getUint16(base + 2, le) !== 42) return;

  const u16 = (p) => dv.getUint16(p, le);
  const u32 = (p) => dv.getUint32(p, le);
  const asciiAt = (p, n) => {
    let s = "";
    for (let i = 0; i < n && p + i < dv.byteLength; i++) {
      const c = dv.getUint8(p + i);
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  };
  // ASCII value of an IFD entry (inline if <=4 bytes, else offset).
  const asciiEntry = (e, count) =>
    count <= 4 ? asciiAt(e + 8, count) : asciiAt(base + u32(e + 8), count);

  const readIfd = (ifdOff) => {
    if (ifdOff <= 0 || base + ifdOff + 2 > dv.byteLength) return [];
    const n = u16(base + ifdOff);
    const entries = [];
    for (let i = 0; i < n; i++) {
      const e = base + ifdOff + 2 + i * 12;
      if (e + 12 > dv.byteLength) break;
      entries.push({
        tag: u16(e),
        type: u16(e + 2),
        count: u32(e + 4),
        entry: e,
      });
    }
    return entries;
  };

  const rational = (p) => {
    const den = u32(p + 4);
    return den === 0 ? 0 : u32(p) / den;
  };
  const dmsToDeg = (p) =>
    rational(p) + rational(p + 8) / 60 + rational(p + 16) / 3600;

  for (const en of readIfd(u32(base + 4))) {
    if (en.tag === 0x8769) {
      // Exif sub-IFD → DateTimeOriginal
      for (const s of readIfd(u32(en.entry + 8))) {
        if (s.tag === 0x9003 && s.type === 2) {
          const dt = asciiEntry(s.entry, s.count);
          const m =
            /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(dt);
          if (m) {
            out.takenAt = new Date(
              +m[1],
              +m[2] - 1,
              +m[3],
              +m[4],
              +m[5],
              +m[6]
            );
          }
        }
      }
    } else if (en.tag === 0x8825) {
      // GPS IFD → lat/lon
      let latRef = "N";
      let lonRef = "E";
      let latOff = 0;
      let lonOff = 0;
      for (const g of readIfd(u32(en.entry + 8))) {
        if (g.tag === 0x0001 && g.type === 2) latRef = asciiEntry(g.entry, g.count);
        else if (g.tag === 0x0002 && g.count >= 3) latOff = base + u32(g.entry + 8);
        else if (g.tag === 0x0003 && g.type === 2) lonRef = asciiEntry(g.entry, g.count);
        else if (g.tag === 0x0004 && g.count >= 3) lonOff = base + u32(g.entry + 8);
      }
      if (latOff && lonOff) {
        out.lat = dmsToDeg(latOff) * (latRef.toUpperCase() === "S" ? -1 : 1);
        out.lon = dmsToDeg(lonOff) * (lonRef.toUpperCase() === "W" ? -1 : 1);
      }
    }
  }
}

/** "18.5204, 73.8567" — stamp-friendly coordinate pair. */
export function formatLatLon(lat, lon) {
  if (lat == null || lon == null) return null;
  return `${Number(lat).toFixed(6)}, ${Number(lon).toFixed(6)}`;
}
