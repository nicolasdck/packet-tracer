import type { LabCheck, LabInfo, Project } from '../model/types'
import { LabTopology } from './build'

export interface LabDefinition {
  info: LabInfo
  /** Starting network of the lab. */
  build(): Project
}

const task = (id: string, text: string, check: LabCheck, hint?: string) => ({ id, text, check, ...(hint ? { hint } : {}) })

const basicRouter: LabDefinition = {
  info: {
    id: 'basic-router',
    title: 'First router configuration',
    level: 'beginner',
    summary: 'Secure a new router, address its LAN interface and save the configuration.',
    tasks: [
      task('hostname', 'Name the router R1.', { kind: 'hostname', device: 'R1', value: 'R1' }, 'configure terminal → hostname R1'),
      task('secret', 'Protect privileged EXEC with an enable secret.', { kind: 'enableSecret', device: 'R1' }, 'enable secret <password>'),
      task('console', 'Require a password on the console line.', { kind: 'consoleLogin', device: 'R1' }, 'line console 0 → password <pw> → login'),
      task('ip', 'Give GigabitEthernet0/0 the address 192.168.1.1/24.', { kind: 'interfaceIp', device: 'R1', iface: 'GigabitEthernet0/0', address: '192.168.1.1', mask: '255.255.255.0' }, 'interface g0/0 → ip address 192.168.1.1 255.255.255.0'),
      task('up', 'Bring GigabitEthernet0/0 up.', { kind: 'interfaceUp', device: 'R1', iface: 'GigabitEthernet0/0' }, 'Router interfaces are shut down by default: no shutdown'),
      task('ping', 'PC0 can ping its gateway 192.168.1.1.', { kind: 'ping', from: 'PC0', to: '192.168.1.1' }),
      task('save', 'Save the configuration.', { kind: 'saved', device: 'R1' }, 'copy running-config startup-config'),
    ],
  },
  build: () =>
    new LabTopology()
      .add('router', 'R1', 300, 120)
      .add('pc', 'PC0', 300, 320)
      .link('PC0', 'FastEthernet0', 'R1', 'GigabitEthernet0/0')
      .host('PC0', '192.168.1.10', '255.255.255.0', '192.168.1.1').project,
}

const staticRouting: LabDefinition = {
  info: {
    id: 'static-routing',
    title: 'Static routing',
    level: 'beginner',
    summary: 'Two routers linked by a serial line: add the static routes so both LANs can talk.',
    tasks: [
      task('r1', 'R1 has a static route to 192.168.2.0/24.', { kind: 'route', device: 'R1', to: '192.168.2.0', code: 'S' }, 'ip route 192.168.2.0 255.255.255.0 10.0.0.2'),
      task('r2', 'R2 has a default route.', { kind: 'route', device: 'R2', to: '0.0.0.0', code: 'S*' }, 'ip route 0.0.0.0 0.0.0.0 10.0.0.1'),
      task('ping', 'PC0 can ping PC1 (192.168.2.10).', { kind: 'ping', from: 'PC0', to: '192.168.2.10' }, 'Routes are needed in both directions.'),
    ],
  },
  build: () =>
    new LabTopology()
      .add('router', 'R1', 200, 120)
      .add('router', 'R2', 460, 120)
      .add('pc', 'PC0', 200, 320)
      .add('pc', 'PC1', 460, 320)
      .link('R1', 'Serial0/0/0', 'R2', 'Serial0/0/0')
      .link('PC0', 'FastEthernet0', 'R1', 'GigabitEthernet0/0')
      .link('PC1', 'FastEthernet0', 'R2', 'GigabitEthernet0/0')
      .config('R1', 'hostname R1', 'int g0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shut', 'int s0/0/0', 'ip address 10.0.0.1 255.255.255.252', 'clock rate 64000', 'no shut')
      .config('R2', 'hostname R2', 'int g0/0', 'ip address 192.168.2.1 255.255.255.0', 'no shut', 'int s0/0/0', 'ip address 10.0.0.2 255.255.255.252', 'no shut')
      .host('PC0', '192.168.1.10', '255.255.255.0', '192.168.1.1')
      .host('PC1', '192.168.2.10', '255.255.255.0', '192.168.2.1').project,
}

