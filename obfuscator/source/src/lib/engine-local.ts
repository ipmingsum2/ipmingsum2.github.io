export default async function createProcessingWorker() {
  return new Worker(new URL("../worker/prometheus.worker.ts", import.meta.url), { type: "module" })
}
