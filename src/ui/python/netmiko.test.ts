import netmikoSource from './netmiko.py?raw'
import { loadPyodide, type PyodideInterface } from 'pyodide'
import { beforeAll, describe, expect, it } from 'vitest'
import type { IosDevice } from '../../engine'
import { network } from '../../engine/sim/testNetwork'
import { createBridge, newRun, type RunState } from './bridge'

/**
 * End-to-end test of the Python side with the real interpreter (Pyodide runs in
 * Node too): netmiko.py, the bridge, and the engine.
 */

let py: PyodideInterface
let run: RunState
let output = ''

beforeAll(async () => {
  py = await loadPyodide()
  py.registerJsModule('_sim', createBridge(() => run))
  py.FS.writeFile('/home/pyodide/netmiko.py', netmikoSource)
  py.setStdout({ batched: (text) => (output += `${text}\n`) })
}, 60_000)

async function execute(state: RunState, code: string) {
  run = state
  output = ''
  const globals = py.globals.get('dict')()
  try {
    await py.runPythonAsync(code, { globals })
  } finally {
    globals.destroy()
  }
  return output
}

/** Automation PC 192.168.1.10 — R1 (192.168.1.1) and R2 (192.168.1.2) on one switch, SSH ready. */
function lab() {
  const n = network()
  const sw = n.add('switch-l2')
  const pc = n.add('pc')
  n.link(pc, 'FastEthernet0', sw, 'FastEthernet0/1')
  n.host(pc, '192.168.1.10', '255.255.255.0')
  const routers = [1, 2].map((i) => {
    const r = n.add('router')
    n.link(r, 'GigabitEthernet0/0', sw, `FastEthernet0/${i + 1}`)
    n.config(
      r,
      `hostname R${i}`,
      'enable secret class',
      'ip domain-name lab.local',
      'username admin secret cisco',
      'crypto key generate rsa modulus 1024',
      'line vty 0 4', 'login local', 'transport input ssh', 'exit',
      'int g0/0', `ip address 192.168.1.${i} 255.255.255.0`, 'no shut',
    )
    return r
  })
  return { n, pc, routers }
}

describe('netmiko in Python', () => {
  it('configures several routers in a loop', async () => {
    const { n, pc, routers } = lab()
    const state = newRun(n.project, pc)
    const out = await execute(
      state,
      `
from netmiko import ConnectHandler
for i, ip in enumerate(["192.168.1.1", "192.168.1.2"], start=1):
    with ConnectHandler(device_type="cisco_ios", host=ip, username="admin", password="cisco", secret="class") as c:
        c.enable()
        c.send_config_set(["interface g0/1", f"description uplink {i}"])
        print(c.find_prompt())
`,
    )
    expect(out).toBe('R1#\nR2#\n')
    routers.forEach((r, i) => {
      expect((state.project.devices[r] as IosDevice).running.interfaces['GigabitEthernet0/1']!.description).toBe(`uplink ${i + 1}`)
    })
  }, 30_000)

  it('send_config_set returns the session transcript and send_command the output', async () => {
    const { n, pc } = lab()
    const out = await execute(
      newRun(n.project, pc),
      `
from netmiko import ConnectHandler
c = ConnectHandler(device_type="cisco_ios", host="192.168.1.1", username="admin", password="cisco", secret="class")
c.enable()
print(c.send_config_set("hostname CORE"))
print(c.send_command("show running-config").count("hostname CORE"))
c.disconnect()
`,
    )
    expect(out).toContain('R1#configure terminal\nEnter configuration commands, one per line.  End with CNTL/Z.\nR1(config)#hostname CORE\nCORE(config)#end\n')
    expect(out.trim().endsWith('1')).toBe(true)
  }, 30_000)

  it('raises netmiko exceptions on bad credentials and unreachable devices', async () => {
    const { n, pc } = lab()
    const out = await execute(
      newRun(n.project, pc),
      `
from netmiko import ConnectHandler, NetmikoAuthenticationException, NetmikoTimeoutException
try:
    ConnectHandler(device_type="cisco_ios", host="192.168.1.1", username="admin", password="bad")
except NetmikoAuthenticationException as e:
    print("auth:", e)
try:
    ConnectHandler(device_type="cisco_ios", host="192.168.1.99", username="admin", password="cisco")
except NetmikoTimeoutException:
    print("timeout")
`,
    )
    expect(out).toContain('auth: Authentication to device failed (192.168.1.1).')
    expect(out).toContain('timeout')
  }, 30_000)

  it('needs enable() before configuring, with the right secret', async () => {
    const { n, pc } = lab()
    const out = await execute(
      newRun(n.project, pc),
      `
from netmiko import ConnectHandler
c = ConnectHandler(device_type="cisco_ios", host="192.168.1.1", username="admin", password="cisco", secret="wrong")
print(c.find_prompt())
try:
    c.send_config_set(["hostname X"])
except ValueError as e:
    print("config:", e)
try:
    c.enable()
except ValueError as e:
    print("enable:", e)
`,
    )
    expect(out).toContain('R1>\n')
    expect(out).toContain('config: Failed to enter configuration mode: call enable() first.')
    expect(out).toContain("enable: Failed to enter enable mode. Please ensure you pass the 'secret' argument to ConnectHandler.")
  }, 30_000)

  it('rejects unsupported device types', async () => {
    const { n, pc } = lab()
    const out = await execute(
      newRun(n.project, pc),
      `
from netmiko import ConnectHandler
try:
    ConnectHandler(device_type="juniper", host="192.168.1.1")
except ValueError as e:
    print(e)
`,
    )
    expect(out).toContain("Unsupported 'device_type'")
  }, 30_000)
})
