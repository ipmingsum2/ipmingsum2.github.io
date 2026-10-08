import { request } from "./auth"
export default async function createProcessingWorker() {
  const response = await request("/engine.js")
  if (!response.ok) throw new Error("The private engine could not be downloaded.")
  const url = URL.createObjectURL(new Blob([await response.text()], { type: "text/javascript" }))
  try { return new Worker(url) } finally { URL.revokeObjectURL(url) }
}
