import { useEffect } from 'react'
import { UpdateBanner } from './ui/components/UpdateBanner'
import { startAutosave } from './ui/persistence/autosave'
import { ProjectList } from './ui/screens/ProjectList'
import { Workspace } from './ui/screens/Workspace'
import { useProjectStore } from './ui/store/projectStore'

function App() {
  const project = useProjectStore((s) => s.project)

  useEffect(() => startAutosave(), [])

  return (
    <>
      {project ? <Workspace project={project} /> : <ProjectList />}
      <UpdateBanner />
    </>
  )
}

export default App
