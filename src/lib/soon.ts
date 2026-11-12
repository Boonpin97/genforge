export function soon(cb: () => void): () => void {
  let done = false;
  let raf = 0;
  let timer = 0;
  const stop = () => {
    done = true;
    cancelAnimationFrame(raf);
    window.clearTimeout(timer);
  };
  const run = () => {
    if (done) return;
    stop();
    cb();
  };
  raf = requestAnimationFrame(run);
  timer = window.setTimeout(run, 60);
  return stop;
}
