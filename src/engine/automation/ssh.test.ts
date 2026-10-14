import { describe, expect, it } from 'vitest'
import { TestConsole } from '../cli/testing'
import { type7 } from '../cli/crypto'
import type { IosDevice } from '../model/types'
import { createProject } from '../project/create'
import { migrateProject } from '../project/migrate'
import { addNote, deleteNote, updateNote } from '../project/notes'
import { network } from '../sim/testNetwork'
import { sshLogin, sshPrompt, sshSend } from './ssh'

const SSH_SETUP = [
  'hostname R1',
  'ip domain-name cisco.com',
  'username admin privilege 15 secret cisco',
  'username guest secret guest',
  'crypto key generate rsa modulus 1024',
  'ip ssh version 2',
  'line vty 0 4',
  'login local',
  'transport input ssh',
  'exit',
]

/** PC (192.168.1.10) — R1 g0/0 192.168.1.1, SSH ready unless told otherwise. */
function lab(setup: string[] = SSH_SETUP) {
  const n = network()
  const r = n.add('router')
  const pc = n.add('pc')
  n.link(pc, 'FastEthernet0', r, 'GigabitEthernet0/0')
  n.config(r, 'int g0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shut', 'exit', ...setup)
  n.host(pc, '192.168.1.10', '255.255.255.0', '192.168.1.1')
  return { n, r, pc }
}

describe('SSH server configuration', () => {
  it('RSA keys need a hostname and a domain name', () => {
    const t = TestConsole.of('router')
    t.runAll('en', 'conf t')
    expect(t.run('crypto key generate rsa')).toBe('% Please define a hostname other than Router.')
    t.run('hostname R1')
    expect(t.run('crypto key generate rsa')).toBe('% Please define a domain-name first.')
  })

  it('asks for the modulus when it is not given', () => {
    const t = TestConsole.of('router')
    t.runAll('en', 'conf t', 'hostname R1', 'ip domain name lab.local')
    expect(t.run('crypto key generate rsa')).toBe(
      [
        'The name for the keys will be: R1.lab.local',
        'Choose the size of the key modulus in the range of 360 to 4096 for your',
        '  General Purpose Keys. Choosing a key modulus greater than 512 may take',
        '  a few minutes.',
        '',
      ].join('\n'),
    )
    expect(t.prompt).toBe('How many bits in the modulus [512]: ')
    expect(t.run('2048')).toBe('% Generating 2048 bit RSA keys, keys will be non-exportable...[OK]\n\n%SSH-5-ENABLED: SSH 1.99 has been enabled')
    expect(t.device.running.rsaKeyBits).toBe(2048)
    expect(t.prompt).toBe('R1(config)#')
  })

  it('SSH version 2 needs keys of at least 768 bits', () => {
    const t = TestConsole.of('router')
    t.runAll('en', 'conf t', 'hostname R1', 'ip domain-name x.y', 'crypto key generate rsa modulus 512')
    expect(t.run('ip ssh version 2')).toBe('Please create RSA keys (of atleast 768 bits size) to enable SSH v2.')
    t.run('crypto key generate rsa general-keys modulus 1024')
    expect(t.run('ip ssh version 2')).toBe('')
    expect(t.run('do show ip ssh')).toBe('SSH Enabled - version 2.0\nAuthentication timeout: 120 secs; Authentication retries: 3')
  })

  it('show ip ssh without keys', () => {
    const t = TestConsole.of('router')
    expect(t.run('show ip ssh').split('\n')[0]).toBe('SSH Disabled - version 1.99')
  })

  it('is written to the running-config, keys excepted', () => {
    const { n, r } = lab()
    const run = n.exec(r, 'show running-config')
    expect(run).toMatch(/^username admin privilege 15 secret 5 \$1\$/m)
    expect(run).toMatch(/^username guest secret 5 \$1\$/m)
    expect(run).toContain('ip domain-name cisco.com\nip ssh version 2\n')
    expect(run).toContain('line vty 0 4\n login local\n transport input ssh\n')
    expect(run).not.toContain('crypto')
  })

  it('user passwords follow service password-encryption', () => {
    const t = TestConsole.of('router')
    t.runAll('en', 'conf t', 'username bob password 0 letmein')
    expect(t.run('do show running-config')).toContain('username bob password 0 letmein')
    t.run('service password-encryption')
    expect(t.run('do show running-config')).toContain(`username bob password 7 ${type7('letmein')}`)
    t.run('no username bob')
    expect(t.device.running.users).toEqual([])
  })

  it('keys survive a reload, and can be removed', () => {
    const { n, r } = lab()
    const t = new TestConsole(n.project, r)
    t.runAll('en', 'wr', 'reload', '', '')
    expect(t.device.running.rsaKeyBits).toBe(1024)
    t.runAll('en', 'conf t')
    expect(t.run('crypto key zeroize rsa')).toBe('% All RSA keys will be removed.\n%SSH-5-DISABLED: SSH 1.99 has been disabled')
    expect(t.device.running.rsaKeyBits).toBeUndefined()
    expect(t.run('crypto key zeroize rsa')).toBe('% No Signature RSA Keys found in configuration.')
  })

  it('transport input is only for vty lines', () => {
    const t = TestConsole.of('router')
    t.runAll('en', 'conf t', 'line con 0')
    expect(t.run('transport input ssh')).toContain("% Invalid input detected at '^' marker.")
  })
})

