# Agent architecture notes

1. A layer diagram is for marking boundaries that can fail independently and be replaced independently, not for listing every feature. In April 2026, Anthropic's Managed Agents and OpenAI's Agents SDK update each converged on the same split: a durable session log (state), a stateless harness (the agent loop), and a disposable sandbox (the execution environment) are kept separate, and credentials never enter the sandbox. The other layers are capabilities, protocols, and cross-cutting concerns attached to these three components.
2. State is the source of truth; context is a view compiled from state for each call. This is current practice, not a future idea. Compaction and truncation are irreversible, so the full log must live outside the context.
3. The harness matters a lot, but it should be thin. The same model can score more with a better harness, but assumptions hard-coded into a harness about "what the model can't do" go stale as models improve. The investment worth making is in durability, recovery, isolation, and context management, not in scaffolding for planning and task decomposition.
4. Multi-agent is not the default. It pays off clearly when a task can be split into parallel parts, and almost always makes things worse when steps depend on each other.
5. Keeping MCP and A2A separate is correct: MCP covers an agent calling tools and data; A2A covers an agent handing a task to another agent.
6. Evaluation scores outcome state; trajectories are for diagnosis and catching shortcuts, not the unit of scoring.
7. Delegated authorization has a clear direction, but the standards haven't settled. What can be deployed today is credential isolation and approval tiered by action risk.
