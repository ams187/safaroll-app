export function safariBackStep(active: boolean, recap: boolean, offer: boolean, mode: boolean, joining: boolean) {
  if (active) return null;
  if (recap) return 'recap';
  if (offer) return 'offer';
  if (mode) return 'mode';
  return joining ? 'joining' : null;
}