describe('SSH login', () => {
  it('opens a privileged session for a privilege 15 account', () => {
    const { n, r, pc } = lab()
    const login = sshLogin(n.project, pc, '192.168.1.1', 'admin', 'cisco')
    expect(login.ok).toBe(true)
    if (!login.ok) return
    expect(login.deviceId).toBe(r)
    expect(sshPrompt(login.project, login.session)).toBe('R1#')
    const shown = sshSend(login.project, login.session, 'show ip interface brief')
    expect(shown.output).toContain('GigabitEthernet0/0     192.168.1.1')
  })

  it('configures the device through the session', () => {
    const { n, r, pc } = lab()
    const login = sshLogin(n.project, pc, '192.168.1.1', 'admin', 'cisco')
    if (!login.ok) throw new Error(login.message)
    let { project, session } = login
    for (const line of ['configure terminal', 'interface g0/1', 'description set by script', 'end']) {
      ;({ project, session } = sshSend(project, session, line))
    }
    expect((project.devices[r] as IosDevice).running.interfaces['GigabitEthernet0/1']!.description).toBe('set by script')
  })

  it('a privilege 1 account starts in user EXEC', () => {
    const { n, pc } = lab()
    const login = sshLogin(n.project, pc, '192.168.1.1', 'guest', 'guest')
    if (!login.ok) throw new Error(login.message)
    expect(sshPrompt(login.project, login.session)).toBe('R1>')
  })

  it('refuses wrong credentials', () => {
    const { n, pc } = lab()
    expect(sshLogin(n.project, pc, '192.168.1.1', 'admin', 'nope')).toMatchObject({ ok: false, error: 'auth' })
    expect(sshLogin(n.project, pc, '192.168.1.1', 'nobody', 'cisco')).toMatchObject({ ok: false, error: 'auth' })
  })

  it('with `login` the vty password is checked, whatever the user name', () => {
    const { n, pc } = lab([
      'hostname R1', 'ip domain-name cisco.com', 'crypto key generate rsa modulus 1024',
      'line vty 0 4', 'password vtypass', 'login', 'exit',
    ])
    expect(sshLogin(n.project, pc, '192.168.1.1', 'anyone', 'vtypass').ok).toBe(true)
    expect(sshLogin(n.project, pc, '192.168.1.1', 'anyone', 'wrong')).toMatchObject({ error: 'auth' })
  })

  it('is refused without keys, with telnet only, or with keys too small for SSH v2', () => {
    const noKeys = lab(SSH_SETUP.filter((l) => !l.startsWith('crypto') && !l.startsWith('ip ssh')))
    expect(sshLogin(noKeys.n.project, noKeys.pc, '192.168.1.1', 'admin', 'cisco')).toMatchObject({ error: 'refused' })
    const telnet = lab([...SSH_SETUP, 'line vty 0 4', 'transport input telnet'])
    expect(sshLogin(telnet.n.project, telnet.pc, '192.168.1.1', 'admin', 'cisco')).toMatchObject({ error: 'refused' })
    const small = lab(SSH_SETUP.map((l) => (l.startsWith('crypto') ? 'crypto key generate rsa modulus 512' : l)).filter((l) => l !== 'ip ssh version 2'))
    const login = sshLogin(small.n.project, small.pc, '192.168.1.1', 'admin', 'cisco')
    expect(login).toMatchObject({ ok: false, error: 'refused' })
    expect(login.ok === false && login.message).toContain('768')
  })

  it('times out when the device cannot be reached', () => {
    const { n, r, pc } = lab()
    expect(sshLogin(n.project, pc, '10.9.9.9', 'admin', 'cisco')).toMatchObject({ error: 'timeout' })
    n.config(r, 'int g0/0', 'shutdown')
    expect(sshLogin(n.project, pc, '192.168.1.1', 'admin', 'cisco')).toMatchObject({ error: 'timeout' })
  })

  it('goes through access lists: TCP 22 is what matters, not ICMP', () => {
    const { n, r, pc } = lab()
    n.config(r, 'access-list 100 deny icmp any any', 'access-list 100 permit tcp any any eq 22', 'int g0/0', 'ip access-group 100 in')
    // Denied pings come back as "Destination host unreachable", never as replies.
    expect(n.pc(pc, 'ping 192.168.1.1')).not.toContain('bytes=32')
    expect(sshLogin(n.project, pc, '192.168.1.1', 'admin', 'cisco').ok).toBe(true)
    n.config(r, 'no access-list 100', 'access-list 100 deny tcp any any eq 22', 'access-list 100 permit ip any any')
    expect(sshLogin(n.project, pc, '192.168.1.1', 'admin', 'cisco')).toMatchObject({ error: 'timeout' })
  })

  it('only speaks IPv4', () => {
    const { n, pc } = lab()
    expect(sshLogin(n.project, pc, '2001:db8::1', 'admin', 'cisco')).toMatchObject({ error: 'unsupported' })
  })
})

describe('notes', () => {
  it('are added, edited and removed', () => {
    let p = createProject('p', 't', 0)
    p = addNote(p, { id: 'n1', name: '  R1 base  ', text: 'hostname R1' })
    p = addNote(p, { id: 'n2', name: '', text: '' })
    expect(p.notes.map((n) => n.name)).toEqual(['R1 base', 'Untitled'])
    p = updateNote(p, 'n1', { text: 'hostname R2', name: 'R2 base' })
    expect(p.notes[0]).toEqual({ id: 'n1', name: 'R2 base', text: 'hostname R2' })
    p = updateNote(p, 'n1', { name: '   ' })
    expect(p.notes[0]!.name).toBe('R2 base')
    p = deleteNote(p, 'n2')
    expect(p.notes).toHaveLength(1)
  })

  it('are added to projects saved before notes existed', () => {
    const old = structuredClone(createProject('p', 't', 0)) as Partial<ReturnType<typeof createProject>>
    delete old.notes
    expect(migrateProject(old as ReturnType<typeof createProject>).notes).toEqual([])
  })
})