const vlans: LabDefinition = {
  info: {
    id: 'vlans-trunk',
    title: 'VLANs and trunk',
    level: 'intermediate',
    summary: 'Split two switches into VLAN 10 (SALES) and VLAN 20 (ENG), carried over a trunk.',
    tasks: [
      task('v10', 'Create VLAN 10 named SALES on S1.', { kind: 'vlan', device: 'S1', vlan: 10, name: 'SALES' }, 'vlan 10 → name SALES'),
      task('v20', 'Create VLAN 20 named ENG on S2.', { kind: 'vlan', device: 'S2', vlan: 20, name: 'ENG' }),
      task('a1', 'S1 Fa0/1 is an access port of VLAN 10.', { kind: 'accessVlan', device: 'S1', iface: 'FastEthernet0/1', vlan: 10 }, 'switchport mode access → switchport access vlan 10'),
      task('a2', 'S2 Fa0/2 is an access port of VLAN 20.', { kind: 'accessVlan', device: 'S2', iface: 'FastEthernet0/2', vlan: 20 }),
      task('trunk', 'Gi0/1 between the switches is a trunk.', { kind: 'trunk', device: 'S1', iface: 'GigabitEthernet0/1' }, 'switchport mode trunk (two dynamic auto ports stay access)'),
      task('same', 'PC1 (VLAN 10, S1) can ping PC3 (VLAN 10, S2).', { kind: 'ping', from: 'PC1', to: '192.168.0.13' }),
      task('isolated', 'PC1 cannot reach PC2, which is in VLAN 20.', { kind: 'noPing', from: 'PC1', to: '192.168.0.12' }),
    ],
  },
  build: () => {
    const t = new LabTopology()
      .add('switch-l2', 'S1', 200, 120)
      .add('switch-l2', 'S2', 480, 120)
      .add('pc', 'PC1', 120, 320)
      .add('pc', 'PC2', 280, 320)
      .add('pc', 'PC3', 400, 320)
      .add('pc', 'PC4', 560, 320)
      .link('S1', 'GigabitEthernet0/1', 'S2', 'GigabitEthernet0/1')
      .link('PC1', 'FastEthernet0', 'S1', 'FastEthernet0/1')
      .link('PC2', 'FastEthernet0', 'S1', 'FastEthernet0/2')
      .link('PC3', 'FastEthernet0', 'S2', 'FastEthernet0/1')
      .link('PC4', 'FastEthernet0', 'S2', 'FastEthernet0/2')
    ;[1, 2, 3, 4].forEach((i) => t.host(`PC${i}`, `192.168.0.1${i}`, '255.255.255.0'))
    return t.project
  },
}

const routerOnAStick: LabDefinition = {
  info: {
    id: 'router-on-a-stick',
    title: 'Router-on-a-stick',
    level: 'intermediate',
    summary: 'The VLANs are ready on the switch: route between them with 802.1Q subinterfaces.',
    tasks: [
      task('trunk', 'S1 Gi0/1, towards the router, is a trunk.', { kind: 'trunk', device: 'S1', iface: 'GigabitEthernet0/1' }),
      task('sub10', 'R1 Gi0/0.10 has 192.168.10.1/24.', { kind: 'interfaceIp', device: 'R1', iface: 'GigabitEthernet0/0.10', address: '192.168.10.1', mask: '255.255.255.0' }, 'interface g0/0.10 → encapsulation dot1Q 10 → ip address …'),
      task('sub20', 'R1 Gi0/0.20 has 192.168.20.1/24.', { kind: 'interfaceIp', device: 'R1', iface: 'GigabitEthernet0/0.20', address: '192.168.20.1', mask: '255.255.255.0' }),
      task('ping', 'PC10 can ping PC20 (192.168.20.10).', { kind: 'ping', from: 'PC10', to: '192.168.20.10' }, 'Do not forget no shutdown on g0/0 itself.'),
    ],
  },
  build: () =>
    new LabTopology()
      .add('router', 'R1', 340, 80)
      .add('switch-l2', 'S1', 340, 220)
      .add('pc', 'PC10', 220, 380)
      .add('pc', 'PC20', 460, 380)
      .link('S1', 'GigabitEthernet0/1', 'R1', 'GigabitEthernet0/0')
      .link('PC10', 'FastEthernet0', 'S1', 'FastEthernet0/1')
      .link('PC20', 'FastEthernet0', 'S1', 'FastEthernet0/2')
      .config('S1', 'vlan 10', 'name V10', 'vlan 20', 'name V20', 'exit', 'int fa0/1', 'switchport mode access', 'switchport access vlan 10', 'int fa0/2', 'switchport mode access', 'switchport access vlan 20')
      .host('PC10', '192.168.10.10', '255.255.255.0', '192.168.10.1')
      .host('PC20', '192.168.20.10', '255.255.255.0', '192.168.20.1').project,
}

