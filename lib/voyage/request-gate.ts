// A last-request-wins gate for asynchronous lookups (C2O-061 #2): every new request takes a ticket; a response
// is applied only while its ticket is still the latest, so a slower, older response can never overwrite a newer one.
export interface RequestGate { next(): number; isCurrent(ticket: number): boolean }

export function createRequestGate(): RequestGate {
  let latest = 0;
  return { next: () => ++latest, isCurrent: (ticket) => ticket === latest };
}
