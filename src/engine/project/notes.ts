import { produce } from 'immer'
import type { Note, Project } from '../model/types'

export const MAX_NOTE_NAME = 60

/** Adds a note at the end of the list. The id comes from the caller (deterministic engine). */
export function addNote(project: Project, note: Note): Project {
  return produce(project, (draft) => {
    draft.notes.push({ ...note, name: note.name.trim().slice(0, MAX_NOTE_NAME) || 'Untitled' })
  })
}

export function updateNote(project: Project, id: string, patch: Partial<Pick<Note, 'name' | 'text'>>): Project {
  return produce(project, (draft) => {
    const note = draft.notes.find((n) => n.id === id)
    if (!note) return
    if (patch.text !== undefined) note.text = patch.text
    if (patch.name !== undefined) note.name = patch.name.trim().slice(0, MAX_NOTE_NAME) || note.name
  })
}

export function deleteNote(project: Project, id: string): Project {
  return produce(project, (draft) => {
    draft.notes = draft.notes.filter((n) => n.id !== id)
  })
}
