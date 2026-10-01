// Own only children started by this runner; never signal unrelated user processes.
export async function stopProcess(child, graceMs = 5_000) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise(resolve => child.once('exit', resolve))
  let timer
  try {
    child.kill('SIGINT')
    const expired = new Promise(resolve => { timer = setTimeout(() => resolve(true), graceMs) })
    if (await Promise.race([exited.then(() => false), expired])) {
      child.kill('SIGKILL')
      await exited
    }
  } finally { clearTimeout(timer) }
}
