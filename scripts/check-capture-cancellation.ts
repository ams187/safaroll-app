import { beginCaptureAttempt, cancelCaptureAttempt } from '../src/lib/animals/capture-attempt';

const counter = { current: 0 };
const firstWasCancelled = beginCaptureAttempt(counter);
if (firstWasCancelled()) throw new Error('A fresh capture must remain active');

const secondWasCancelled = beginCaptureAttempt(counter);
if (!firstWasCancelled()) throw new Error('Starting a new capture must invalidate the previous one');
if (secondWasCancelled()) throw new Error('The newest capture must remain active');

cancelCaptureAttempt(counter);
if (!secondWasCancelled()) throw new Error('Cancelling must invalidate an in-flight capture before it has an id');

console.log('check-capture-cancellation: stale and explicitly cancelled captures cannot complete');
