// Uploaded JavaScript runs inside QuickJS/WASM, never in the Edge host context.
export async function runHosted(
  QuickJS,
  source,
  sdk,
  event,
  invoke,
  options = {},
) {
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(8 * 1024 * 1024);
  runtime.setMaxStackSize(256 * 1024);
  const vm = runtime.newContext(),
    logs = [],
    pending = new Set(),
    deferreds = [];
  let alive = true,
    calls = 0,
    cpu = options.cpuMs || 150,
    sliceEnd = Infinity;
  const deadline = Date.now() + (options.timeoutMs || 8000);
  runtime.setInterruptHandler(
    () => Date.now() > sliceEnd || Date.now() > deadline,
  );
  runtime.setModuleLoader((name) => {
    if (["chatbox.js", "./chatbox.js"].includes(name)) return sdk;
    throw Error("Only chatbox.js can be imported in hosted bots");
  });
  function execute(fn) {
    const start = Date.now();
    sliceEnd = start + cpu;
    try {
      return fn();
    } finally {
      cpu -= Date.now() - start;
      if (cpu < 0) cpu = 0;
    }
  }
  function unwrap(result) {
    if (result.error) {
      const error = vm.dump(result.error);
      result.error.dispose();
      throw Error(error.message || String(error));
    }
    return result.value;
  }
  function evaluate(code, name = "runtime.js", type = "global") {
    const h = unwrap(execute(() => vm.evalCode(code, name, { type })));
    h.dispose();
  }
  function read(name) {
    const h = vm.getProp(vm.global, name);
    try {
      return vm.dump(h);
    } finally {
      h.dispose();
    }
  }
  const bridge = vm.newFunction("__bridge", (actionHandle, payloadHandle) => {
    if (++calls > 8) throw Error("Maximum 8 API calls per event");
    const action = vm.getString(actionHandle),
      payload = JSON.parse(vm.getString(payloadHandle));
    const deferred = vm.newPromise();
    deferreds.push(deferred);
    const work = Promise.resolve()
      .then(() => invoke(action, payload))
      .then(
        (data) => {
          if (!alive) return;
          const h = vm.newString(JSON.stringify(data ?? null));
          deferred.resolve(h);
          h.dispose();
        },
        (error) => {
          if (!alive) return;
          const h = vm.newError(String(error.message || error));
          deferred.reject(h);
          h.dispose();
        },
      )
      .finally(() => pending.delete(work));
    pending.add(work);
    return deferred.handle.dup();
  });
  vm.setProp(vm.global, "__bridge", bridge);
  bridge.dispose();
  const logger = vm.newFunction("__log", (h) => {
    if (logs.length < 20) logs.push(vm.getString(h).slice(0, 500));
  });
  vm.setProp(vm.global, "__log", logger);
  logger.dispose();
  const data = vm.newString(JSON.stringify(event));
  vm.setProp(vm.global, "__eventJSON", data);
  data.dispose();
  async function drain(flag) {
    while (!read(flag)) {
      if (Date.now() > deadline)
        throw Error("Hosted bot exceeded its execution deadline");
      const result = execute(() => runtime.executePendingJobs(100));
      if (result.error) {
        const error = vm.dump(result.error);
        result.error.dispose();
        throw Error(error.message || "Script error");
      }
      if (!read(flag))
        await Promise.race([...pending, new Promise((r) => setTimeout(r, 5))]);
    }
    if (read("__failure")) throw Error(read("__failure"));
  }
  try {
    evaluate(
      'globalThis.console={log:(...a)=>__log(a.map(String).join(" ")),warn:(...a)=>__log(a.map(String).join(" ")),error:(...a)=>__log(a.map(String).join(" "))};globalThis.__ready=false;globalThis.__done=false;',
    );
    evaluate(source + "\nglobalThis.__ready=true;", "bot.js", "module");
    await drain("__ready");
    evaluate(
      "globalThis.__dispatch(JSON.parse(__eventJSON)).then(()=>globalThis.__done=true,e=>{globalThis.__failure=String(e.message||e);globalThis.__done=true;});",
    );
    await drain("__done");
    return { logs, calls };
  } finally {
    alive = false;
    for (const d of deferreds) if (d.alive) d.dispose();
    vm.dispose();
    runtime.dispose();
  }
}
