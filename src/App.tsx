import { useEffect } from 'react'
import { startAutosave } from './ui/persistence/autosave'
import { ProjectList } from './ui/screens/ProjectList'
import { Workspace } from './ui/screens/Workspace'
import { useProjectStore } from './ui/store/projectStore'

function App() {
  const project = useProjectStore((s) => s.project)

  useEffect(() => startAutosave(), [])

  return project ? <Workspace project={project} /> : <ProjectList />
}

export default App
