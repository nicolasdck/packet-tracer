/** Arbitrary OUI-like base so generated addresses look like real hardware. */
const MAC_BASE = 0x00d0_ba00_0000

/**
 * Deterministic MAC for port `portIndex` of the device created with sequence `seq`.
 * Formatted the IOS way: "00d0.ba00.0101".
 */
export function deviceMac(seq: number, portIndex: number): string {
  if (seq < 0 || seq > 0xffff || portIndex < 0 || portIndex > 0xff) {
    throw new RangeError(`MAC out of range: seq=${seq} port=${portIndex}`)
  }
  const hex = (MAC_BASE + seq * 0x100 + portIndex).toString(16).padStart(12, '0')
  return `${hex.slice(0, 4)}.${hex.slice(4, 8)}.${hex.slice(8, 12)}`
}