const ospf: LabDefinition = {
  info: {
    id: 'ospf',
    title: 'OSPF single area',
    level: 'intermediate',
    summary: 'Three routers are addressed: run OSPF area 0 so every LAN is reachable.',
    tasks: [
      task('nbr', 'R2 has two OSPF neighbors in FULL state.', { kind: 'ospfNeighbors', device: 'R2', count: 2 }, 'router ospf 1 → network <net> <wildcard> area 0 on each router'),
      task('route', 'R1 learns 192.168.3.0/24 through OSPF.', { kind: 'route', device: 'R1', to: '192.168.3.0', code: 'O' }),
      task('ping', 'PC1 can ping PC3 (192.168.3.10).', { kind: 'ping', from: 'PC1', to: '192.168.3.10' }),
    ],
  },
  build: () =>
    new LabTopology()
      .add('router', 'R1', 140, 120)
      .add('router', 'R2', 340, 120)
      .add('router', 'R3', 540, 120)
      .add('pc', 'PC1', 140, 320)
      .add('pc', 'PC3', 540, 320)
      .link('R1', 'GigabitEthernet0/1', 'R2', 'GigabitEthernet0/0')
      .link('R2', 'GigabitEthernet0/1', 'R3', 'GigabitEthernet0/1')
      .link('PC1', 'FastEthernet0', 'R1', 'GigabitEthernet0/0')
      .link('PC3', 'FastEthernet0', 'R3', 'GigabitEthernet0/0')
      .config('R1', 'hostname R1', 'int g0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shut', 'int g0/1', 'ip address 10.0.12.1 255.255.255.252', 'no shut')
      .config('R2', 'hostname R2', 'int g0/0', 'ip address 10.0.12.2 255.255.255.252', 'no shut', 'int g0/1', 'ip address 10.0.23.1 255.255.255.252', 'no shut')
      .config('R3', 'hostname R3', 'int g0/0', 'ip address 192.168.3.1 255.255.255.0', 'no shut', 'int g0/1', 'ip address 10.0.23.2 255.255.255.252', 'no shut')
      .host('PC1', '192.168.1.10', '255.255.255.0', '192.168.1.1')
      .host('PC3', '192.168.3.10', '255.255.255.0', '192.168.3.1').project,
}

const dhcpNat: LabDefinition = {
  info: {
    id: 'dhcp-nat',
    title: 'DHCP and NAT',
    level: 'advanced',
    summary: 'Give the LAN its addresses by DHCP, then let it reach the Internet server with PAT.',
    tasks: [
      task('pc1', 'PC1 gets its address by DHCP.', { kind: 'hostDhcp', device: 'PC1' }, 'ip dhcp excluded-address … → ip dhcp pool LAN → network / default-router'),
      task('pc2', 'PC2 gets its address by DHCP.', { kind: 'hostDhcp', device: 'PC2' }),
      task('internet', 'PC1 can ping the server 8.8.8.8.', { kind: 'ping', from: 'PC1', to: '8.8.8.8' }, 'ip nat inside/outside, an access list for the LAN, ip nat inside source list 1 interface g0/1 overload'),
    ],
  },
  build: () =>
    new LabTopology()
      .add('router', 'R1', 300, 200)
      .add('router', 'ISP', 540, 200)
      .add('switch-l2', 'S1', 300, 360)
      .add('pc', 'PC1', 200, 500)
      .add('pc', 'PC2', 400, 500)
      .add('server', 'Server', 540, 40)
      .link('S1', 'GigabitEthernet0/1', 'R1', 'GigabitEthernet0/0')
      .link('PC1', 'FastEthernet0', 'S1', 'FastEthernet0/1')
      .link('PC2', 'FastEthernet0', 'S1', 'FastEthernet0/2')
      .link('R1', 'GigabitEthernet0/1', 'ISP', 'GigabitEthernet0/0')
      .link('ISP', 'GigabitEthernet0/1', 'Server', 'FastEthernet0')
      .config('R1', 'hostname R1', 'int g0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shut', 'int g0/1', 'ip address 203.0.113.2 255.255.255.252', 'no shut', 'ip route 0.0.0.0 0.0.0.0 203.0.113.1')
      .config('ISP', 'hostname ISP', 'int g0/0', 'ip address 203.0.113.1 255.255.255.252', 'no shut', 'int g0/1', 'ip address 8.8.8.1 255.255.255.0', 'no shut')
      .host('Server', '8.8.8.8', '255.255.255.0', '8.8.8.1')
      .dhcp('PC1')
      .dhcp('PC2').project,
}

const ssh: LabDefinition = {
  info: {
    id: 'ssh',
    title: 'Remote access with SSH',
    level: 'advanced',
    summary: 'Prepare R1 for SSH logins with a local account, then automate it from the PC (Python tab).',
    tasks: [
      task('ssh', 'PC0 can log in to R1 (192.168.1.1) over SSH as admin / cisco.', { kind: 'ssh', from: 'PC0', to: '192.168.1.1', username: 'admin', password: 'cisco' },
        'hostname, ip domain-name, crypto key generate rsa modulus 1024, username admin secret cisco, line vty 0 4 → login local → transport input ssh'),
      task('save', 'Save the configuration.', { kind: 'saved', device: 'R1' }),
    ],
  },
  build: () =>
    new LabTopology()
      .add('router', 'R1', 300, 120)
      .add('pc', 'PC0', 300, 320)
      .link('PC0', 'FastEthernet0', 'R1', 'GigabitEthernet0/0')
      .config('R1', 'int g0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shut')
      .host('PC0', '192.168.1.10', '255.255.255.0', '192.168.1.1').project,
}

/** Labs shipped with the app, in suggested order. */
export const LABS: readonly LabDefinition[] = [basicRouter, staticRouting, vlans, routerOnAStick, ospf, dhcpNat, ssh]
