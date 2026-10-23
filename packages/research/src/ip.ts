import { isIP } from "node:net";

/** Parses a dotted IPv4 address into four octets. */
export function parseIPv4(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) {
    return null;
  }
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : null;
}

/** Parses an IPv6 address (with `::`, an embedded IPv4 tail or a zone id) into eight 16-bit groups. */
export function parseIPv6(address: string): number[] | null {
  let text = address.split("%")[0];
  const tail = text.lastIndexOf(":");
  if (tail !== -1 && text.slice(tail + 1).includes(".")) {
    const v4 = parseIPv4(text.slice(tail + 1));
    if (!v4) {
      return null;
    }
    const high = ((v4[0] << 8) | v4[1]).toString(16);
    const low = ((v4[2] << 8) | v4[3]).toString(16);
    text = `${text.slice(0, tail + 1)}${high}:${low}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) {
    return null;
  }
  const toGroups = (part: string): number[] | null => {
    if (part === "") {
      return [];
    }
    const groups = part
      .split(":")
      .map((group) => (/^[0-9a-f]{1,4}$/i.test(group) ? parseInt(group, 16) : NaN));
    return groups.some(Number.isNaN) ? null : groups;
  };
  const head = toGroups(halves[0]);
  const rest = halves.length === 2 ? toGroups(halves[1]) : [];
  if (!head || !rest) {
    return null;
  }
  if (halves.length === 1) {
    return head.length === 8 ? head : null;
  }
  const missing = 8 - head.length - rest.length;
  return missing < 1 ? null : [...head, ...new Array<number>(missing).fill(0), ...rest];
}

const IPV4_BLOCKED: Array<[number[], number]> = [
  [[0, 0, 0, 0], 8], // "this" network
  [[10, 0, 0, 0], 8], // private
  [[100, 64, 0, 0], 10], // CGNAT
  [[127, 0, 0, 0], 8], // loopback
  [[169, 254, 0, 0], 16], // link-local, including the cloud metadata address 169.254.169.254
  [[172, 16, 0, 0], 12], // private
  [[192, 0, 0, 0], 24], // IETF protocol assignments
  [[192, 0, 2, 0], 24], // documentation
  [[192, 88, 99, 0], 24], // deprecated 6to4 relay
  [[192, 168, 0, 0], 16], // private
  [[198, 18, 0, 0], 15], // benchmarking
  [[198, 51, 100, 0], 24], // documentation
  [[203, 0, 113, 0], 24], // documentation
  [[224, 0, 0, 0], 4], // multicast
  [[240, 0, 0, 0], 4] // reserved, including the broadcast address
];

function ipv4InRange(octets: number[], base: number[], bits: number): boolean {
  const toInt = (o: number[]) => ((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (toInt(octets) & mask) === (toInt(base) & mask);
}

function isBlockedIPv4(octets: number[]): boolean {
  return IPV4_BLOCKED.some(([base, bits]) => ipv4InRange(octets, base, bits));
}

function groupsToIPv4(high: number, low: number): number[] {
  return [high >> 8, high & 0xff, low >> 8, low & 0xff];
}

function isBlockedIPv6(groups: number[]): boolean {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
  const firstFiveZero = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;

  // ::/96: the unspecified address, ::1 and the deprecated IPv4-compatible form
  if (firstFiveZero && g5 === 0) {
    return true;
  }
  // ::ffff:a.b.c.d (IPv4-mapped): judge the embedded address
  if (firstFiveZero && g5 === 0xffff) {
    return isBlockedIPv4(groupsToIPv4(g6, g7));
  }
  // 64:ff9b::/96 (NAT64) maps to IPv4 the same way
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return isBlockedIPv4(groupsToIPv4(g6, g7));
  }
  // 2002::/16 (6to4) embeds the IPv4 address in the next 32 bits
  if (g0 === 0x2002) {
    return isBlockedIPv4(groupsToIPv4(g1, g2));
  }
  if (g0 === 0x100 && g1 === 0 && g2 === 0 && g3 === 0) {
    return true; // 100::/64 discard-only
  }
  if (g0 === 0x2001 && (g1 === 0 || g1 === 0xdb8)) {
    return true; // 2001::/32 Teredo, 2001:db8::/32 documentation
  }
  if ((g0 & 0xfe00) === 0xfc00) {
    return true; // fc00::/7 unique local, including the AWS metadata address fd00:ec2::254
  }
  if ((g0 & 0xffc0) === 0xfe80 || (g0 & 0xffc0) === 0xfec0) {
    return true; // fe80::/10 link-local, fec0::/10 site-local
  }
  return (g0 & 0xff00) === 0xff00; // multicast
}

/**
 * Whether the address is loopback, private, link-local, CGNAT, multicast, reserved or a metadata
 * address, in IPv4 or IPv6. Anything that is not a valid IP literal counts as blocked.
 */
export function isPrivateAddress(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, "");
  const version = isIP(bare);
  if (version === 4) {
    const octets = parseIPv4(bare);
    return !octets || isBlockedIPv4(octets);
  }
  if (version === 6) {
    const groups = parseIPv6(bare);
    return !groups || isBlockedIPv6(groups);
  }
  return true;
}
