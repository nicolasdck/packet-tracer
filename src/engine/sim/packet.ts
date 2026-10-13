import type { NatProtocol } from '../model/types'

export type IcmpType = 'echo' | 'echo-reply' | 'unreachable' | 'time-exceeded'

/** A simulated IP packet. Mutated on its way by NAT (addresses, id) and routers (TTL). */
export interface Packet {
  src: number
  dst: number
  ttl: number
  proto: NatProtocol
  /** ICMP identifier, or source port for UDP/TCP. */
  id: number
  dstPort?: number
  icmpType?: IcmpType
  /** ICMP errors: the flow of the packet that caused the error (used by NAT). */
  related?: { proto: NatProtocol; id: number }
}
