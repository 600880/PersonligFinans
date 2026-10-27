import type { Folder } from './api'
import { norwegian } from './norwegian'

// The API's order for Folders: by name in the Norwegian alphabet, ignoring case, so an added Folder
// takes the place the API would list it in.
export function inFolderOrder(folders: Folder[]): Folder[] {
  return [...folders].sort((a, b) => norwegian(a.name, b.name))
}
