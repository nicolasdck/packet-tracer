import { describe, expect, it } from 'vitest'
import { TestConsole } from './testing'

const MARKER_MSG = "% Invalid input detected at '^' marker."

/** Line of the ^ marker, as printed under "prompt + line". */
function markerAt(col: number) {
  return ' '.repeat(col) + '^'
}

describe('modes and prompts', () => {
  it('walks user → privileged → global config → interface and back', () => {
    const t = TestConsole.of('router')
    expect(t.prompt).toBe('Router>')
    t.run('enable')
    expect(t.prompt).toBe('Router#')
    expect(t.run('configure terminal')).toBe('Enter configuration commands, one per line.  End with CNTL/Z.')
    expect(t.prompt).toBe('Router(config)#')
    t.run('interface GigabitEthernet0/0')
    expect(t.prompt).toBe('Router(config-if)#')
    t.run('exit')
    expect(t.prompt).toBe('Router(config)#')
    expect(t.run('exit')).toBe('%SYS-5-CONFIG_I: Configured from console by console')
    expect(t.prompt).toBe('Router#')
    t.run('disable')
    expect(t.prompt).toBe('Router>')
  })

  it('end and Ctrl+Z go back to privileged EXEC from any config mode', () => {
    const t = TestConsole.of('router')
    t.runAll('en', 'conf t', 'int g0/0')
    expect(t.run('end')).toContain('%SYS-5-CONFIG_I')
    expect(t.prompt).toBe('Router#')
    t.runAll('conf t', 'line con 0')
    expect(t.prompt).toBe('Router(config-line)#')
    expect(t.ctrlZ()).toContain('%SYS-5-CONFIG_I')
    expect(t.prompt).toBe('Router#')
  })

  it('Ctrl+Z does nothing in EXEC modes', () => {
    const t = TestConsole.of('router')
    expect(t.ctrlZ()).toBe('')
    expect(t.prompt).toBe('Router>')
  })

  it('exit from EXEC ends the session until RETURN is pressed', () => {
    const t = TestConsole.of('router')
    t.run('en')
    expect(t.run('exit')).toContain('Press RETURN to get started.')
    expect(t.prompt).toBe('')
    t.run('')
    expect(t.prompt).toBe('Router>')
  })

  it('accepts global commands from a sub-mode and switches to global config', () => {
    const t = TestConsole.of('router')
    t.runAll('en', 'conf t', 'int g0/0', 'hostname R1')
    expect(t.prompt).toBe('R1(config)#')
    t.run('int g0/1')
    expect(t.prompt).toBe('R1(config-if)#')
    expect(t.session.ifContext).toEqual(['GigabitEthernet0/1'])
  })
})

describe('abbreviations', () => {
  it('accepts unambiguous prefixes', () => {
    const t = TestConsole.of('router')
    t.runAll('en', 'conf t', 'int gigabitEthernet 0/1')
    expect(t.session.ifContext).toEqual(['GigabitEthernet0/1'])
    t.run('int se0/0/1')
    expect(t.session.ifContext).toEqual(['Serial0/0/1'])
    t.run('end')
    expect(t.run('sh ip int br')).toMatch(/^Interface\s+IP-Address\s+OK\? Method Status\s+Protocol/)
  })

  it('is case-insensitive', () => {
    const t = TestConsole.of('router')
    t.runAll('EN', 'CONF T')
    expect(t.prompt).toBe('Router(config)#')
  })

  it('reports ambiguous commands with the line typed so far', () => {
    const t = TestConsole.of('router')
    t.run('en')
    expect(t.run('co')).toBe('% Ambiguous command: "co"\n')
    expect(t.run('show i')).toBe('% Ambiguous command: "show i"\n')
  })

  it('reports incomplete commands', () => {
    const t = TestConsole.of('router')
    t.run('en')
    expect(t.run('show')).toBe('% Incomplete command.\n')
    expect(t.run('conf')).toBe('% Incomplete command.\n')
    expect(t.run('show ip interface')).toBe('% Incomplete command.\n')
  })
})

describe('invalid input marker', () => {
  it('points at the first character that cannot match a keyword', () => {
    const t = TestConsole.of('router')
    t.run('en')
    // "Router#" (7) + "show ip interfaces brief": "interfaces" starts at 8, fails at its 10th char.
    expect(t.run('show ip interfaces brief')).toBe(`${markerAt(7 + 17)}\n${MARKER_MSG}\n`)
  })

  it('points at the start of an unknown word', () => {
    const t = TestConsole.of('router')
    t.run('en')
    expect(t.run('show foo')).toBe(`${markerAt(7 + 5)}\n${MARKER_MSG}\n`)
  })

  it('points inside an invalid IP address', () => {
    const t = TestConsole.of('router')
    t.runAll('en', 'conf t', 'int g0/0')
    // "Router(config-if)#" (18) + "ip address " (11) + "192.168.30" ok, next "0" fails.
    expect(t.run('ip address 192.168.300.1 255.255.255.0')).toBe(`${markerAt(18 + 11 + 10)}\n${MARKER_MSG}\n`)
  })

  it('points inside an unknown interface number', () => {
    const t = TestConsole.of('router')
    t.runAll('en', 'conf t')
    // "Router(config)#" (15) + "int g0/" is valid, "5" fails.
    expect(t.run('int g0/5')).toBe(`${markerAt(15 + 7)}\n${MARKER_MSG}\n`)
  })

  it('rejects extra words after a complete command', () => {
    const t = TestConsole.of('router')
    t.run('en')
    expect(t.run('show version extra')).toBe(`${markerAt(7 + 13)}\n${MARKER_MSG}\n`)
  })

  it('treats an unknown single word in EXEC as a host name', () => {
    const t = TestConsole.of('router')
    expect(t.run('foo')).toBe(
      'Translating "foo"...domain server (255.255.255.255)\n% Unknown command or computer name, or unable to find computer address\n',
    )
  })

  it('uses the marker for unknown commands in config mode', () => {
    const t = TestConsole.of('router')
    t.runAll('en', 'conf t')
    expect(t.run('foo')).toBe(`${markerAt(15)}\n${MARKER_MSG}\n`)
  })

  it('hides commands not available on the interface type', () => {
    const t = TestConsole.of('router')
    t.runAll('en', 'conf t', 'int g0/0')
    expect(t.run('clock rate 64000')).toContain(MARKER_MSG)
    t.run('int s0/0/0')
    expect(t.run('duplex full')).toContain(MARKER_MSG)
  })
})

