import { DAILY_CAPTURE_ENERGY, remainingCaptureEnergy } from '../src/lib/animals/capture-energy';

const now = new Date(2026, 7, 4, 12).getTime();
const today = new Date(2026, 7, 4, 8).getTime();
const yesterday = new Date(2026, 7, 3, 23, 59).getTime();

if (remainingCaptureEnergy([], false, now) !== DAILY_CAPTURE_ENERGY) throw new Error('A new day must start at 10');
if (remainingCaptureEnergy([{ capturedAt: yesterday }, { capturedAt: today }], false, now) !== 9) throw new Error('Only today counts');
if (remainingCaptureEnergy(Array.from({ length: 12 }, () => ({ capturedAt: today })), false, now) !== 0) throw new Error('Energy cannot be negative');
if (remainingCaptureEnergy([], true, now) !== null) throw new Error('Unlimited accounts have no quota');

console.log('Capture energy check passed.');
