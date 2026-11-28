Pre-inbox execution fixtures (reference only)

These files explicitly set flow.protocol=0 and assert new protocol-0 sends,
result-return executions and replacement/automatic recovery writers. Those
writers are intentionally removed. They are retained here as historical test
specifications, not executed against the new service and not reported passing.

The live input protocol is 1. Current executable coverage is in
request-inbox, child-continuation, conversation-followup, addressed-input,
stopped-runtime-adoption, legacy-execution-readonly and stable-bootstrap tests.
Legacy records remain decoded/visible; sent/running observations are tested
without granting new protocol-0 sends. This is not a claim that every old test
has a one-to-one replacement. Fixed review must assess the removed behavior and
the dedicated real-model/UI verification remains required before completion.