describe('? help', () => {
  it('lists the commands available at the current point', () => {
    const t = TestConsole.of('router')
    t.run('en')
    const out = t.help('show ')
    expect(out).toContain('  running-config')
    expect(out).toContain('Current operating configuration')
    expect(out).not.toContain('<cr>')
  })

  it('aligns keywords and help texts in columns', () => {
    const t = TestConsole.of('router')
    t.run('en')
    const lines = t.help('configure ').split('\n')
    expect(lines[0]).toBe('  terminal  Configure from the terminal')
  })

  it('shows <cr> when the command is complete', () => {
    const t = TestConsole.of('router')
    t.run('en')
    expect(t.help('write ')).toBe('  memory  Write to NV memory\n  <cr>\n')
  })

  it('lists keywords matching a partial word', () => {
    const t = TestConsole.of('router')
    t.run('en')
    expect(t.help('co')).toBe('configure  copy\n')
  })

  it('shows argument labels', () => {
    const t = TestConsole.of('router')
    t.runAll('en', 'conf t', 'int g0/0')
    expect(t.help('ip address ')).toContain('A.B.C.D  IP address')
    t.run('exit')
    expect(t.help('line vty ')).toContain('<0-15>  First Line number')
    expect(t.help('int g')).toBe('GigabitEthernet\n')
    expect(t.help('int g ')).toContain('<0-0>  GigabitEthernet interface number')
  })

  it('only offers the no form for commands that support it', () => {
    const t = TestConsole.of('router')
    t.runAll('en', 'conf t', 'int g0/0')
    const out = t.help('no ')
    expect(out).toContain('shutdown')
    expect(out).toContain('ip')
    expect(out).not.toContain('exit')
  })

  it('reports unrecognized commands', () => {
    const t = TestConsole.of('router')
    expect(t.help('xyz')).toBe('% Unrecognized command\n')
  })

  it('works when typed at the end of an executed line', () => {
    const t = TestConsole.of('router')
    t.run('en')
    expect(t.run('co?')).toBe('configure  copy\n')
  })
})

describe('Tab completion', () => {
  it('completes an unambiguous keyword and adds a space', () => {
    const t = TestConsole.of('router')
    t.run('en')
    expect(t.complete('sh')).toBe('show ')
    expect(t.complete('conf t')).toBe('conf terminal ')
    expect(t.complete('sh ip int br')).toBe('sh ip int brief ')
  })

  it('does nothing when ambiguous, unknown or after a space', () => {
    const t = TestConsole.of('router')
    t.run('en')
    expect(t.complete('co')).toBeNull()
    expect(t.complete('xyz')).toBeNull()
    expect(t.complete('show ')).toBeNull()
  })

  it('completes interface types', () => {
    const t = TestConsole.of('router')
    t.runAll('en', 'conf t')
    expect(t.complete('int g')).toBe('int GigabitEthernet ')
  })
})

describe('history', () => {
  it('records executed lines without consecutive duplicates', () => {
    const t = TestConsole.of('router')
    t.runAll('en', 'show version', 'show version', 'conf t')
    expect(t.session.history).toEqual(['en', 'show version', 'conf t'])
  })

  it('never records passwords', () => {
    const t = TestConsole.of('router')
    t.runAll('en', 'conf t', 'enable secret class', 'end', 'disable', 'enable', 'class')
    expect(t.prompt).toBe('Router#')
    expect(t.session.history).not.toContain('class')
  })
})

describe('do', () => {
  it('runs EXEC commands from configuration modes', () => {
    const t = TestConsole.of('router')
    t.runAll('en', 'conf t', 'int g0/0')
    expect(t.run('do show ip interface brief')).toContain('GigabitEthernet0/0')
    expect(t.prompt).toBe('Router(config-if)#')
    expect(t.run('do sh run')).toContain('Building configuration...')
  })
})

describe('immutability', () => {
  it('never mutates the input project', () => {
    const t = TestConsole.of('router')
    const before = t.project
    const snapshot = JSON.stringify(before)
    t.runAll('en', 'conf t', 'hostname R1', 'int g0/0', 'no shut')
    expect(JSON.stringify(before)).toBe(snapshot)
    expect(t.project).not.toBe(before)
  })
})
