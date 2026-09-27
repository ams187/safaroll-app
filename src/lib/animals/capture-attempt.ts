type AttemptCounter = { current: number };

export function beginCaptureAttempt(counter: AttemptCounter) {
  const attempt = ++counter.current;
  return () => counter.current !== attempt;
}

export function cancelCaptureAttempt(counter: AttemptCounter) {
  counter.current += 1;
}
