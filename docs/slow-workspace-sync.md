# Slow workspace reads

Read-only Direct API requests use a 20-second inactivity deadline and a separate
120-second total deadline, including response body transfer. Each received chunk
renews only the inactivity deadline. The UI shows received decoded KB (not wire
bytes, and not a percentage of compressed Content-Length). Partial JSON never
becomes a sync base. A failed sync keeps the last complete base, displayed history,
and drafts; automatic retries back off 5/10/20/30 seconds (poll scheduling may add
up to two seconds). Mutations retain their existing 30-second deadline and are
never automatically retried by this reader.

Initial history and explicit older-history additions can take longer than ten
seconds. Existing gzip, keyed deltas, append patches, and lost-base recovery are
unchanged. A history synchronization failure is now reported in the history UI
instead of being swallowed as success. There is still a finite total deadline:
a sufficiently slow or oversized initial snapshot can exceed it. This change
does not reduce the initial snapshot or introduce resumable transfers.

Validation: reproduce the previous timeout on the real non-localhost HTTP origin
with Chrome at 256 kbps / 200 ms latency; test slow progress, inactivity, total
expiry, and retry with a real streaming HTTP server. Browser coverage includes
non-secure HTTP, an initial response delayed over ten seconds, interrupted delta
recovery and preserved drafts, plus older history and lost-base recovery.
