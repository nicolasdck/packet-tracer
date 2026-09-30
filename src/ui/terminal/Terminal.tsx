import { getPrompt, type Project } from '../../engine'
import { useCliStore, type Terminal as TerminalState } from '../store/cliStore'
import { ConsoleView } from './ConsoleView'

interface Props {
  project: Project
  terminal: TerminalState
}

/** Console of an IOS device. */
export function Terminal({ project, terminal }: Props) {
  const { submit, ctrlZ, help, complete } = useCliStore()
  const prompt = getPrompt(project, terminal.session)
  return (
    <ConsoleView
      lines={terminal.lines}
      prompt={prompt.text}
      masked={prompt.masked}
      history={terminal.session.history}
      onSubmit={submit}
      onHelp={help}
      onComplete={complete}
      onCtrlZ={ctrlZ}
    />
  )
}
