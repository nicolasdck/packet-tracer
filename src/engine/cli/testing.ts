import type { DeviceKind, IosDevice, Project } from '../model/types'
import { createProject } from '../project/create'
import { addDevice } from '../project/topology'
import { cliComplete, cliHelp, ctrlZ, executeLine, getPrompt, openSession } from './execute'
import type { CliSession } from './types'

/** Test helper: a console attached to one device of a project. */
export class TestConsole {
  project: Project
  session: CliSession
  greeting: string

  constructor(project: Project, deviceId: string) {
    const r = openSession(project, deviceId)
    this.project = r.project
    this.session = r.session
    this.greeting = r.output.join('\n')
  }

  static of(kind: DeviceKind): TestConsole {
    const { project, deviceId } = addDevice(createProject('p', 'test', 0), kind, { x: 0, y: 0 })
    return new TestConsole(project, deviceId)
  }

  get device(): IosDevice {
    return this.project.devices[this.session.deviceId] as IosDevice
  }

  get prompt(): string {
    return getPrompt(this.project, this.session).text
  }

  /** Runs one line and returns its output joined by newlines. */
  run(line: string): string {
    const r = executeLine(this.project, this.session, line)
    this.project = r.project
    this.session = r.session
    return r.output.join('\n')
  }

  /** Runs several lines, returns the output of the last one. */
  runAll(...lines: string[]): string {
    let out = ''
    for (const l of lines) out = this.run(l)
    return out
  }

  ctrlZ(): string {
    const r = ctrlZ(this.project, this.session)
    this.project = r.project
    this.session = r.session
    return r.output.join('\n')
  }

  help(line: string): string {
    return cliHelp(this.project, this.session, line).join('\n')
  }

  complete(line: string): string | null {
    return cliComplete(this.project, this.session, line)
  }
}
