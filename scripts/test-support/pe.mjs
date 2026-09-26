// Enough of a Windows executable reader for the release gates to read Kino.exe's
// resources back on any platform: the section table, the three level resource
// tree, and a VS_VERSIONINFO block. Anything unexpected throws.

export const RT_ICON = 3;
export const RT_GROUP_ICON = 14;
export const RT_VERSION = 16;

// Every resource as { type, name, language, data }. A name is a number, or a
// string for a resource named in the .rc file, such as IDI_ICON1.
export function peResources(file) {
  if (file.toString('ascii', 0, 2) !== 'MZ') throw new Error('not a Windows executable');
  const pe = file.readUInt32LE(0x3c);
  if (file.toString('binary', pe, pe + 4) !== 'PE\0\0') throw new Error('no PE signature');
  const sections = file.readUInt16LE(pe + 6);
  const optional = pe + 24;
  const optionalSize = file.readUInt16LE(pe + 20);
  const magic = file.readUInt16LE(optional);
  if (magic !== 0x10b && magic !== 0x20b) throw new Error(`unknown optional header ${magic}`);
  const directories = optional + (magic === 0x20b ? 112 : 96);
  const resourceRva = file.readUInt32LE(directories + 2 * 8);
  if (!resourceRva) return [];

  const table = [];
  for (let i = 0; i < sections; i += 1) {
    const at = optional + optionalSize + 40 * i;
    table.push({
      rva: file.readUInt32LE(at + 12),
      size: Math.max(file.readUInt32LE(at + 8), file.readUInt32LE(at + 16)),
      offset: file.readUInt32LE(at + 20),
    });
  }
  const offsetOf = (rva) => {
    const section = table.find((s) => rva >= s.rva && rva < s.rva + s.size);
    if (!section) throw new Error(`RVA ${rva} is in no section`);
    return section.offset + rva - section.rva;
  };

  const base = offsetOf(resourceRva);
  const entries = (directory) => {
    const count = file.readUInt16LE(directory + 12) + file.readUInt16LE(directory + 14);
    return Array.from({ length: count }, (_, i) => {
      const at = directory + 16 + 8 * i;
      const id = file.readUInt32LE(at);
      const target = file.readUInt32LE(at + 4);
      let name = id;
      if (id & 0x80000000) {
        const string = base + (id & 0x7fffffff);
        name = file.toString('utf16le', string + 2, string + 2 + 2 * file.readUInt16LE(string));
      }
      return {
        name,
        target: base + (target & 0x7fffffff),
        directory: Boolean(target & 0x80000000),
      };
    });
  };

  const resources = [];
  for (const type of entries(base))
    for (const name of entries(type.target))
      for (const language of entries(name.target)) {
        if (!type.directory || !name.directory || language.directory)
          throw new Error('unexpected resource tree shape');
        const data = offsetOf(file.readUInt32LE(language.target));
        const size = file.readUInt32LE(language.target + 4);
        resources.push({
          type: type.name,
          name: name.name,
          language: language.name,
          data: file.subarray(data, data + size),
        });
      }
  return resources;
}

// A VS_VERSIONINFO resource as its fixed numeric versions and its string table.
export function versionInfo(data) {
  const align = (at) => (at + 3) & ~3;
  const block = (start) => {
    const length = data.readUInt16LE(start);
    const valueLength = data.readUInt16LE(start + 2);
    const text = data.readUInt16LE(start + 4) === 1;
    let at = start + 6;
    let keyEnd = at;
    while (data.readUInt16LE(keyEnd) !== 0) keyEnd += 2;
    const key = data.toString('utf16le', at, keyEnd);
    at = align(keyEnd + 2);
    let value = data.subarray(at, at + (text ? 2 * valueLength : valueLength));
    if (text) value = value.toString('utf16le').replace(/\0.*$/s, '');
    at = align(at + (text ? 2 * valueLength : valueLength));
    const children = [];
    while (at < start + length) {
      const child = block(at);
      children.push(child);
      at = align(at + child.length);
    }
    return { key, value, children, length };
  };

  const root = block(0);
  if (root.key !== 'VS_VERSION_INFO') throw new Error(`unexpected version key ${root.key}`);
  const fixed = root.value;
  if (fixed.readUInt32LE(0) !== 0xfeef04bd) throw new Error('no VS_FIXEDFILEINFO');
  const quad = (at) =>
    [fixed.readUInt32LE(at) >>> 16, fixed.readUInt32LE(at) & 0xffff]
      .concat([fixed.readUInt32LE(at + 4) >>> 16, fixed.readUInt32LE(at + 4) & 0xffff])
      .join('.');
  const strings = {};
  for (const table of root.children.find((c) => c.key === 'StringFileInfo')?.children ?? [])
    for (const string of table.children) strings[string.key] = string.value;
  return { fileVersion: quad(8), productVersion: quad(16), strings };
}
